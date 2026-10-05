import type { Instance } from "../types.ts";
import { useTrackHook } from "../telemetry/context.tsx";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

export function useInstance(): UseKaitenQueryResult<Instance> {
  useTrackHook("useInstance");

  const snapshot = useLicensingSnapshot();

  return {
    data: snapshot.data?.instance ?? undefined,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refetch: snapshot.refetch,
  };
}
