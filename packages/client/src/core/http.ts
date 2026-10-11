// The HTTP plumbing every client of this package shares: base URL and fetch
// resolution, error mapping, the retry rule and the browser secret guard. It
// imports nothing generated, so a client that needs only these stays small.

import {
  KaitenError,
  KaitenNetworkError,
  kaitenErrorOf,
  type KaitenApiError,
} from "./runtime/errors.ts";
import { isBrowserRuntime, secretKeyPrefix } from "./runtime/keys.ts";
import type { KaitenFetch } from "./config.ts";

export function resolveApiBaseUrl(apiUrl: string): string {
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

export function resolveFetchImplementation(fetchImpl?: KaitenFetch): KaitenFetch {
  if (fetchImpl) {
    return fetchImpl;
  }

  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }

  throw new Error("KaitenClient requires a fetch implementation in this runtime.");
}

export function toKaitenApiError(error: unknown, responseStatus?: number): KaitenApiError {
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

/**
 * Ceiling on a single request when the host sets none.
 *
 * The transport retries network and 5xx failures up to three times, so an API
 * that accepts a connection and then hangs used to stall the licensing snapshot
 * indefinitely with no client-side deadline — a paywall that never resolves.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Whether to replay a failed attempt: only a call that is safe to replay, at
 * most three attempts, and only after a network failure or a 5xx. A call that
 * names its `statuses` is replayed after those 5xx alone.
 */
export function retryable(
  idempotent: boolean,
  error: unknown,
  iteration: number,
  statuses?: readonly number[],
): boolean {
  // A non-idempotent call is never replayed. `KaitenNetworkError` covers the
  // client-side timeout abort, so a backend that committed the write and then
  // answered slowly would otherwise be asked to commit it again — on
  // `reportUsage` that is double-counted usage, and usage is the billing base.
  // Without an idempotency key on the wire the only correct number of attempts
  // is one; a write whose key a server is known to honour (a `reportUsage` sent
  // under an `Idempotency-Key`, to a server that has echoed one) declares itself
  // idempotent.
  if (!idempotent) return false;
  if (iteration >= 3) return false;
  if (error instanceof KaitenNetworkError) return true;
  if (error instanceof KaitenError) {
    return error.status >= 500 && (statuses === undefined || statuses.includes(error.status));
  }
  return false;
}

/**
 * The `Retry-After` of a response, in seconds, when it sends one the client can
 * read: a whole number of seconds, or an HTTP date, counted from now. `undefined`
 * when there is none, and also when a browser hides the header from a response
 * of another origin, since the two cannot be told apart.
 */
export function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get("Retry-After")?.trim();
  if (!header) return undefined;
  if (/^\d+$/.test(header)) return Number(header);
  // An HTTP date always spells its month or day; this keeps a stray "-5" out.
  const at = /[a-z]/i.test(header) ? Date.parse(header) : Number.NaN;
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** The error a response that failed carries: a `KaitenError`, or the class of the refusal it is. */
export function apiErrorOf(body: unknown, response: Response): KaitenError {
  return kaitenErrorOf(toKaitenApiError(body, response.status), retryAfterSeconds(response));
}

/** Refuses a secret credential in a browser, before anything is sent. */
export function assertNoSecretInBrowser(token: string | undefined): void {
  // A secret credential must never leave a browser, whatever the auth scheme.
  //
  // Keyed on the runtime, not on the scheme: a guard on
  // `authScheme === "publishable"` alone covers the one mode the backend does
  // not serve, and lets an org-scoped `ksh_` passed as a bearer token go into
  // a bundle without a word.
  //
  // Checked at request time, for three reasons: the environment is what makes
  // a secret unsafe (a server has no `window`, so legitimate bearer use is
  // untouched); this runs after `tokenProvider()`, so an async token is covered
  // too; and it rejects a request rather than throwing while a UI renders,
  // where a mistyped key would turn into a blank page.
  if (!token || !isBrowserRuntime()) return;
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
