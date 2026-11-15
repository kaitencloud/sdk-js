// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Addon, BillingPrice } from "@kaitencloud/react";

// The fee an add-on is billed at beside a plan: the rule the checkout offers add-ons by and the
// portal sells them by, written once. Of an add-on's flat fees, the default one of the billing
// period, in the currency, is the one billed. An add-on version has one currency, and Kaiten
// attaches to a subscription none that is priced in another than the subscription's, nor a paid
// one whose flat fees have no default for the subscription's period. An add-on billed no flat fee
// (metered only, free or custom) has no period to check.

/** How many calendar months a billing period lasts: a quarter is 3, a year 12. */
export const monthsOf = (period: { interval?: string; intervalCount?: number }): number =>
  (period.interval === "year" ? 12 : 1) * (period.intervalCount ?? 1);

/**
 * What an add-on is bought beside: the currency of a plan's price or of a subscription, and how
 * many months its billing period lasts, `null` for a period the SDK cannot read.
 */
export interface AddonSale {
  currencyCode: string;
  months: number | null;
}

/** The sale a plan's price is: its currency and its billing period. */
export const saleOfPrice = (price: BillingPrice): AddonSale => ({
  currencyCode: price.currencyCode,
  months: price.interval ? monthsOf(price) : null,
});

/** The sale a subscription is: its currency and its billing period. */
export const saleOfSubscription = (subscription: {
  currencyCode: string;
  billingInterval?: string;
  intervalCount?: number;
}): AddonSale => ({
  currencyCode: subscription.currencyCode,
  months: subscription.billingInterval
    ? monthsOf({
        interval: subscription.billingInterval,
        intervalCount: subscription.intervalCount,
      })
    : null,
});

/**
 * The prices of an add-on. One in the shape of 1.0, which a host can still hand over, has no
 * `billingPrices` and says its price in `price`, `currencyCode` and `interval`: that is its one
 * default flat fee, by the month when it names no interval, as it is shown. With no `price` it has
 * none.
 */
function pricesOf(addon: Addon): BillingPrice[] {
  if (addon.billingPrices !== undefined) return addon.billingPrices;
  if (typeof addon.price !== "number" || addon.currencyCode === undefined) return [];
  return [
    {
      id: addon.slug,
      amount: addon.price,
      unitAmountDecimal: String(addon.price),
      currencyCode: addon.currencyCode,
      interval: addon.interval ?? "month",
      billingModel: "FLAT_FEE",
      isDefault: true,
    },
  ];
}

/**
 * Whether an add-on is paid. One in the shape of 1.0 names no pricing type: it is paid when it has
 * a price above nothing.
 */
const isPaid = (addon: Addon): boolean =>
  addon.billingPrices === undefined && addon.pricingType === undefined
    ? (addon.price ?? 0) > 0
    : addon.pricingType === "PAID";

/**
 * The default flat fees of an add-on that have an amount, in a currency, or in any with `null`.
 * The catalogue serves ACTIVE prices only, so every one of them is ACTIVE.
 */
function defaultFees(addon: Addon, currencyCode: string | null): BillingPrice[] {
  return pricesOf(addon).filter(
    (price) =>
      price.billingModel === "FLAT_FEE" &&
      price.isDefault &&
      price.amount !== undefined &&
      (currencyCode === null || price.currencyCode === currencyCode),
  );
}

/**
 * The fee an add-on is billed at beside a sale: its default flat fee of the sale's billing period,
 * in the sale's currency. `null` when it has none: one priced in another currency, one with no fee
 * for the period, or one billed no flat fee at all, which {@link attachableTo} tells apart. For a
 * period the SDK cannot read, the currency alone decides.
 */
export function addonFeeFor(addon: Addon, sale: AddonSale): BillingPrice | null {
  const fees = defaultFees(addon, sale.currencyCode);
  if (sale.months === null) return fees[0] ?? null;
  return fees.find((fee) => monthsOf(fee) === sale.months) ?? null;
}

/**
 * Whether Kaiten attaches an add-on to a live subscription that is `sale`. Every price of the add-on
 * is in the subscription's currency, which holds for one with no price, since a version has one
 * currency. A PAID add-on that has flat fees also has a default one for the subscription's billing
 * period; one that is metered only, FREE or CUSTOM is not checked for a period. For a period the
 * SDK cannot read, any default flat fee in the currency will do.
 */
export function attachableTo(addon: Addon, sale: AddonSale): boolean {
  // One in the shape of 1.0 with a price and no currency cannot be told to be in the sale's.
  if (
    addon.billingPrices === undefined &&
    typeof addon.price === "number" &&
    addon.currencyCode === undefined
  ) {
    return false;
  }
  const prices = pricesOf(addon);
  if (prices.some((price) => price.currencyCode !== sale.currencyCode)) return false;
  const fees = prices.filter((price) => price.billingModel === "FLAT_FEE");
  if (!isPaid(addon) || fees.length === 0) return true;
  const defaults = fees.filter((fee) => fee.isDefault);
  if (sale.months === null) return defaults.length > 0;
  return defaults.some((fee) => monthsOf(fee) === sale.months);
}

/**
 * What one unit of an add-on is shown to cost beside a sale: the fee it is billed at, else its
 * first default flat fee in the sale's currency; with no sale, its first default flat fee. `null`
 * when it has none to name, and the caller says no price rather than another.
 */
export function addonUnitPrice(addon: Addon, sale: AddonSale | null): BillingPrice | null {
  if (sale === null) return defaultFees(addon, null)[0] ?? null;
  return addonFeeFor(addon, sale) ?? defaultFees(addon, sale.currencyCode)[0] ?? null;
}
