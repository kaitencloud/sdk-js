import type { EntitlementUsage } from "../types.ts";
import { isUnlimited } from "../lib/unlimited.ts";
import { useLocalization } from "../localization/context.tsx";
import { useTrackHook } from "../telemetry/context.tsx";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

function toUsage(
  entitlement: import("../types.ts").ResolvedEntitlement,
  license: import("../types.ts").License | null | undefined,
): EntitlementUsage {
  return {
    entitlementId: entitlement.id,
    entitlementSlug: entitlement.slug,
    licenseId: license?.id ?? entitlement.id,
    licenseSlug: license?.slug ?? "snapshot",
    value: entitlement.currentValue ?? entitlement.limitValue,
    // `EntitlementUsage` is the contract's row and declares these bounds, so a
    // host reading `useUsage().data.currentPeriodStart` is reading a field its
    // own types promise. Dropping them here made that promise permanently
    // `undefined` — a projection that silently returns less than its type says
    // is worse than one with an honest shape.
    ...(entitlement.currentPeriodStart
      ? { currentPeriodStart: entitlement.currentPeriodStart }
      : {}),
    ...(entitlement.currentPeriodEnd ? { currentPeriodEnd: entitlement.currentPeriodEnd } : {}),
  };
}

export function useUsage(
  entitlementSlug?: string,
): UseKaitenQueryResult<EntitlementUsage[] | EntitlementUsage | null> {
  useTrackHook("useUsage");

  const snapshot = useLicensingSnapshot();
  const usageRows =
    snapshot.data?.entitlements.map((entitlement) =>
      toUsage(entitlement, snapshot.data?.license),
    ) ?? [];

  if (entitlementSlug) {
    return {
      data: usageRows.find((usage) => usage.entitlementSlug === entitlementSlug) ?? null,
      isLoading: snapshot.isLoading,
      error: snapshot.error,
      refetch: snapshot.refetch,
    };
  }

  return {
    data: usageRows,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refetch: snapshot.refetch,
  };
}

/**
 * A display row for {@link useUsageGroup} — every value already formatted and
 * localized for rendering.
 *
 * Deliberately NOT `EntitlementGroupUsageItem`, which is the API's row for
 * `GET /entitlement-groups/{slug}/usage`. This hook derives its rows from the
 * licensing snapshot instead, and the two only ever looked alike: the API row now
 * carries discriminated value objects and the current window bounds, where this
 * one carries strings a component can render directly. Borrowing the API type to
 * describe a projection hid that difference until the contract moved.
 */
export interface EntitlementGroupUsageRow {
  entitlementId: string;
  entitlementSlug: string;
  entitlementName: string;
  entitlementType: string;
  /** Already formatted — "Unlimited", "1,000", "true", … */
  licenseValue: string;
  /** Already formatted; the localized "unavailable" label when nothing is reported. */
  usageValue: string;
}

export function useUsageGroup(
  groupSlug: string,
): UseKaitenQueryResult<EntitlementGroupUsageRow[] | null> {
  useTrackHook("useUsageGroup");

  const snapshot = useLicensingSnapshot();
  const localization = useLocalization();
  const data =
    snapshot.data?.entitlements
      .filter(
        (entitlement) =>
          entitlement.category === groupSlug || entitlement.tags?.includes(groupSlug),
      )
      .map((entitlement) => ({
        entitlementId: entitlement.id,
        entitlementSlug: entitlement.slug,
        entitlementName: entitlement.name,
        entitlementType: entitlement.type,
        licenseValue:
          entitlement.limitValue.type === "number"
            ? (entitlement.unlimited ?? isUnlimited(entitlement.limitValue.value))
              ? localization.includedFeatures.unlimited
              : entitlement.limitValue.value.toLocaleString()
            : entitlement.limitValue.type === "boolean"
              ? String(entitlement.limitValue.value)
              : localization.includedFeatures.config,
        usageValue:
          entitlement.currentValue?.type === "number"
            ? entitlement.currentValue.value.toLocaleString()
            : entitlement.currentValue?.type === "boolean"
              ? String(entitlement.currentValue.value)
              : localization.includedFeatures.unavailable,
      })) ?? null;

  return {
    data,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refetch: snapshot.refetch,
  };
}
