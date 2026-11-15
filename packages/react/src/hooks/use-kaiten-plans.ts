// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useKaitenContext, useKaitenDataContext } from "../providers/kaiten-provider.tsx";
import { useTrackHook } from "../telemetry/context.tsx";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";
import type { Plan } from "../types.ts";

export function usePlans(): UseKaitenQueryResult<Plan[]> {
  useTrackHook("usePlans");

  const { mode } = useKaitenContext();
  const { catalog } = useKaitenDataContext();
  const snapshot = useLicensingSnapshot();

  // Plans come from the catalog wherever there is no customer to read them
  // for: public mode fetched it, static mode was given it. Only an
  // authenticated scope has a snapshot, and its plans are the catalog as that
  // one read returned it — one read, one source.
  if (mode !== "authenticated") {
    return {
      data: catalog.data?.plans,
      isLoading: catalog.isLoading,
      error: catalog.error,
      refetch: catalog.refetch,
    };
  }

  return {
    data: snapshot.data?.plans,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refetch: snapshot.refetch,
  };
}
