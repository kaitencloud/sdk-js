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

/** Every error this package throws, as one discriminated union. */
export type KaitenThrownError = KaitenError | KaitenNetworkError;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Converts whatever the generated client rejected with into a real `Error`.
 *
 * The generated transport throws the *parsed response body* (or the raw text
 * when it is not JSON), so without this the value reaching a `catch` has no
 * stack, no `message`, and does not satisfy `instanceof Error`.
 */
export function toKaitenError(error: unknown, response?: Response): KaitenThrownError {
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
    return new KaitenError({
      ...body,
      status: typeof body.status === "number" ? body.status : response.status,
    });
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
