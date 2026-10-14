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

  constructor(apiError: KaitenApiError) {
    super(apiError.title);
    this.name = "KaitenError";
    this.status = apiError.status;
    this.detail = apiError.detail;
    this.code = apiError.code;
    this.errorId = apiError.errorId;
    this.errors = apiError.errors;
    this.raw = apiError;
  }
}

/**
 * Thrown by a usage report whose `transactionId` was already used, within the
 * API's idempotency window, for a report with another behavior or value. It is
 * a bug in how keys are made, not a transient failure: the same report under
 * the same key fails the same way, so it is never retried. Send a correction as
 * a new report under a new key.
 */
export class TransactionIdReusedError extends KaitenError {
  constructor(apiError: KaitenApiError) {
    super(apiError);
    this.name = "TransactionIdReusedError";
  }
}

/** The problem code the API answers a reused usage report key with. */
export const TRANSACTION_ID_REUSED = "ReportEntitlementUsageMetric.TransactionIdReused";

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
