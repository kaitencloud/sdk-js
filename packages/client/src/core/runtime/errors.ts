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
