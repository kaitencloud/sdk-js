// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import useSWR, { useSWRConfig } from "swr";

import { useKaitenContext } from "../providers/kaiten-provider.tsx";

export interface UseKaitenQueryOptions<T> {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  enabled?: boolean;
  refetchInterval?: number;
}

export interface UseKaitenQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useKaitenQuery<T>({
  queryKey,
  queryFn,
  enabled = true,
  refetchInterval,
}: UseKaitenQueryOptions<T>): UseKaitenQueryResult<T> {
  const { polling } = useKaitenContext();
  const effectiveInterval = refetchInterval ?? (polling.enabled ? polling.interval : 0);

  // The SDK's read policy, stated per hook rather than cascaded.
  //
  // These four used to come partly from a `<SWRConfig>` the provider wrapped
  // around its children — which meant the SDK also imposed them on the host's
  // own `useSWR` calls anywhere inside `<KaitenProvider>`, silently turning off
  // their focus revalidation and error retries. The provider's two reads already
  // set all four explicitly, so the cascade only ever changed other people's
  // hooks.
  const swr = useSWR<T, Error>(enabled ? queryKey : null, queryFn, {
    refreshInterval: effectiveInterval,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 1_000,
  });

  return {
    data: swr.data,
    isLoading: swr.isLoading,
    error: swr.error ?? null,
    refetch: () => {
      void swr.mutate();
    },
  };
}

// ---------------------------------------------------------------------------
// Mutation helper
// ---------------------------------------------------------------------------

export interface UseKaitenMutationOptions<TInput, TOutput> {
  mutationFn: (input: TInput) => Promise<TOutput>;
  onSuccess?: (data: TOutput) => void;
  onError?: (error: Error) => void;
  revalidateKeys?: readonly (readonly unknown[])[];
}

export interface UseKaitenMutationResult<TInput, TOutput> {
  /** Makes the call and returns at once: a refusal is on `error` and `onError`, never a rejection. */
  mutate: (input: TInput) => void;
  /** Makes the call: resolves to its answer, or rejects with its refusal, which `error` holds too. */
  mutateAsync: (input: TInput) => Promise<TOutput>;
  data: TOutput | undefined;
  isPending: boolean;
  error: Error | null;
}

export function useKaitenMutation<TInput, TOutput>({
  mutationFn,
  onSuccess,
  onError,
  revalidateKeys,
}: UseKaitenMutationOptions<TInput, TOutput>): UseKaitenMutationResult<TInput, TOutput> {
  const { mutate } = useSWRConfig();
  const [data, setData] = React.useState<TOutput | undefined>(undefined);
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  const fnRef = React.useRef(mutationFn);
  fnRef.current = mutationFn;
  const onSuccessRef = React.useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;
  const revalidateKeysRef = React.useRef(revalidateKeys);
  revalidateKeysRef.current = revalidateKeys;

  const mutateAsync = React.useCallback(
    async (input: TInput) => {
      setIsPending(true);
      setError(null);
      try {
        const result = await fnRef.current(input);
        setData(result);
        setIsPending(false);
        for (const key of revalidateKeysRef.current ?? []) {
          await mutate(key);
        }
        onSuccessRef.current?.(result);
        return result;
      } catch (err) {
        const resolvedError = err instanceof Error ? err : new Error(String(err));
        setError(resolvedError);
        setIsPending(false);
        onErrorRef.current?.(resolvedError);
        throw resolvedError;
      }
    },
    [mutate],
  );

  // Fire and forget: what the call came to is on `error` and `onError`, so the rejection is
  // caught here rather than reported by the browser as unhandled.
  const mutateSync = React.useCallback(
    (input: TInput) => {
      mutateAsync(input).catch(() => {});
    },
    [mutateAsync],
  );

  return { mutate: mutateSync, mutateAsync, data, isPending, error };
}
