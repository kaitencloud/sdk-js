import { createClient, createConfig } from "./generated/client/index.ts";
import type { Client } from "./generated/client/index.ts";
import { KaitenError, KaitenNetworkError, type KaitenApiError } from "./runtime/errors.ts";
import { retry } from "./runtime/retry.ts";
import { isBrowserRuntime, secretKeyPrefix } from "./runtime/keys.ts";
import type { KaitenAuthScheme, KaitenClientConfig, KaitenFetch } from "./config.ts";

type ApiResult<T> = {
  data?: T;
  error?: unknown;
  response?: Response;
  request?: Request;
};

function resolveApiBaseUrl(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const origin =
    typeof globalThis.location?.origin === "string" && globalThis.location.origin !== "null"
      ? globalThis.location.origin
      : "http://localhost";

  return `${origin}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

function resolveFetchImplementation(fetchImpl?: KaitenFetch): KaitenFetch {
  if (fetchImpl) {
    return fetchImpl;
  }

  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }

  throw new Error("KaitenClient requires a fetch implementation in this runtime.");
}

function toKaitenApiError(error: unknown, responseStatus?: number): KaitenApiError {
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.title === "string" && typeof candidate.status === "number") {
      return error as KaitenApiError;
    }

    if (typeof candidate.errorCode === "string") {
      return {
        title: candidate.errorCode,
        code: candidate.errorCode,
        status: responseStatus ?? 400,
        detail: typeof candidate.errorDetails === "string" ? candidate.errorDetails : undefined,
      };
    }
  }

  return {
    title: "Unknown error",
    status: responseStatus ?? 500,
  };
}

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

/**
 * Ceiling on a single request when the host sets none.
 *
 * The transport retries network and 5xx failures up to three times, so an API
 * that accepts a connection and then hangs used to stall the licensing snapshot
 * indefinitely with no client-side deadline — a paywall that never resolves.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface KaitenRunOptions {
  /**
   * Whether replaying this call is safe. Defaults to `true`, which is correct
   * for every read and for the OFREP evaluations. Set it to `false` on anything
   * that mutates server state — the transport then never retries it.
   */
  idempotent?: boolean;
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

      // A secret credential must never leave a browser, whatever the auth scheme.
      //
      // Keyed on the runtime, not on the scheme: a guard on
      // `authScheme === "publishable"` alone covers the one mode the backend does
      // not serve, and lets an org-scoped `ksh_` passed as a bearer token go into
      // a bundle without a word.
      //
      // Checked here, at request time, for three reasons: the environment is what
      // makes a secret unsafe (a server has no `window`, so legitimate bearer use
      // is untouched); this runs after `tokenProvider()`, so an async token is
      // covered too; and it rejects a request rather than throwing while a UI
      // renders, where a mistyped key would turn into a blank page.
      if (token && isBrowserRuntime()) {
        const secret = secretKeyPrefix(token);
        if (secret) {
          throw new KaitenError({
            title: "Secret credential used in a browser",
            status: 0,
            detail:
              `Kaiten: a secret key (${secret}*) was about to be sent from a browser. ` +
              `Secret credentials carry rights over an entire organization, or over every ` +
              `organization, and must stay on a server: call the API from your backend.`,
          });
        }
      }

      if (token && this.authScheme === "bearer") {
        headers.set("Authorization", `Bearer ${token}`);
      }

      if (token && this.authScheme === "publishable") {
        headers.set("X-Kaiten-Publishable-Key", token);
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

  async run<T>(
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
          throw new KaitenError(toKaitenApiError(result.error, status));
        }

        return result.data as T;
      },
      {
        retryImmediately: true,
        shouldRetry: (error, iteration) => {
          // A non-idempotent call is never replayed. `KaitenNetworkError` covers
          // the client-side timeout abort, so a backend that committed the write
          // and then answered slowly would otherwise be asked to commit it again
          // — on `reportUsage` that is double-counted usage, and usage is the
          // billing base. There is no idempotency key on the wire to make the
          // replay safe, so the only correct number of attempts is one.
          if (!idempotent) return false;
          if (iteration >= 3) return false;
          if (error instanceof KaitenNetworkError) return true;
          if (error instanceof KaitenError) return error.status >= 500;
          return false;
        },
      },
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
