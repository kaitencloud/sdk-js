import type { LicenseEntitlement } from "../types.ts";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import { useEntitlements } from "./use-kaiten-entitlements.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

function toLicenseEntitlement(
  entitlement: import("../types.ts").ResolvedEntitlement,
  license: import("../types.ts").License | null | undefined,
): LicenseEntitlement {
  // `LicenseEntitlement` is the API's row shape and now also carries audit
  // fields (createdAt/createdBy/updatedAt/updatedBy) that a snapshot-derived row
  // simply does not have -- the snapshot is a resolved view, not a stored row.
  // The cast is what lets this projection stand in for one; `Partial` on the
  // audit half states which fields are genuinely absent instead of pretending
  // the two shapes match.
  return {
    licenseId: license?.id ?? entitlement.id,
    licenseSlug: license?.slug ?? "snapshot",
    entitlementName: entitlement.name,
    entitlementSlug: entitlement.slug,
    entitlementType: entitlement.type,
    value: entitlement.limitValue,
  } as unknown as LicenseEntitlement;
}

/**
 * Internal: maps snapshot entitlements to `LicenseEntitlement` rows (used by
 * `useEntitlement`). Not a public hook — no `useTrackHook` telemetry.
 */
export function useLicenseEntitlementsList(): UseKaitenQueryResult<LicenseEntitlement[] | null> {
  const snapshot = useLicensingSnapshot();
  const entitlements = useEntitlements();

  return {
    data:
      entitlements.data?.map((entitlement) =>
        toLicenseEntitlement(entitlement, snapshot.data?.license),
      ) ?? null,
    isLoading: entitlements.isLoading,
    error: entitlements.error,
    refetch: entitlements.refetch,
  };
}
