// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useTrackHook } from "../telemetry/context.tsx";
import { useKaitenContext, useKaitenDataContext } from "../providers/kaiten-provider.tsx";
import { useEntitlementCheck } from "./use-entitlement-check.ts";
import { useEntitlements } from "./use-kaiten-entitlements.ts";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import { useLocalization } from "../localization/context.tsx";
import { usageWindowLabel } from "../lib/entitlement-usage-window.ts";
import { isProduction } from "../lib/production.ts";
import type { PortalAction } from "../types.ts";

export interface PaywallTriggerOptions {
  threshold?: number;
  /** Minimum remaining numeric units required (R-?): denies when `remaining < min`. */
  min?: number;
  /**
   * What to do when there is no entitlement data to decide on: no read ever
   * succeeded, or reads have been failing for longer than the provider's
   * `staleIfErrorMs`, or the usage of the quota could not be read
   * (`usage_unavailable`). `"block"` (default, fail-closed) shows the paywall, so
   * paid content is never revealed to a customer nothing was read for;
   * `"allow"` (fail-open) hides the paywall and reveals the content. The error
   * stays available on `error` either way.
   *
   * A read that fails after one that succeeded is not that case: the paywall
   * is decided on the data that read left, with the failure on `error`.
   */
  onError?: "block" | "allow";
}

/**
 * Why a paywall shows.
 *
 * - `over_limit`: the quota is used up.
 * - `insufficient_quota`: the quota has some left, but less than the `min` asked for.
 * - `near_limit`: past the threshold, still allowed.
 * - `not_entitled`: the plan does not include it.
 * - `usage_unavailable`: the quota is granted, but its usage could not be read, and
 *   the policy is to block.
 * - `error`: there is no entitlement data to decide on, and the policy is to block.
 *
 * The union is open: a minor release may name more, for instance when Kaiten
 * restricts or suspends an instance for non-payment. Handle a reason you do not know
 * as a wall, not as an error: `shouldShow` and `GateState.blocked` already say
 * whether one is up.
 */
export type PaywallReason =
  | "over_limit"
  | "insufficient_quota"
  | "near_limit"
  | "not_entitled"
  | "usage_unavailable"
  | "error"
  | (string & {});

export interface PaywallTriggerResult {
  shouldShow: boolean;
  /** Why the paywall shows, or `null` when it does not. */
  reason: PaywallReason | null;
  current: number;
  limit: number;
  percentage: number;
  /**
   * True only when the decision is driven by a FINITE numeric quota (so the
   * `current`/`limit`/`percentage` and a progress bar are meaningful). False for
   * boolean/config denials, unlimited entitlements and a quota whose usage could
   * not be read — UIs should not draw a 0% meter for "feature not in plan" (it
   * read as a metering bug), nor a zero for a usage nobody knows.
   */
  metered: boolean;
  /**
   * What the quota has left before the server refuses, or `null` when there is no finite
   * quota or its usage could not be read. With `insufficient_quota`, it is less than the
   * `min` asked for.
   */
  remaining?: number | null;
  /**
   * The window this quota is counted in, already localized — or `null` when
   * there is nothing truthful to say (no numeric cap, or a scope nobody read).
   *
   * At the cap, a lifetime counter means *buy more* and a periodic one means
   * *wait*. A paywall that does not draw the distinction leaves the reader with
   * no action, which is why it travels with the trigger rather than being left
   * for each host to re-derive.
   */
  usageWindow: string | null;
  isLoading: boolean;
  /**
   * The error of the last read of the entitlements, when it failed. With
   * `reason: "error"`, there was nothing to decide on. With any other reason, or
   * none, the decision was made on the data an earlier read left.
   */
  error: Error | null;
  recommendedAction?: PortalAction;
}

export function usePaywallTrigger(
  entitlementSlug: string,
  thresholdOrOptions: number | PaywallTriggerOptions = 0.8,
): PaywallTriggerResult {
  useTrackHook("usePaywallTrigger");

  const options =
    typeof thresholdOrOptions === "number" ? { threshold: thresholdOrOptions } : thresholdOrOptions;
  const threshold = options.threshold ?? 0.8;
  const check = useEntitlementCheck(entitlementSlug, { min: options.min });
  const localization = useLocalization();
  const entitlements = useEntitlements();
  const snapshot = useLicensingSnapshot();
  const { mode } = useKaitenContext();
  // The entitlements come from the read a customer's scope lives on: its
  // `failed` says whether there is anything to decide them on.
  const { failed } = useKaitenDataContext();
  // A customer's scope: an authenticated provider's snapshot, or a customer
  // session's portal, whose entitlements are already effective (add-ons and
  // voucher boosts applied), so the wall gates on what the server enforces.
  const gates = mode === "authenticated" || mode === "customer-session";

  // A finite numeric quota is the only case where current/limit/percentage and a
  // progress bar are meaningful (R-?). Boolean/config/flag/unlimited never are, and
  // neither is a quota whose usage could not be read: its `current` is no figure.
  const quota = check.entitlement?.limitValue.type === "number" && !check.isUnlimited;
  const usageUnread = quota && check.entitlement?.usageUnavailable === true;
  const metered = quota && !usageUnread;
  const remaining = check.remaining;
  const usageWindow = check.entitlement ? usageWindowLabel(check.entitlement, localization) : null;

  // Only a customer's scope has a customer's entitlements. Public mode's
  // snapshot is intentionally empty and static mode has no snapshot at all, so
  // an entitlement check under either always reads "not entitled" and would
  // silently paywall every visitor (R-?). Warn and fail OPEN: gating belongs in
  // a customer's scope; on a marketing page the content should render.
  React.useEffect(() => {
    if (!gates && !isProduction()) {
      console.warn(
        `[@kaitencloud/react] usePaywallTrigger/Paywall("${entitlementSlug}") is used under mode="${mode}". ` +
          `Only an authenticated or customer-session <KaitenProvider> has a customer's entitlements, so the paywall is disabled (content shown). ` +
          `Move entitlement gating into one of them.`,
      );
    }
  }, [gates, mode, entitlementSlug]);

  return React.useMemo(() => {
    if (!gates) {
      return {
        shouldShow: false,
        reason: null,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered: false,
        remaining,
        usageWindow,
        isLoading: false,
        error: null,
        recommendedAction: undefined,
      };
    }

    if (check.isLoading) {
      return {
        shouldShow: false,
        reason: null,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered,
        remaining,
        usageWindow,
        isLoading: true,
        error: null,
        recommendedAction: undefined,
      };
    }

    // Fail policy: on an error with nothing to decide on, default to
    // fail-closed (show the paywall so paid content is never revealed during an
    // outage). `onError: "allow"` opts back into fail-open. `reason: "error"` is
    // distinct from a legitimate `not_entitled` so consumers can tell an outage
    // from a real denial. An error beside data a read left is not this case:
    // the branches below decide on that data, and report the error with it.
    if (check.error && failed) {
      const failClosed = (options.onError ?? "block") === "block";
      return {
        shouldShow: failClosed,
        reason: failClosed ? ("error" as const) : null,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered,
        remaining,
        usageWindow,
        isLoading: false,
        error: check.error,
        recommendedAction: undefined,
      };
    }

    // The quota is granted and its usage could not be read: there is nothing to
    // decide on either, so the same policy applies. It is no reason to sell anything.
    if (usageUnread) {
      const failClosed = (options.onError ?? "block") === "block";
      return {
        shouldShow: failClosed,
        reason: failClosed ? ("usage_unavailable" as const) : null,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered,
        remaining,
        usageWindow,
        isLoading: false,
        error: check.error,
        recommendedAction: undefined,
      };
    }

    const entitlement = entitlements.data?.find((candidate) => candidate.slug === entitlementSlug);
    // recommendedAction: the entitlement's own action if any, else fall
    // back to a snapshot-level portal action chosen by reason — limit problems
    // suggest "add quota", access problems suggest "upgrade". Before, the
    // entitlement never carried actions so this was always `undefined` and the
    // CTA was always the generic "Upgrade".
    const fallbackActions = snapshot.data?.actions ?? [];
    const pickAction = (reason: PaywallReason | null): PortalAction | undefined => {
      if (entitlement?.actions?.[0]) return entitlement.actions[0];
      const preferred =
        reason === "over_limit" || reason === "insufficient_quota" || reason === "near_limit"
          ? "add_quota"
          : "upgrade_plan";
      return fallbackActions.find((action) => action.type === preferred) ?? fallbackActions[0];
    };
    if (!check.allowed) {
      // A finite quota that refuses is one that ran out, or one with less left than
      // the `min` asked for. Only a grant of nothing, or a feature that is off, is
      // one the plan does not include.
      const reason: PaywallReason =
        !metered || check.limit <= 0
          ? "not_entitled"
          : typeof options.min === "number" && (remaining ?? 0) > 0
            ? "insufficient_quota"
            : "over_limit";
      return {
        shouldShow: true,
        reason,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered,
        remaining,
        usageWindow,
        isLoading: false,
        error: check.error,
        recommendedAction: pickAction(reason),
      };
    }

    if (check.percentage >= threshold * 100) {
      return {
        shouldShow: true,
        reason: "near_limit" as const,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered,
        remaining,
        usageWindow,
        isLoading: false,
        error: check.error,
        recommendedAction: pickAction("near_limit"),
      };
    }

    return {
      shouldShow: false,
      reason: null,
      current: check.current,
      limit: check.limit,
      percentage: check.percentage,
      metered,
      remaining,
      usageWindow,
      isLoading: false,
      error: check.error,
      recommendedAction: pickAction(null),
    };
  }, [
    check,
    entitlements.data,
    entitlementSlug,
    failed,
    metered,
    remaining,
    usageUnread,
    usageWindow,
    gates,
    options.min,
    options.onError,
    snapshot.data,
    threshold,
  ]);
}
