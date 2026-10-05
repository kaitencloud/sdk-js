import * as React from "react";

import type { BulkEvaluationResponse } from "../types.ts";
import { useTrackHook } from "../telemetry/context.tsx";
import { useKaitenContext } from "../providers/kaiten-provider.tsx";
import { kaitenKeys } from "./query-keys.ts";
import { useFlags } from "./use-kaiten-flags.ts";
import { useKaitenQuery, type UseKaitenQueryResult } from "./use-kaiten-query.ts";

export function useFeatureFlags(
  context?: Record<string, unknown>,
): UseKaitenQueryResult<BulkEvaluationResponse> {
  useTrackHook("useFeatureFlags");

  const { client, scopeKey } = useKaitenContext();
  const flags = useFlags();

  // With a custom context, the embedded snapshot is not enough: evaluate live via OFREP.
  const contextKey = React.useMemo(() => (context ? JSON.stringify(context) : null), [context]);
  const evaluation = useKaitenQuery<BulkEvaluationResponse>({
    queryKey: [...kaitenKeys.featureFlag.bulk(scopeKey), contextKey],
    queryFn: () => client.evaluateFlags(context),
    enabled: contextKey !== null,
  });

  if (contextKey !== null) {
    return evaluation;
  }

  return {
    data: {
      flags:
        flags.data?.map((flag) => ({
          key: flag.key,
          value: flag.value,
          variant: flag.variant,
          reason: flag.reason,
          metadata: flag.metadata,
        })) ?? [],
    },
    isLoading: flags.isLoading,
    error: flags.error,
    refetch: flags.refetch,
  };
}
