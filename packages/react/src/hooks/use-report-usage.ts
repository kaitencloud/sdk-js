import { useSWRConfig } from "swr";

import { useKaitenContext } from "../providers/kaiten-provider.tsx";
import { useTelemetry, useTrackHook } from "../telemetry/context.tsx";
import { useKaitenMutation, type UseKaitenMutationResult } from "./use-kaiten-query.ts";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import { kaitenKeys } from "./query-keys.ts";
import type {
  LicensingSnapshot,
  ReportUsageInput,
  ReportUsageResult,
  ResolvedEntitlement,
} from "../types.ts";

export interface ReportUsageArgs {
  entitlementSlug: string;
  /**
   * The report. Give it a `transactionId` to make it idempotent: it travels in
   * the `Idempotency-Key` request header, never in the body, and the API counts
   * the report once per key. The client sends it again, under the same key,
   * after a network failure or a 500, 502, 503 or 504 (waiting out the
   * `Retry-After` the API sent, up to 30 seconds), but only once this client has
   * seen the API echo a key back as `transactionId`: a server that ignores the
   * header would count a second sending twice, so until then a failure rejects
   * after the first attempt. Without a key it is sent exactly once. A key
   * reused with another value rejects with `TransactionIdReusedError`, and a
   * malformed or empty one, before any request, with `InvalidTransactionIdError`,
   * both through `onError`; see `ReportUsageInput`.
   */
  input: ReportUsageInput;
}

function optimisticStatus(
  unlimited: boolean,
  next: number,
  limit: number,
  ceiling: number,
): ResolvedEntitlement["status"] {
  if (unlimited) return "enabled";
  // Terminal where the server starts refusing; warned about from 80% of what
  // the customer bought, which is what the meter shows.
  if (next >= ceiling) return "over_limit";
  if (limit > 0 && next / limit >= 0.8) return "near_limit";
  return "enabled";
}

/**
 * Returns a copy of the snapshot with the reported entitlement's numeric usage
 * bumped — so the gauge moves immediately, before the server round-trip.
 * The server value reconciles it on the revalidation that follows.
 */
function bumpEntitlementUsage(
  snapshot: LicensingSnapshot | undefined,
  entitlementSlug: string,
  input: ReportUsageInput,
): LicensingSnapshot | undefined {
  // Only numeric usage moves a meter; boolean/config reports leave it untouched.
  if (!snapshot?.entitlements || input.value.type !== "number") return snapshot;
  const delta = input.value.value;

  return {
    ...snapshot,
    entitlements: snapshot.entitlements.map((entitlement) => {
      if (entitlement.slug !== entitlementSlug || entitlement.limitValue.type !== "number") {
        return entitlement;
      }
      const limit = entitlement.limitValue.value;
      const previous =
        entitlement.currentValue?.type === "number" ? entitlement.currentValue.value : 0;
      const next = input.behavior === "set" ? delta : previous + delta;
      const unlimited = entitlement.unlimited ?? limit === -1;
      const ceiling = entitlement.maximumAllowedUsage ?? limit;

      return {
        ...entitlement,
        currentValue: { type: "number", value: next },
        remaining: unlimited ? null : Math.max(ceiling - next, 0),
        percentageUsed: unlimited ? null : limit > 0 ? (next / limit) * 100 : null,
        status: optimisticStatus(unlimited, next, limit, ceiling),
      };
    }),
  };
}

/**
 * Reports usage of an entitlement for the provider's instance, and moves its
 * meter at once.
 *
 * The meter is bumped before the answer arrives, then reconciled with the
 * server's snapshot. A report the API recognises as one it already applied
 * under the same `Idempotency-Key` resolves with `idempotentReplayed: true` and
 * counts nothing: the reconciliation takes the bump back. The answer's
 * `transactionId` is the key the report was accepted under (`null` for a report
 * sent without one), and a replay may carry a `null` `source` or `provenance`.
 * When the API kept the report but dropped its metadata, `metadataDropped` says
 * why.
 */
export function useReportUsage(options?: {
  onSuccess?: (data: ReportUsageResult) => void;
  onError?: (error: Error) => void;
}): UseKaitenMutationResult<ReportUsageArgs, ReportUsageResult> {
  useTrackHook("useReportUsage");

  const { mutate } = useSWRConfig();
  const { client, mode, scopeKey } = useKaitenContext();
  const telemetry = useTelemetry();
  const snapshot = useLicensingSnapshot();
  const resolvedInstanceSlug = snapshot.data?.instance?.slug ?? "";
  // Same key the provider reads the snapshot under — both derive it from the
  // one scopeKey, so an optimistic update cannot miss its target.
  const snapshotKey = kaitenKeys.components.snapshot(scopeKey);

  return useKaitenMutation({
    mutationFn: async ({ entitlementSlug, input }: ReportUsageArgs) => {
      if (mode !== "authenticated") {
        // A customer session in particular: its `kst_` reaches the session's
        // routes and no other, so the report is refused here, before any request.
        throw new Error(
          `useReportUsage is only available in authenticated mode, not under mode="${mode}". ` +
            `Report usage from your backend, with @kaitencloud/server.`,
        );
      }

      if (!resolvedInstanceSlug) {
        throw new Error(
          "useReportUsage requires a loaded licensing snapshot with an instance slug.",
        );
      }

      const reportPromise = client.reportUsage(resolvedInstanceSlug, entitlementSlug, input);

      // Optimistic update. SWR shows the bumped gauge immediately, keeps it
      // while the report is in flight, revalidates against the server on success,
      // and rolls back to the previous snapshot on error. `populateCache: false`
      // because the report returns an `EntitlementUsage`, not the whole snapshot.
      void mutate<LicensingSnapshot | undefined>(
        snapshotKey,
        reportPromise.then(() => undefined),
        {
          optimisticData: (current) => bumpEntitlementUsage(current, entitlementSlug, input),
          populateCache: false,
          rollbackOnError: true,
          revalidate: true,
          // The refusal reaches the caller through `reportPromise`, awaited
          // below. Thrown here too, it was an unhandled rejection on every
          // failed report: a `TransactionIdReusedError` in the host's console.
          throwOnError: false,
        },
      );

      const result = await reportPromise;
      // No once-key: report-usage is the event we want to count on EVERY call.
      telemetry.track({
        type: "action",
        name: "report-usage",
        metadata: { entitlementSlug, value: input.value, behavior: input.behavior },
      });
      return result;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
    // No `revalidateKeys` — the optimistic `mutate` above already revalidates the snapshot.
  });
}
