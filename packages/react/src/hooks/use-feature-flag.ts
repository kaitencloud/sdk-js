import * as React from "react";

import type { FeatureFlagEvaluation } from "../types.ts";
import { useTrackHook } from "../telemetry/context.tsx";
import { useKaitenContext } from "../providers/kaiten-provider.tsx";
import { kaitenKeys } from "./query-keys.ts";
import { useFlags } from "./use-kaiten-flags.ts";
import { useKaitenQuery, type UseKaitenQueryResult } from "./use-kaiten-query.ts";

/**
 * Evaluate a single feature flag. The generic `T` types the flag's `value`
 * (default `unknown`) so callers don't cast: `useFeatureFlag<boolean>("beta")`.
 */
export function useFeatureFlag<T = unknown>(
  key: string,
  context?: Record<string, unknown>,
): UseKaitenQueryResult<FeatureFlagEvaluation<T>> {
  useTrackHook("useFeatureFlag");

  const { client, scopeKey } = useKaitenContext();
  const flags = useFlags();

  // With a custom context, the embedded snapshot is not enough: evaluate live via OFREP.
  const contextKey = React.useMemo(() => (context ? JSON.stringify(context) : null), [context]);
  const evaluation = useKaitenQuery<FeatureFlagEvaluation<T>>({
    queryKey: [...kaitenKeys.featureFlag.detail(scopeKey, key), contextKey],
    queryFn: () => client.evaluateFlag(key, context) as Promise<FeatureFlagEvaluation<T>>,
    enabled: contextKey !== null,
  });

  if (contextKey !== null) {
    return evaluation;
  }

  const flag = flags.data?.find((candidate) => candidate.key === key);

  return {
    data: flag
      ? {
          key: flag.key,
          value: flag.value as T,
          variant: flag.variant,
          reason: flag.reason,
          metadata: flag.metadata,
        }
      : undefined,
    isLoading: flags.isLoading,
    error: flags.error,
    refetch: flags.refetch,
  };
}
