"use client";

import * as React from "react";

import { usePaywallTrigger } from "../../hooks/use-paywall-trigger.ts";
import { useKaitenAvailable } from "../../providers/kaiten-provider.tsx";

export interface GateState {
  /** The guarded action may proceed. */
  allowed: boolean;
  /** The quota is exhausted, or the plan does not include this at all. */
  blocked: boolean;
  /** Past the warning threshold but still allowed — the moment to nudge. */
  warning: boolean;
  reason: "over_limit" | "near_limit" | "not_entitled" | "flag_disabled" | "error" | null;
  current: number;
  limit: number;
  percentage: number;
  /**
   * False for boolean, config and unlimited entitlements, and for flag denials.
   * When false, `current`/`limit`/`percentage` describe nothing — do not draw a
   * meter, it reads as a metering bug rather than "not in your plan".
   */
  metered: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * What a call site sees when Kaiten is not mounted at all: everything allowed,
 * nothing metered. A host that has not wired Kaiten is not monetising yet, so
 * its own product must not gate itself.
 */
const OPEN: GateState = {
  allowed: true,
  blocked: false,
  warning: false,
  reason: null,
  current: 0,
  limit: 0,
  percentage: 0,
  metered: false,
  isLoading: false,
  error: null,
};

export interface GateProps {
  /** Entitlement slug from your Kaiten catalog, e.g. `seats`. */
  entitlement: string;
  /** Also require this flag to be enabled. */
  flagKey?: string;
  /** Minimum remaining units the action needs — gate a bulk import on `min`. */
  min?: number;
  /** Fraction of the quota at which `warning` turns true. Defaults to `0.8`. */
  threshold?: number;
  /**
   * What to do when entitlement data cannot be loaded. `"block"` (default) is
   * fail-closed, so paid capacity is never handed out during an outage;
   * `"allow"` is fail-open. Either way the error stays on `state.error`.
   */
  onError?: "block" | "allow";
  children: (state: GateState) => React.ReactNode;
}

function ActiveGate({ entitlement, flagKey, min, threshold, onError, children }: GateProps) {
  const trigger = usePaywallTrigger(entitlement, { threshold, flagKey, min, onError });

  const state = React.useMemo<GateState>(() => {
    // While the snapshot is in flight the gate stays open. A spinner on every
    // guarded button costs more than letting a call through that the API will
    // reject on its own — the server is the enforcement point, this is the hint.
    if (trigger.isLoading) {
      return { ...OPEN, isLoading: true };
    }

    const blocked =
      trigger.reason === "over_limit" ||
      trigger.reason === "not_entitled" ||
      trigger.reason === "flag_disabled" ||
      trigger.reason === "error";

    return {
      allowed: !blocked,
      blocked,
      warning: trigger.reason === "near_limit",
      reason: trigger.reason,
      current: trigger.current,
      limit: trigger.limit,
      percentage: trigger.percentage,
      metered: trigger.metered,
      isLoading: false,
      error: trigger.error,
    };
  }, [trigger]);

  return children(state);
}

/**
 * Reports how much of an entitlement is left, so a host can render its own
 * disabled button, quota badge or upsell in its own design system.
 *
 * `Show` answers a yes/no question and `Paywall` renders Kaiten's own wall;
 * `Gate` is the headless middle — it always renders, and hands you the numbers.
 *
 * It is also safe outside a `<KaitenProvider>`, where every other hook throws:
 * the gate simply reports everything as allowed. That is what lets a host roll
 * Kaiten out behind a flag without forking each call site.
 *
 * ```tsx
 * <Gate entitlement="seats">
 *   {({ blocked, warning, current, limit }) => (
 *     <>
 *       {(blocked || warning) && <Badge>{current} / {limit} seats</Badge>}
 *       <Button disabled={blocked}>Invite teammate</Button>
 *     </>
 *   )}
 * </Gate>
 * ```
 */
export function Gate(props: GateProps) {
  // Not a conditional hook: `useKaitenAvailable` runs every render, and the
  // branch picks which *component* renders below. ActiveGate is the only one
  // that calls entitlement hooks.
  const available = useKaitenAvailable();

  if (!available) {
    return props.children(OPEN);
  }

  return <ActiveGate {...props} />;
}
