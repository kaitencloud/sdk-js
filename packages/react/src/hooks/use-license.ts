import type { License } from "../types.ts";
import { useTrackHook } from "../telemetry/context.tsx";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

export function useLicense(): UseKaitenQueryResult<License> {
  useTrackHook("useLicense");

  const snapshot = useLicensingSnapshot();

  return {
    data: snapshot.data?.license ?? undefined,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refetch: snapshot.refetch,
  };
}
