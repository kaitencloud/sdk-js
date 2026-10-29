// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import type { BulkEvaluationResponse } from "../types.ts";
import { useTrackHook } from "../telemetry/context.tsx";
import { useKaitenContext } from "../providers/kaiten-provider.tsx";
import { withInstanceSlug } from "./flag-context.ts";
import { kaitenKeys } from "./query-keys.ts";
import { useFlags } from "./use-kaiten-flags.ts";
import { useKaitenQuery, type UseKaitenQueryResult } from "./use-kaiten-query.ts";

export function useFeatureFlags(
  context?: Record<string, unknown>,
): UseKaitenQueryResult<BulkEvaluationResponse> {
  useTrackHook("useFeatureFlags");

  const { client, scopeKey, instanceId } = useKaitenContext();
  const flags = useFlags();

  // With a custom context, the embedded snapshot is not enough: evaluate live via OFREP,
  // as the instance the provider is bound to, unless the host's context says otherwise.
  const evaluated = React.useMemo(
    () => (context ? withInstanceSlug(context, instanceId) : undefined),
    [context, instanceId],
  );
  const contextKey = React.useMemo(
    () => (evaluated ? JSON.stringify(evaluated) : null),
    [evaluated],
  );
  const evaluation = useKaitenQuery<BulkEvaluationResponse>({
    queryKey: [...kaitenKeys.featureFlag.bulk(scopeKey), contextKey],
    queryFn: () => client.evaluateFlags(evaluated),
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
