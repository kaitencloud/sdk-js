/**
 * Scope of a NUMBER entitlement's usage counter: a PERIODIC value counts only
 * within the current reset window, a LIFETIME value counts for all time.
 */
export type UsageScope = "LIFETIME" | "PERIODIC";

export type UsageWindowBounds = {
  currentPeriodEnd?: string | null;
  currentPeriodStart?: string | null;
};

/**
 * A NUMBER entitlement that declares a resetPeriod counts within a window; one
 * that does not counts for life. Neither the license entitlement row nor the
 * usage row carries `resetPeriod`, so the window bounds are the discriminator:
 * the API sets both exactly when a reset period is configured, and it zero-fills
 * usage for entitlements never reported — so absent bounds mean "lifetime
 * counter", never "no report yet".
 *
 * Both bounds, not either: a half-populated pair is not a window, and treating
 * one as sufficient would let a malformed row present itself as a cadence.
 */
export const isPeriodicEntitlement = (entitlement: UsageWindowBounds): boolean =>
  Boolean(entitlement.currentPeriodStart && entitlement.currentPeriodEnd);

export const getUsageScope = (entitlement: UsageWindowBounds): UsageScope =>
  isPeriodicEntitlement(entitlement) ? "PERIODIC" : "LIFETIME";

/**
 * The scope as this SDK can actually know it, which has a third state the Kaiten
 * app does not need.
 */
export type ResolvedUsageScope = UsageScope | "UNKNOWN";

/**
 * The two-valued rule above is the *business* rule, and it holds whenever the
 * bounds were genuinely read. This SDK has a case the app does not: a snapshot
 * where the window was never delivered at all — a failed usage read
 * (`usageUnavailable`), or a read path that does not carry the bounds
 * (`usageWindowUnknown`).
 *
 * Both must answer UNKNOWN rather than LIFETIME. "No bounds present" and "no
 * bounds fetched" look identical on the object and mean opposite things: the
 * first is a fact about the entitlement, the second is a fact about the request.
 * Collapsing them prints "Lifetime" over a monthly quota — the same class of
 * mistake as reporting a failed usage read as 0% consumed, which
 * `ResolvedEntitlement.usageUnavailable` exists to prevent, moved onto the time
 * axis.
 */
export const resolveUsageScope = (
  entitlement: UsageWindowBounds & {
    usageUnavailable?: boolean;
    usageWindowUnknown?: boolean;
  },
): ResolvedUsageScope => {
  if (entitlement.usageUnavailable === true || entitlement.usageWindowUnknown === true) {
    return "UNKNOWN";
  }
  return getUsageScope(entitlement);
};

/**
 * Granted value meaning "no cap at all", on both transports.
 */
export const UNLIMITED_THRESHOLD = -1;

/**
 * How a grant enforces its own numeric value, in two numbers and nothing else:
 * the granted value and the percentage usage may exceed it by. Mirrors
 * `api/internal/modules/entitlements/value/enforcement.go`; keep the two in
 * step, since the server accepts and rejects reports on these exact
 * boundaries.
 *
 * The percentage is `-1` exactly when the value is the unlimited sentinel, `0`
 * for a hard limit, and a positive percentage for a soft one. It is null for
 * the BOOLEAN and CONFIG grants that have no value to cap, and absent on a
 * grant written before the field existed, which reads as a hard limit.
 */
export const isUnlimitedThreshold = (threshold: number | null | undefined): boolean =>
  threshold === null || threshold === undefined || threshold === UNLIMITED_THRESHOLD;

/**
 * The highest usage the grant permits. The server rejects a report only when
 * the resulting usage is strictly greater than this, so usage landing exactly
 * on it is still accepted.
 *
 * Null when nothing caps the grant -- unlimited, unset, or a nonsensical
 * negative value. Zero is a real ceiling: a grant of nothing allows nothing.
 */
export const getMaximumAllowedUsage = (
  threshold: number | null | undefined,
  limitCapExceededOveragePercent?: number | null,
): number | null => {
  if (threshold === null || threshold === undefined || threshold < 0) {
    return null;
  }

  const percent = limitCapExceededOveragePercent;

  if (typeof percent !== "number" || !Number.isInteger(percent) || percent <= 0) {
    return threshold;
  }

  return threshold + (threshold * percent) / 100;
};

/**
 * Usage may run past the granted value before being rejected: the grant is
 * capped, and its allowance is positive.
 */
export const isSoftLimit = (
  threshold: number | null | undefined,
  limitCapExceededOveragePercent?: number | null,
): boolean =>
  !isUnlimitedThreshold(threshold) &&
  typeof limitCapExceededOveragePercent === "number" &&
  limitCapExceededOveragePercent > 0;
