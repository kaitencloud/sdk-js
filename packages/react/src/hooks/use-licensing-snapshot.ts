import { useKaitenDataContext } from "../providers/kaiten-provider.tsx";
import { useTrackHook } from "../telemetry/context.tsx";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";
import type { LicensingSnapshot } from "../types.ts";

export function useLicensingSnapshot(): UseKaitenQueryResult<LicensingSnapshot> {
  useTrackHook("useLicensingSnapshot");

  return useKaitenDataContext().snapshot;
}
