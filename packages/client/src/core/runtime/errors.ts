// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/**
 * RFC-7807 error **body** returned by the Kaiten API. This is the wire *shape*
 * of a failed response, not a thrown value — {@link KaitenError} wraps it.
 */
export interface KaitenApiError {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Stable, machine-readable error code, such as `License.NotFound`. */
  code?: string;
  /** Correlation id of the API's log entry for this failure: quote it when reporting a problem. */
  errorId?: string;
  errors?: Array<{
    location: string;
    message: string;
    value?: unknown;
  }>;
}

/**
 * Thrown when the API responds with an error status. Carries the HTTP `status`
 * and the parsed {@link KaitenApiError} body. Narrow with `instanceof KaitenError`
 * or the `kind === "api"` discriminant (see {@link KaitenThrownError}).
 */
export class KaitenError extends Error {
  public readonly kind = "api" as const;
  public readonly status: number;
  public readonly detail?: string;
  /** Stable, machine-readable error code, such as `License.NotFound`. */
  public readonly code?: string;
  /** Correlation id of the API's log entry for this failure. */
  public readonly errorId?: string;
  public readonly errors?: KaitenApiError["errors"];
  public readonly raw?: KaitenApiError;
  /**
   * How long the API asked to wait before trying again, in seconds, from the
   * response's `Retry-After` header (a number of seconds or an HTTP date).
   * Absent when the response carried no readable one, which in a browser
   * includes a response whose CORS policy does not expose the header.
   *
   * {@link RateLimitedError}, {@link BoundaryPendingError} and
   * {@link ProviderUnavailableError}, which are refusals made to be waited
   * out, always have it: 60 when the header could not be read.
   */
  public readonly retryAfterSeconds?: number;

  constructor(apiError: KaitenApiError, options?: { retryAfterSeconds?: number }) {
    super(apiError.title);
    this.name = "KaitenError";
    this.status = apiError.status;
    this.detail = apiError.detail;
    this.code = apiError.code;
    this.errorId = apiError.errorId;
    this.errors = apiError.errors;
    this.raw = apiError;
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

/**
 * Thrown when the request never reached the API (offline, DNS, CORS, abort) —
 * there is no HTTP status. Narrow with `instanceof KaitenNetworkError` or the
 * `kind === "network"` discriminant (see {@link KaitenThrownError}).
 */
export class KaitenNetworkError extends Error {
  public readonly kind = "network" as const;
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "KaitenNetworkError";
    this.cause = cause;
  }
}

/**
 * Every error the Kaiten SDK transport throws. A single discriminated union so
 * consumers can write one typed `catch` and switch on `.kind` (`"api"` carries
 * an HTTP `status`; `"network"` carries a `cause`).
 */
export type KaitenThrownError = KaitenError | KaitenNetworkError;

/** Where the API locates the key of a usage report in a problem's `errors[]`: the request header it travels in. */
export const IDEMPOTENCY_KEY_LOCATION = "header.Idempotency-Key";

/** The problem code of a usage report refused because its `transactionId` was already used. */
export const TRANSACTION_ID_REUSED_CODE = "ReportEntitlementUsageMetric.TransactionIdReused";

/** The problem code of a usage report refused because its `transactionId` is malformed. */
export const INVALID_TRANSACTION_ID_CODE = "ReportEntitlementUsageMetric.InvalidTransactionId";

/**
 * The report a `transactionId` was first accepted with, as the API names it in
 * the 409 that refuses another report under the same key.
 */
export interface TransactionIdReusedOriginal {
  /** Position of that report among the pair's accepted reports, from 1. */
  reportSeq: number;
  /** When the server accepted it (RFC 3339, UTC). */
  reportedAt: string;
  /** `append` or `set`, as it was sent. */
  behavior: string;
  /** The value as it was sent: a delta for `append`, an absolute value for `set`. */
  value: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Reads the original report from the problem's `errors[]`, when the body carries it whole. */
function originalReport(apiError: KaitenApiError): TransactionIdReusedOriginal | undefined {
  const entry = apiError.errors?.find((error) => error.location === IDEMPOTENCY_KEY_LOCATION);
  const value = entry?.value;
  if (!isRecord(value)) return undefined;
  const { reportSeq, reportedAt, behavior } = value;
  const reported = value["value"];
  if (
    typeof reportSeq !== "number" ||
    typeof reportedAt !== "string" ||
    typeof behavior !== "string" ||
    typeof reported !== "number"
  ) {
    return undefined;
  }
  return { reportSeq, reportedAt, behavior, value: reported };
}

/**
 * Thrown when a usage report reuses a `transactionId` the API already accepted,
 * within its idempotency horizon, for another report of the same instance and
 * entitlement: a different `behavior` or value. HTTP 409 with the code
 * `ReportEntitlementUsageMetric.TransactionIdReused`.
 *
 * It is a client bug, never a transient failure, so the client does not retry
 * it, and retrying it by hand loops: the key is spent. The usual cause is a
 * correction sent under the original key. A correction is a new report under a
 * new key, with `behavior: "set"` for an absolute value.
 *
 * A `KaitenError`, so a handler that narrows on `instanceof KaitenError` or on
 * `status`/`code` keeps working.
 */
export class TransactionIdReusedError extends KaitenError {
  /** The key the refused report was sent with. */
  public readonly transactionId?: string;
  /** The report the key was first accepted with, when the API named it. */
  public readonly original?: TransactionIdReusedOriginal;

  constructor(apiError: KaitenApiError, transactionId?: string) {
    super(apiError);
    this.name = "TransactionIdReusedError";
    this.transactionId = transactionId;
    this.original = originalReport(apiError);
  }
}

/**
 * Thrown when the API refuses a usage report's `transactionId` as malformed: it
 * must be 1 to 128 characters of `[A-Za-z0-9._:-]`. HTTP 422 with the code
 * `ReportEntitlementUsageMetric.InvalidTransactionId`. Nothing was counted, and
 * the client does not retry it.
 */
export class InvalidTransactionIdError extends KaitenError {
  /** The key the refused report was sent with. */
  public readonly transactionId?: string;

  constructor(apiError: KaitenApiError, transactionId?: string) {
    super(apiError);
    this.name = "InvalidTransactionIdError";
    this.transactionId = transactionId;
  }
}

/**
 * What {@link RateLimitedError}, {@link BoundaryPendingError} and
 * {@link ProviderUnavailableError} say to wait, in seconds, when the response
 * has no `Retry-After` the client can read. A browser calling another origin
 * only sees that header if the API's CORS policy exposes it.
 */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * Thrown when a checkout is refused because the instance already uses more than
 * the plan it would move to allows: HTTP 422 with the code
 * `CreateSessionCheckout.QuotaExceeded`. A `dryRun` is refused the same way, so a
 * preview tells the customer before anything is attempted. Nothing was changed.
 *
 * `entitlementSlugs` names the entitlements whose usage is above what the plan
 * grants. Offer a larger plan, or add-ons that make room for that usage.
 *
 * A `KaitenError`, so a handler that narrows on `instanceof KaitenError` or on
 * `status`/`code` keeps working.
 */
export class QuotaExceededError extends KaitenError {
  /** The entitlements whose current usage is above what the plan grants. */
  public readonly entitlementSlugs: string[];

  constructor(apiError: KaitenApiError) {
    super(apiError);
    this.name = "QuotaExceededError";
    const value = apiError.errors?.[0]?.value;
    const slugs = isRecord(value) ? value["entitlementSlugs"] : undefined;
    this.entitlementSlugs = Array.isArray(slugs)
      ? slugs.filter((slug): slug is string => typeof slug === "string")
      : [];
  }
}

/**
 * A refusal made to be waited out: it says how long, and never replays itself.
 * The classes below differ in what they refuse, not in what they carry.
 */
class WaitError extends KaitenError {
  declare public readonly retryAfterSeconds: number;

  constructor(apiError: KaitenApiError, options?: { retryAfterSeconds?: number }) {
    super(apiError, {
      retryAfterSeconds: options?.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS,
    });
  }
}

/**
 * Thrown when the API refuses a call because the caller made too many: HTTP 429
 * with a code ending in `.RateLimited`, such as
 * `ValidateSessionVoucher.RateLimited`. Nothing was done.
 *
 * `retryAfterSeconds` is how long to wait: the API's `Retry-After`, or 60 when
 * the response carries none the client can read. The client does not replay the
 * call, a write or a read.
 */
export class RateLimitedError extends WaitError {
  override name = "RateLimitedError";
}

/**
 * Thrown when a change is refused because the billing period that just ended is
 * still being closed: HTTP 409 with a code ending in `.BoundaryPending`, such as
 * `CancelSessionSubscription.BoundaryPending`. Nothing was changed, and the same
 * call goes through once the close has run.
 *
 * `retryAfterSeconds` is how long that is expected to take: the API's
 * `Retry-After`, or 60 when the response carries none the client can read. The
 * client does not send the call again; the host decides, usually by sending it
 * once more after that delay.
 */
export class BoundaryPendingError extends WaitError {
  override name = "BoundaryPendingError";
}

/**
 * Thrown when the payment provider could not be reached: HTTP 503 with a code
 * ending in `.ProviderUnavailable`, such as `CreateSessionCheckout.ProviderUnavailable`.
 * The call was neither carried out nor refused on its merits.
 *
 * `retryAfterSeconds` is how long to wait, at least 30 from the API; when the
 * response carries no `Retry-After` the client can read, it is 60. A read is
 * sent again by the client after that delay, at most 30 seconds; a write never
 * is, since whether it took effect is not known.
 */
export class ProviderUnavailableError extends WaitError {
  override name = "ProviderUnavailableError";
}

/**
 * The error for a failed response. The refusals a host acts on, told apart by
 * status and code, are their own classes; every other one is a `KaitenError`
 * with its `status` and `code`.
 *
 * `retryAfterSeconds` is the response's `Retry-After`, `undefined` when it
 * cannot be read.
 */
export function kaitenErrorOf(apiError: KaitenApiError, retryAfterSeconds?: number): KaitenError {
  const { status, code = "" } = apiError;
  if (status === 422 && code.endsWith(".QuotaExceeded")) return new QuotaExceededError(apiError);
  if (status === 429 && code.endsWith(".RateLimited")) {
    return new RateLimitedError(apiError, { retryAfterSeconds });
  }
  if (status === 409 && code.endsWith(".BoundaryPending")) {
    return new BoundaryPendingError(apiError, { retryAfterSeconds });
  }
  if (status === 503 && code.endsWith(".ProviderUnavailable")) {
    return new ProviderUnavailableError(apiError, { retryAfterSeconds });
  }
  return new KaitenError(apiError, { retryAfterSeconds });
}
