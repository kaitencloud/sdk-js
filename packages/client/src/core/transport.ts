// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { createClient, createConfig } from "./generated/client/index.ts";
import type { Client } from "./generated/client/index.ts";
import { KaitenError, KaitenNetworkError } from "./runtime/errors.ts";
import { retry } from "./runtime/retry.ts";
import {
  apiErrorOf,
  assertNoSecretInBrowser,
  DEFAULT_TIMEOUT_MS,
  resolveApiBaseUrl,
  resolveFetchImplementation,
  retryable,
} from "./http.ts";
import type { KaitenAuthScheme, KaitenClientConfig } from "./config.ts";

type ApiResult<T> = {
  data?: T;
  error?: unknown;
  response?: Response;
  request?: Request;
};

function mergeAbortSignals(left: AbortSignal | null | undefined, right: AbortSignal): AbortSignal {
  if (!left) return right;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([left, right]);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (left.aborted || right.aborted) {
    controller.abort();
    return controller.signal;
  }
  left.addEventListener("abort", abort, { once: true });
  right.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export interface KaitenRunOptions {
  /**
   * Whether replaying this call is safe. Defaults to `true`, which is correct
   * for every read and for the OFREP evaluations. Set it to `false` on anything
   * that mutates server state — the transport then never retries it.
   */
  idempotent?: boolean;
  /**
   * The 5xx statuses worth another attempt, for a call that is replayed but not
   * after every server failure. Left out, every 5xx is replayed, as for a read. A
   * network failure is replayed either way.
   */
  retryStatuses?: readonly number[];
  /**
   * Called with the response of the attempt that succeeded, before its body is
   * returned, for a call whose answer also travels in headers. Not called when
   * the call fails.
   */
  onResponse?: (response: Response) => void;
}

export class KaitenTransport {
  readonly http: Client;
  private readonly tokenProvider?: () => string | Promise<string>;
  private readonly authScheme: KaitenAuthScheme;
  private readonly timeoutMs: number;
  private readonly onAuthError?: KaitenClientConfig["onAuthError"];

  constructor(config: KaitenClientConfig) {
    this.tokenProvider = config.tokenProvider;
    this.authScheme = config.authScheme ?? "bearer";
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onAuthError = config.onAuthError;

    this.http = createClient(
      createConfig({
        baseUrl: resolveApiBaseUrl(config.apiUrl),
        fetch: resolveFetchImplementation(config.fetch),
        headers: config.defaultHeaders,
      }),
    );

    this.http.interceptors.request.use(async (request) => {
      const token = this.tokenProvider ? await this.tokenProvider() : undefined;
      const headers = new Headers(request.headers);

      assertNoSecretInBrowser(token);

      if (token && this.authScheme === "bearer") {
        headers.set("Authorization", `Bearer ${token}`);
      }

      if (!headers.has("Content-Type") && request.method !== "GET" && request.method !== "HEAD") {
        headers.set("Content-Type", "application/json");
      }

      const init: RequestInit = { headers };

      if (this.timeoutMs) {
        init.signal = mergeAbortSignals(request.signal, AbortSignal.timeout(this.timeoutMs));
      }

      return new Request(request, init);
    });
  }

  /**
   * Why this client may not call the API's private routes, if it may not.
   *
   * A publishable key is accepted on `/public/catalog` alone. Sending it
   * anywhere else only ever earned a 401, and on the GraphQL and licence routes
   * it asked for data no public key may read, so such a call is refused here,
   * before any request.
   */
  private privateRoutesRefusal(label: string): KaitenError | null {
    if (this.authScheme !== "publishable") return null;
    return new KaitenError({
      title: "Not available with a publishable key",
      status: 0,
      detail:
        `Kaiten: ${label} is not available with a publishable key, which reads the public ` +
        `catalog (getCatalog) only.`,
    });
  }

  async run<T>(
    operation: (client: Client) => Promise<ApiResult<T> | Record<string, unknown>>,
    label: string,
    options: KaitenRunOptions = {},
  ): Promise<T> {
    const refusal = this.privateRoutesRefusal(label);
    if (refusal) throw refusal;
    return this.execute(operation, label, options);
  }

  private async execute<T>(
    operation: (client: Client) => Promise<ApiResult<T> | Record<string, unknown>>,
    label: string,
    options: KaitenRunOptions = {},
  ): Promise<T> {
    // Retrying is only safe when replaying the call cannot change server state
    // twice. Reads qualify, and so do the OFREP evaluations — they are POSTs
    // only because the evaluation context travels in a body.
    const idempotent = options.idempotent ?? true;

    return retry(
      async () => {
        let result: ApiResult<T>;
        try {
          result = await operation(this.http);
        } catch (error) {
          // An error the request pipeline already classified stays classified.
          // Relabelling it "network" both hid its message and made it retryable
          // — the secret-credential guard in the request interceptor was being
          // reported as a connection failure and replayed three times.
          if (error instanceof KaitenError) throw error;
          throw new KaitenNetworkError(`Network error during ${label}`, error);
        }

        if (result.error) {
          // Same rule on this path. The generated client catches whatever a
          // request interceptor throws and hands it back as `result.error`
          // rather than rethrowing, so a guard that fires before the fetch
          // arrives here with no response attached — and would otherwise be
          // reported as a connection failure.
          if (result.error instanceof KaitenError) throw result.error;
          if (!result.response) {
            throw new KaitenNetworkError(`Network error during ${label}`, result.error);
          }
          const status = result.response.status;
          if (status === 401 || status === 403) {
            // Surfaced, never retried: the SDK has no way to mint a new
            // credential, and hammering a rejected one just burns rate budget.
            this.onAuthError?.({ status, operation: label, error: result.error });
          }
          throw apiErrorOf(result.error, result.response);
        }

        if (result.response) options.onResponse?.(result.response);
        return result.data as T;
      },
      {
        retryImmediately: true,
        shouldRetry: (error, iteration) =>
          retryable(idempotent, error, iteration, options.retryStatuses),
      },
    );
  }

  /**
   * Reads a route of the public surface with the publishable key.
   *
   * The key goes in `X-Kaiten-Publishable-Key` and nowhere else: no
   * `Authorization` header, and no cookie (`credentials: "omit"`), since the
   * public routes neither read nor set one and answer any origin. Replayed
   * after a network failure or a 5xx, like every read. `query` is the route's
   * query string, already checked by the caller; a member left `undefined` is
   * not sent.
   *
   * @internal Used by `KaitenClient`; not part of the public API.
   */
  async callPublic<T>(
    path: string,
    label: string,
    query?: Record<string, string | undefined>,
  ): Promise<T> {
    const token = this.tokenProvider ? await this.tokenProvider() : undefined;
    assertNoSecretInBrowser(token);
    if (this.authScheme !== "publishable" || !token?.startsWith("pk_")) {
      throw new KaitenError({
        title: "A publishable key is required",
        status: 0,
        detail: `Kaiten: ${label} needs authScheme "publishable" and a pk_ key.`,
      });
    }
    return this.execute<T>(
      (client) =>
        client.get({
          url: path,
          query,
          headers: { "X-Kaiten-Publishable-Key": token },
          credentials: "omit",
        }),
      label,
    );
  }

  get<T>(path: string): Promise<T> {
    return this.run<T>((client) => client.get<T>({ url: path }), `GET ${path}`);
  }

  post<T>(path: string, body?: unknown, options: KaitenRunOptions = {}): Promise<T> {
    return this.run<T>(
      (client) =>
        client.post<T>({
          url: path,
          body,
          headers: { "Content-Type": "application/json" },
        }),
      `POST ${path}`,
      // The generic write helper: assume the call mutates unless the caller says
      // otherwise. Some POSTs here are really reads — GraphQL queries and OFREP
      // evaluations use a body, not a verb, to carry their input — and those opt
      // retry back in explicitly.
      { idempotent: options.idempotent ?? false },
    );
  }
}
