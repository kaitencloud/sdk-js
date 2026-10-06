import type { KaitenCatalog, KaitenPortal, LicensingSnapshot } from "../types.ts";

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
 * real. `licenseTerm` stays `null` for the same reason, so it never denies
 * anything here: the portal's entitlements are the server's decision.
 */
export function snapshotFromPortal(
  portal: KaitenPortal,
  catalog: KaitenCatalog | undefined,
): LicensingSnapshot {
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
    branding: catalog?.branding,
  };
}
