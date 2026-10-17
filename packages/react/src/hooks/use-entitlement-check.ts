// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import type { ResolvedEntitlement } from "../types.ts";
import { useTrackHook } from "../telemetry/context.tsx";
import { useKaitenContext } from "../providers/kaiten-provider.tsx";
import { warnUnknownEntitlement } from "../lib/unknown-entitlement.ts";
import { useEntitlements } from "./use-kaiten-entitlements.ts";

export interface EntitlementCheckOptions {
  /** Minimum remaining numeric units required for NUMBER entitlements. */
  min?: number;
}

export interface EntitlementCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  percentage: number;
  percentageUsed: number | null;
  remaining: number | null;
  /**
   * True when the entitlement's numeric limit is the "unlimited" sentinel
   * (a negative value). Unlimited entitlements are always `allowed`, have a
   * `null` `remaining`, and never drive a paywall.
   */
  isUnlimited: boolean;
  entitlement: ResolvedEntitlement | null;
  isLoading: boolean;
  error: Error | null;
}

export function useEntitlementCheck(
  entitlementSlug: string,
  options?: EntitlementCheckOptions,
): EntitlementCheckResult {
  useTrackHook("useEntitlementCheck");

  const entitlements = useEntitlements();
  const { mode } = useKaitenContext();
  const min = options?.min;

  // A slug the org doesn't define answers `allowed: false` — right, and
  // indistinguishable from a real denial, so a typo reads as a feature that is
  // simply off. Only a customer's scope has a list to check against (an
  // authenticated one, or a customer session's portal): public and static
  // providers have no customer, so their empty list says nothing about the
  // slug, and `usePaywallTrigger` already names the mode.
  React.useEffect(() => {
    warnUnknownEntitlement({
      hook: "useEntitlementCheck",
      slug: entitlementSlug,
      known:
        mode === "authenticated" || mode === "customer-session"
          ? entitlements.data?.map((candidate) => candidate.slug)
          : undefined,
      isLoading: entitlements.isLoading,
      error: entitlements.error,
    });
  }, [entitlementSlug, entitlements.data, entitlements.error, entitlements.isLoading, mode]);

  return React.useMemo(() => {
    const isLoading = entitlements.isLoading;
    const error = entitlements.error;
    const entitlement = entitlements.data?.find((candidate) => candidate.slug === entitlementSlug);

    if (!entitlement) {
      return {
        allowed: false,
        current: 0,
        limit: 0,
        percentage: 0,
        percentageUsed: null,
        remaining: null,
        isUnlimited: false,
        entitlement: null,
        isLoading,
        error,
      };
    }

    // What the entitlement says decides, and nothing else: the instance's licence
    // term (`snapshot.licenseTerm`) is information for a screen to show. Billing
    // never moves `endLicenseDate`, so a gate that read it would close on a
    // customer whose subscription renewed, and whom the server still serves. The
    // server enforces; the SDK only reflects what it enforces.
    if (entitlement.limitValue.type === "boolean") {
      return {
        allowed: entitlement.limitValue.value === true,
        current: entitlement.limitValue.value ? 1 : 0,
        limit: 1,
        percentage: entitlement.limitValue.value ? 100 : 0,
        percentageUsed: entitlement.percentageUsed ?? (entitlement.limitValue.value ? 100 : 0),
        remaining: null,
        isUnlimited: false,
        entitlement,
        isLoading,
        error,
      };
    }

    if (entitlement.limitValue.type === "number") {
      const limit = entitlement.limitValue.value;
      const current =
        entitlement.currentValue?.type === "number" ? entitlement.currentValue.value : 0;

      // Unlimited: always allowed, no cap to measure against. Prefer the
      // server-computed flag (exact reporter semantics) over the raw sentinel.
      if (entitlement.unlimited ?? limit === -1) {
        return {
          allowed: true,
          current,
          limit,
          percentage: 0,
          percentageUsed: null,
          remaining: null,
          isUnlimited: true,
          entitlement,
          isLoading,
          error,
        };
      }

      // The grant is known, its consumption is not (the usage read failed).
      // `current` would otherwise default to 0 and answer "allowed" for every
      // capped entitlement at once. Fail closed, the same way an entitlement
      // this license does not grant already does.
      if (entitlement.usageUnavailable) {
        return {
          allowed: false,
          current: 0,
          limit,
          percentage: 0,
          percentageUsed: null,
          remaining: null,
          isUnlimited: false,
          entitlement,
          isLoading,
          error,
        };
      }

      // The meter reads against what was bought; the gate reads against what
      // the server accepts, which a soft limit puts higher.
      const ceiling = entitlement.maximumAllowedUsage ?? limit;
      const percentage = limit > 0 ? (current / limit) * 100 : 0;
      const remaining =
        typeof entitlement.remaining === "number"
          ? entitlement.remaining
          : Math.max(ceiling - current, 0);
      const requiredRemaining = typeof min === "number" ? Math.max(min, 0) : undefined;

      return {
        allowed:
          requiredRemaining === undefined ? current < ceiling : remaining >= requiredRemaining,
        current,
        limit,
        percentage,
        percentageUsed: entitlement.percentageUsed ?? percentage,
        remaining,
        isUnlimited: false,
        entitlement,
        isLoading,
        error,
      };
    }

    // CONFIG type -- always allowed (presence check)
    return {
      allowed: true,
      current: 0,
      limit: 0,
      percentage: 0,
      percentageUsed: entitlement.percentageUsed ?? null,
      remaining: null,
      isUnlimited: false,
      entitlement,
      isLoading,
      error,
    };
  }, [entitlementSlug, entitlements.data, entitlements.error, entitlements.isLoading, min]);
}
