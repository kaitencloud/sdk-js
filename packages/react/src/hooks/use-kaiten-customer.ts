import type { Customer } from "../types.ts";
import { useTrackHook } from "../telemetry/context.tsx";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

export function useCustomer(): UseKaitenQueryResult<Customer | null> {
  useTrackHook("useCustomer");

  const snapshot = useLicensingSnapshot();

  return {
    data: snapshot.data?.customer ?? null,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refetch: snapshot.refetch,
  };
}
