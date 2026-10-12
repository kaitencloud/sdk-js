import { useKaitenDataContext } from "../providers/kaiten-provider.tsx";
import { useTrackHook } from "../telemetry/context.tsx";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";
import type { LicensingSnapshot, SessionSnapshotMembers } from "../types.ts";

/**
 * The customer's licensing snapshot. Under `mode="customer-session"` it is built from the
 * customer's portal, and carries `currentPlan` and `subscription` beside the members every
 * snapshot has; under any other mode those two are `undefined`.
 */
export function useLicensingSnapshot(): UseKaitenQueryResult<
  LicensingSnapshot & SessionSnapshotMembers
> {
  useTrackHook("useLicensingSnapshot");

  return useKaitenDataContext().snapshot;
}
