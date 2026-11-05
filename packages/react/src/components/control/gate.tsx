// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

"use client";

import * as React from "react";

import { usePaywallTrigger, type PaywallReason } from "../../hooks/use-paywall-trigger.ts";
import type { EntitlementProvenance, ResolvedEntitlement } from "../../types.ts";
import { useEntitlements } from "../../hooks/use-kaiten-entitlements.ts";
import { useKaitenAvailable } from "../../providers/kaiten-provider.tsx";

export interface GateState {
  /** The guarded action may proceed. */
  allowed: boolean;
  /** The quota is exhausted, or the plan does not include this at all. */
  blocked: boolean;
  /** Past the warning threshold but still allowed — the moment to nudge. */
  warning: boolean;
  /** Why the gate is not plainly open: see {@link PaywallReason}, which is open. */
  reason: PaywallReason | null;
  current: number;
  limit: number;
  percentage: number;
  /**
   * False for boolean, config and unlimited entitlements.
   * When false, `current`/`limit`/`percentage` describe nothing — do not draw a
   * meter, it reads as a metering bug rather than "not in your plan".
   */
  metered: boolean;
  /**
   * The layer that grants the entitlement: the licence, or an add-on when only an add-on
   * does. Absent while loading and when no entitlement has the slug.
   */
  source?: ResolvedEntitlement["source"];
  /**
   * Why `limit` is what it is: the licence's grant, the add-ons, the voucher boosts and the
   * arithmetic, enough for "(100,000 base) × 2 voucher = 200,000". Only a customer
   * session's portal carries it.
   */
  provenance?: EntitlementProvenance;
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

function ActiveGate({ entitlement, min, threshold, onError, children }: GateProps) {
  const trigger = usePaywallTrigger(entitlement, { threshold, min, onError });
  const granted = useEntitlements().data?.find((candidate) => candidate.slug === entitlement);

  const state = React.useMemo<GateState>(() => {
    // While the snapshot is in flight the gate stays open. A spinner on every
    // guarded button costs more than letting a call through that the API will
    // reject on its own — the server is the enforcement point, this is the hint.
    if (trigger.isLoading) {
      return { ...OPEN, isLoading: true };
    }

    // A wall that is up and is not the nudge before the limit blocks, whatever its
    // reason: the reasons are open, and a gate that listed the blocking ones would
    // let through a reason it had never heard of.
    const blocked = trigger.shouldShow && trigger.reason !== "near_limit";

    return {
      allowed: !blocked,
      blocked,
      warning: trigger.reason === "near_limit",
      reason: trigger.reason,
      current: trigger.current,
      limit: trigger.limit,
      percentage: trigger.percentage,
      metered: trigger.metered,
      source: granted?.source,
      provenance: granted?.provenance,
      isLoading: false,
      error: trigger.error,
    };
  }, [trigger, granted]);

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
