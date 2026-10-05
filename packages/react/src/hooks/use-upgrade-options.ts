import * as React from "react";

import { useTrackHook } from "../telemetry/context.tsx";
import { useLicense } from "./use-license.ts";
import { usePlans } from "./use-kaiten-plans.ts";
import type { Plan } from "../types.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

export function useUpgradeOptions(): UseKaitenQueryResult<Plan[]> {
  useTrackHook("useUpgradeOptions");

  const currentLicense = useLicense();
  const plans = usePlans();

  const data = React.useMemo(() => {
    if (!plans.data || !currentLicense.data) return undefined;

    const current = currentLicense.data;
    return (plans.data ?? []).filter(
      (plan) => plan.slug !== current.slug && plan.published !== false,
    );
  }, [plans.data, currentLicense.data]);

  return {
    data,
    isLoading: plans.isLoading || currentLicense.isLoading,
    error: plans.error ?? currentLicense.error,
    refetch: plans.refetch,
  };
}
