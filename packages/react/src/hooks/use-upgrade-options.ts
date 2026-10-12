import * as React from "react";

import { useTrackHook } from "../telemetry/context.tsx";
import { useLicense } from "./use-license.ts";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import { usePlans } from "./use-kaiten-plans.ts";
import type { Plan } from "../types.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

export function useUpgradeOptions(): UseKaitenQueryResult<Plan[]> {
  useTrackHook("useUpgradeOptions");

  const currentLicense = useLicense();
  const plans = usePlans();
  // A customer session's snapshot has no `License`: its portal names the
  // licence of the bound instance by slug, which is what a plan's slug is.
  const snapshot = useLicensingSnapshot();
  const currentSlug = currentLicense.data?.slug ?? snapshot.data?.currentPlan?.slug;

  const data = React.useMemo(() => {
    if (!plans.data || !currentSlug) return undefined;

    return plans.data.filter((plan) => plan.slug !== currentSlug && plan.published !== false);
  }, [plans.data, currentSlug]);

  return {
    data,
    isLoading: plans.isLoading || currentLicense.isLoading,
    error: plans.error ?? currentLicense.error,
    refetch: plans.refetch,
  };
}
