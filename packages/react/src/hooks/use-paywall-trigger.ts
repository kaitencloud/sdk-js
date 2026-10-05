import * as React from "react";

import { useTrackHook } from "../telemetry/context.tsx";
import { useKaitenContext } from "../providers/kaiten-provider.tsx";
import { useEntitlementCheck } from "./use-entitlement-check.ts";
import { useEntitlements } from "./use-kaiten-entitlements.ts";
import { useFlags } from "./use-kaiten-flags.ts";
import { useLicensingSnapshot } from "./use-licensing-snapshot.ts";
import { useLocalization } from "../localization/context.tsx";
import { usageWindowLabel } from "../lib/entitlement-usage-window.ts";
import type { PortalAction } from "../types.ts";

export interface PaywallTriggerOptions {
  threshold?: number;
  flagKey?: string;
  /** Minimum remaining numeric units required (R-?): denies when `remaining < min`. */
  min?: number;
  /**
   * What to do when the entitlement/flag data fails to load. `"block"`
   * (default, fail-closed) shows the paywall so paid content is never revealed
   * during an outage; `"allow"` (fail-open) hides the paywall and reveals the
   * content. The error stays available on `error` either way.
   */
  onError?: "block" | "allow";
}

export interface PaywallTriggerResult {
  shouldShow: boolean;
  reason: "over_limit" | "near_limit" | "not_entitled" | "flag_disabled" | "error" | null;
  current: number;
  limit: number;
  percentage: number;
  /**
   * True only when the decision is driven by a FINITE numeric quota (so the
   * `current`/`limit`/`percentage` and a progress bar are meaningful). False for
   * boolean/config/flag denials and unlimited entitlements — UIs should not draw
   * a 0% meter for "feature not in plan" (R-?, it read as a metering bug).
   */
  metered: boolean;
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
  const flags = useFlags();
  const snapshot = useLicensingSnapshot();
  const { mode } = useKaitenContext();

  // A finite numeric quota is the only case where current/limit/percentage and a
  // progress bar are meaningful (R-?). Boolean/config/flag/unlimited never are.
  const metered = check.entitlement?.limitValue.type === "number" && !check.isUnlimited;
  const usageWindow = check.entitlement ? usageWindowLabel(check.entitlement, localization) : null;

  // Only an authenticated scope has a customer's entitlements. Public mode's
  // snapshot is intentionally empty and static mode has no snapshot at all, so
  // an entitlement check under either always reads "not entitled" and would
  // silently paywall every visitor (R-?). Warn and fail OPEN: gating belongs in
  // authenticated mode; on a marketing page the content should render.
  React.useEffect(() => {
    if (mode !== "authenticated" && process.env.NODE_ENV !== "production") {
      console.warn(
        `[@kaitencloud/react] usePaywallTrigger/Paywall("${entitlementSlug}") is used under mode="${mode}". ` +
          `Only an authenticated <KaitenProvider> has a customer's entitlements, so the paywall is disabled (content shown). ` +
          `Move entitlement gating into an authenticated <KaitenProvider>.`,
      );
    }
  }, [mode, entitlementSlug]);

  return React.useMemo(() => {
    if (mode !== "authenticated") {
      return {
        shouldShow: false,
        reason: null,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered: false,
        usageWindow,
        isLoading: false,
        error: null,
        recommendedAction: undefined,
      };
    }

    if (check.isLoading || flags.isLoading) {
      return {
        shouldShow: false,
        reason: null,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered,
        usageWindow,
        isLoading: true,
        error: null,
        recommendedAction: undefined,
      };
    }

    // Fail policy: on a data error, default to fail-closed (show the paywall
    // so paid content is never revealed during an outage). `onError: "allow"`
    // opts back into fail-open. `reason: "error"` is distinct from a legitimate
    // `not_entitled` so consumers can tell an outage from a real denial.
    if (check.error || flags.error) {
      const failClosed = (options.onError ?? "block") === "block";
      return {
        shouldShow: failClosed,
        reason: failClosed ? ("error" as const) : null,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered,
        usageWindow,
        isLoading: false,
        error: check.error ?? flags.error,
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
    const pickAction = (reason: PaywallTriggerResult["reason"]): PortalAction | undefined => {
      if (entitlement?.actions?.[0]) return entitlement.actions[0];
      const preferred =
        reason === "over_limit" || reason === "near_limit" ? "add_quota" : "upgrade_plan";
      return fallbackActions.find((action) => action.type === preferred) ?? fallbackActions[0];
    };
    const flag = options.flagKey
      ? flags.data?.find((candidate) => candidate.key === options.flagKey)
      : undefined;

    if (options.flagKey && (!flag || flag.enabled === false)) {
      return {
        shouldShow: true,
        reason: "flag_disabled",
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered: false,
        usageWindow,
        isLoading: false,
        error: null,
        recommendedAction: pickAction("flag_disabled"),
      };
    }

    if (!check.allowed) {
      const reason = check.percentage >= 100 ? "over_limit" : "not_entitled";
      return {
        shouldShow: true,
        reason,
        current: check.current,
        limit: check.limit,
        percentage: check.percentage,
        metered,
        usageWindow,
        isLoading: false,
        error: null,
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
        usageWindow,
        isLoading: false,
        error: null,
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
      usageWindow,
      isLoading: false,
      error: null,
      recommendedAction: pickAction(null),
    };
  }, [
    check,
    entitlements.data,
    entitlementSlug,
    flags.data,
    flags.error,
    flags.isLoading,
    metered,
    usageWindow,
    mode,
    options.flagKey,
    options.min,
    options.onError,
    snapshot.data,
    threshold,
  ]);
}
