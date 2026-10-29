// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type {
  KaitenCatalog,
  KaitenPortal,
  LicensingSnapshot,
  PortalSubscription,
  PortalTrial,
} from "../types.ts";

/**
 * What the snapshot of a customer session carries beside a `LicensingSnapshot`: the
 * plan the bound instance is on, and its subscription, as the portal names them.
 * Both are `undefined` under any other mode, and `null` on a session bound to the
 * customer only, which has no instance.
 *
 * They are not a `License`: the portal gives a plan its slug and name, not the id,
 * version and type a `License` requires, and a snapshot that made those up would be
 * read as real. `useLicense()` therefore stays empty here, and a component that shows
 * the current plan reads `currentPlan` when it has no licence.
 */
export interface SessionSnapshotMembers {
  /** The licence of the bound instance: its slug, which is a plan's slug, and its name. */
  currentPlan?: { slug: string; name: string } | null;
  /**
   * The bound instance's subscription: its status, its base price, the end of the
   * current period (`currentPeriodEnd`, `billingInterval`, `intervalCount`), whether it
   * ends there (`cancelAtPeriodEnd`) and any plan change scheduled (`scheduledChange`).
   */
  subscription?: PortalSubscription | null;
  /**
   * The trial the bound instance is in: when it ends, what its end charges and the card it goes
   * to. `null` outside a trial; absent under any other mode, and from a server that does not
   * serve it.
   */
  trial?: PortalTrial | null;
}

/**
 * The licensing snapshot of a customer session: its portal, with the plans of
 * the catalog beside it.
 *
 * Every member the hooks gate on is the portal's own: the effective
 * entitlements (the licence grant with its add-ons and voucher boosts applied,
 * and its usage), the add-ons the instance holds and the billing capabilities.
 * Nothing commercial is made up here — no credit, no action.
 *
 * `customer`, `instance` and `license` stay `null`. The portal names them, but
 * the SDK's `Customer`, `Instance` and `License` carry ids, audit fields and
 * dates the portal does not, and a snapshot with invented ones would be read as
 * real. `licenseTerm` stays `null` for the same reason, and shows no term: it
 * is information in any case, and the portal's entitlements are the server's
 * decision. What the portal does say about the plan and the subscription is in
 * `currentPlan` and `subscription`, as it says it.
 */
export function snapshotFromPortal(
  portal: KaitenPortal,
  catalog: KaitenCatalog | undefined,
): LicensingSnapshot & SessionSnapshotMembers {
  const { instance } = portal;
  return {
    source: "snapshot",
    updatedAt: portal.updatedAt,
    customer: null,
    instance: null,
    license: null,
    licenseTerm: null,
    plans: catalog?.plans ?? [],
    addOns: portal.addOns,
    credits: [],
    entitlements: portal.entitlements,
    flags: [],
    actions: [],
    capabilities: portal.capabilities,
    // Prefer the session's capability; the catalogue fills it in on older portals.
    branding: portal.branding ?? catalog?.branding,
    currentPlan: instance && { slug: instance.licenseSlug, name: instance.licenseName },
    subscription: portal.subscription,
    ...(portal.trial !== undefined ? { trial: portal.trial } : {}),
  };
}
