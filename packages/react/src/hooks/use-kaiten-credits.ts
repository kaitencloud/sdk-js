// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { CreditBalance } from "../types.ts";
import { useTrackHook } from "../telemetry/context.tsx";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

export function useCredits(): UseKaitenQueryResult<CreditBalance[]> {
  useTrackHook("useCredits");

  const snapshot = useLicensingSnapshot();

  return {
    data: snapshot.data?.credits ?? [],
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refetch: snapshot.refetch,
  };
}
