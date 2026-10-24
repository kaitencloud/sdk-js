// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import {
  formatKaitenPrice,
  usePortal,
  type Addon,
  type KaitenLocalization,
  type KaitenPortalBillingWords,
  type PortalSubscription,
} from "@kaitencloud/react";
import { useKaitenDataContext } from "@kaitencloud/react/internal";

import {
  addonUnitPrice,
  attachableTo,
  saleOfSubscription,
  type AddonSale,
} from "../../shared/addon-fee.ts";
import { getAddonDisplayPrice } from "./addon-price.ts";
import { billingTimingText } from "../../shared/grant-description.ts";

/** One add-on of a customer session's portal, and how many units of it the instance holds. */
export interface SessionAddonRow {
  addon: Addon;
  /**
   * The add-on its fees are read from: the catalogue's of the same version when the catalogue
   * lists it, which carries the fee of every billing period; else `addon`, whose portal entry
   * carries the fee of the subscription's period alone.
   */
  version: Addon;
  /** The quantity the server holds: `0` for an add-on that is offered and not held. */
  quantity: number;
  /** The most one instance may hold, `null` when unbounded. */
  max: number | null;
}

/** The add-ons of a customer session, as the portal and the panel that changes them read them. */
export interface SessionAddOns {
  /** The portal's first read is not in yet. */
  isLoading: boolean;
  /** What the instance holds, in the portal's order. */
  held: SessionAddonRow[];
  /** What the instance holds, then what the catalogue offers beside it: the panel's rows. */
  rows: SessionAddonRow[];
  /** The subscription, live or not: the price of a unit is shown in its currency and period. */
  subscription: PortalSubscription | null;
  /** The subscription that bills a change: `null` when there is none, or it is over. */
  live: PortalSubscription | null;
  /** What `live` bills an add-on beside: its currency and period. `null` without one. */
  sale: AddonSale | null;
}

const NONE: SessionAddonRow[] = [];

/** Metered rates are the API's per-sale-unit prices, never multiplied by add-on quantity. */
export function meteredAddonPrices(
  addon: Addon,
  localization: KaitenLocalization,
  words: KaitenPortalBillingWords,
): { key: string; text: string }[] {
  return (addon.billingPrices ?? []).flatMap((price, index) => {
    if (price.billingModel !== "USAGE_BASED" && price.billingModel !== "OVERAGE") return [];
    const amount = formatKaitenPrice(price, localization);
    if (!amount) return [];
    const timing = billingTimingText(price, words);
    return [{ key: price.id ?? String(index), text: [amount, timing].filter(Boolean).join(" · ") }];
  });
}

/** A scheduled decrease is a second figure: it never replaces the quantity held. */
export function pendingAddonText(
  addon: Addon,
  subscription: PortalSubscription | null,
  words: KaitenPortalBillingWords,
): string | null {
  const pending = addon.pendingQuantity;
  const end = subscription?.currentPeriodEnd;
  if (
    typeof pending !== "number" ||
    !Number.isInteger(pending) ||
    pending < 0 ||
    !end ||
    addon.quantity === undefined ||
    pending >= addon.quantity
  )
    return null;
  return pending === 0
    ? (words.addonPendingRemoval?.(end) ?? null)
    : (words.addonPendingQuantity?.(String(pending), end) ?? null);
}

export function unitTimingText(
  addon: Addon,
  subscription: PortalSubscription | null,
  words: KaitenPortalBillingWords,
): string | null {
  return billingTimingText(
    addonUnitPrice(addon, subscription ? saleOfSubscription(subscription) : null),
    words,
  );
}

/**
 * The add-ons of a customer session's instance: the ones it holds, and the public add-ons of the
 * catalogue that fit its plan and that Kaiten attaches to its subscription, of a family it holds no
 * other version of, when the provider reads the catalogue. An unbound session, and any other mode,
 * has none.
 */
export function useSessionAddOns(): SessionAddOns {
  const portal = usePortal();
  const catalog = useKaitenDataContext().catalog.data;
  const data = portal.data;
  const subscription = data?.subscription ?? null;

  return React.useMemo<SessionAddOns>(() => {
    // A live subscription is offered only what Kaiten attaches to it: an add-on priced in its
    // currency and, for a paid one with flat fees, with a default fee for its billing period.
    // Without one, nothing is billed and nothing is checked.
    const live = subscription && subscription.status !== "CANCELED" ? subscription : null;
    const sale = live ? saleOfSubscription(live) : null;
    if (!data?.instance) {
      return { isLoading: portal.isLoading, held: NONE, rows: NONE, subscription, live, sale };
    }
    const plan = catalog?.plans.find((candidate) => candidate.slug === data.instance?.licenseSlug);
    // A family the instance holds is changed at the version it holds: Kaiten attaches no second
    // version of it, so the catalogue's, when it is another, is not offered beside it.
    const versionHeld = new Map(
      data.addOns.map((addon) => [addon.familySlug, addon.slug] as const),
    );
    const heldSlugs = new Set(data.addOns.map((addon) => addon.slug));
    const offered = (catalog?.addOns ?? []).filter(
      (addon) =>
        !heldSlugs.has(addon.slug) &&
        !!addon.familySlug &&
        !!plan?.compatibleAddonFamilies?.includes(addon.familySlug) &&
        (versionHeld.get(addon.familySlug) ?? addon.slug) === addon.slug &&
        (sale === null || attachableTo(addon, sale)),
    );
    const row = (addon: Addon, quantity: number): SessionAddonRow => ({
      addon,
      version: catalog?.addOns?.find((each) => each.slug === addon.slug) ?? addon,
      quantity,
      max: addon.maxQuantity ?? null,
    });
    const held = data.addOns.map((addon) => row(addon, addon.quantity ?? 0));
    return {
      isLoading: portal.isLoading,
      held,
      rows: [...held, ...offered.map((addon) => row(addon, 0))],
      subscription,
      live,
      sale,
    };
  }, [data, catalog, subscription, portal.isLoading]);
}

/**
 * What one unit of an add-on is shown to cost beside the subscription: the fee it is billed at, else
 * its first default flat fee in the subscription's currency, else the price the add-on names. `null`
 * when it names none.
 */
export function unitPriceText(
  addon: Addon,
  subscription: PortalSubscription | null,
  localization: KaitenLocalization,
): string | null {
  const fee = addonUnitPrice(addon, subscription ? saleOfSubscription(subscription) : null);
  if (fee) return formatKaitenPrice(fee, localization);
  const shown = getAddonDisplayPrice(addon);
  return shown
    ? `${localization.formatMoney(shown.amount, shown.currencyCode)}/${shown.interval}`
    : null;
}
