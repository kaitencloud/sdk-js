// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Thrown values for @kaitencloud/server.
//
// These mirror the shape of the classes @kaitencloud/client exposes to browser
// consumers, but are declared here rather than imported: this package is
// deliberately dependency-free (see vite.config.ts — it is the only dual-built
// package, and CJS output costs nothing precisely because nothing is pulled in
// behind it). A backend that also uses @kaitencloud/client should narrow on
// `kind`/`status` rather than on cross-package `instanceof`.

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
 * or the `kind === "api"` discriminant.
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
 * Thrown when the request never reached the API (offline, DNS, abort) — there
 * is no HTTP status. Narrow with `instanceof KaitenNetworkError` or the
 * `kind === "network"` discriminant.
 */
export class KaitenNetworkError extends Error {
  public readonly kind = "network" as const;
  public override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "KaitenNetworkError";
    this.cause = cause;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The code the API returns when a usage report reuses a `transactionId` for another report. */
const TRANSACTION_ID_REUSED = "ReportEntitlementUsageMetric.TransactionIdReused";

/** The request header a usage report's key travels in, and the location the API names it by. */
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
const IDEMPOTENCY_KEY_LOCATION = `header.${IDEMPOTENCY_KEY_HEADER}`;

/**
 * Reads one header off the options a request was made with: a plain object, as
 * the generated operations pass it on, or a `Headers`, as a call made on the
 * client itself may. Names are matched without regard to case, as HTTP does.
 */
function headerValue(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (!isRecord(headers)) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && typeof value === "string") return value;
  }
  return undefined;
}

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
 * It is a client bug, never a transient failure: retrying it loops, because the
 * key is spent. The usual cause is a correction sent under the original key. A
 * correction is a new report under a new key, with `behavior: "set"` for an
 * absolute value.
 *
 * A `KaitenError`, so a handler that narrows on `instanceof KaitenError` or on
 * `status`/`code` keeps working.
 */
export class TransactionIdReusedError extends KaitenError {
  /** The key the refused report was sent with, when the request carried it in its `Idempotency-Key` header. */
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

/** Every error this package throws, as one discriminated union. */
export type KaitenThrownError = KaitenError | KaitenNetworkError;

/**
 * Converts whatever the generated client rejected with into a real `Error`.
 *
 * The generated transport throws the *parsed response body* (or the raw text
 * when it is not JSON), so without this the value reaching a `catch` has no
 * stack, no `message`, and does not satisfy `instanceof Error`.
 */
export function toKaitenError(
  error: unknown,
  response?: Response,
  options?: { headers?: unknown },
): KaitenThrownError {
  if (error instanceof KaitenError || error instanceof KaitenNetworkError) return error;

  // No response object at all: the request never completed.
  if (!response) {
    if (error instanceof Error) {
      return new KaitenNetworkError(error.message, error);
    }
    return new KaitenNetworkError("Request to the Kaiten API failed", error);
  }

  // An RFC-7807 body is the contract's documented failure shape. `status` is
  // taken from the response when the body omits it, so a proxy that answers
  // with a bare string still yields a usable status.
  if (isRecord(error) && typeof error["title"] === "string") {
    const body = error as unknown as KaitenApiError;
    const apiError = {
      ...body,
      status: typeof body.status === "number" ? body.status : response.status,
    };
    if (apiError.status === 409 && apiError.code === TRANSACTION_ID_REUSED) {
      return new TransactionIdReusedError(
        apiError,
        headerValue(options?.headers, IDEMPOTENCY_KEY_HEADER),
      );
    }
    return new KaitenError(apiError);
  }

  const detail =
    typeof error === "string" && error.length > 0
      ? error
      : isRecord(error) && typeof error["detail"] === "string"
        ? error["detail"]
        : undefined;

  return new KaitenError({
    title: response.statusText || `HTTP ${response.status}`,
    status: response.status,
    ...(detail === undefined ? {} : { detail }),
  });
}

/** The code the API returns when a usage report would cross the entitlement's limit. */
const THRESHOLD_EXCEEDED = "ReportEntitlementUsageMetric.ThresholdExceeded";

/**
 * True when the API refused a usage report because the entitlement's threshold
 * is already reached: HTTP 409 with the code
 * `ReportEntitlementUsageMetric.ThresholdExceeded`.
 *
 * `POST /instances/{instanceSlug}/entitlements/{entitlementSlug}/usage` answers
 * that way when the increment would cross the license limit. That response is
 * the enforcement signal the whole metering path exists to produce, so it gets a
 * named predicate. Other operations answer 409 for other conflicts, such as a
 * slug already taken: the code tells them apart, so the predicate is safe in a
 * shared error handler.
 */
export function isThresholdExceeded(error: unknown): error is KaitenError {
  return error instanceof KaitenError && error.status === 409 && error.code === THRESHOLD_EXCEEDED;
}

/**
 * True when the API refused a usage report because its `transactionId` was
 * already used for another report of the same instance and entitlement: HTTP
 * 409 with the code `ReportEntitlementUsageMetric.TransactionIdReused`. The
 * error is then a {@link TransactionIdReusedError}, which names the original
 * report. Never retry it under the same key.
 */
export function isTransactionIdReused(error: unknown): error is TransactionIdReusedError {
  return error instanceof TransactionIdReusedError;
}
