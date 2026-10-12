import {
  DEFAULT_CURRENCY_CODE,
  type Addon,
  type BillingPrice,
  type CurrencyCode,
} from "@kaitencloud/react";

export interface AddonDisplayPrice {
  /** Minor units (integer). */
  amount: number;
  currencyCode: CurrencyCode;
  interval: string;
}

export function getAddonDisplayPrice(addon: Addon): AddonDisplayPrice | null {
  if (typeof addon.price === "number") {
    return {
      amount: addon.price,
      currencyCode: addon.currencyCode ?? DEFAULT_CURRENCY_CODE,
      interval: addon.interval ?? "month",
    };
  }
  const firstPrice = addon.prices?.[0];
  if (firstPrice && typeof firstPrice.amount === "number") {
    return {
      amount: firstPrice.amount,
      currencyCode: firstPrice.currencyCode ?? addon.currencyCode ?? DEFAULT_CURRENCY_CODE,
      interval: firstPrice.interval ?? addon.interval ?? "month",
    };
  }
  return null;
}

/** How many calendar months a billing period lasts: a quarter is 3, a year 12. */
const monthsOf = (price: { interval?: string; intervalCount?: number }) =>
  (price.interval === "year" ? 12 : 1) * (price.intervalCount ?? 1);

/**
 * What one unit of an add-on costs a subscription: the default flat fee of the subscription's
 * billing period, else the first default flat fee in its currency. `null` when it has none to name,
 * and the caller says no price rather than another.
 */
export function addonUnitPrice(
  addon: Addon,
  subscription: {
    currencyCode: string;
    billingInterval?: string;
    intervalCount?: number;
  } | null,
): BillingPrice | null {
  const fees = (addon.billingPrices ?? []).filter(
    (price) =>
      price.billingModel === "FLAT_FEE" &&
      price.isDefault &&
      price.amount !== undefined &&
      (subscription === null || price.currencyCode === subscription.currencyCode),
  );
  if (subscription?.billingInterval) {
    const months = monthsOf({
      interval: subscription.billingInterval,
      intervalCount: subscription.intervalCount,
    });
    const same = fees.find((price) => monthsOf(price) === months);
    if (same) return same;
  }
  return fees[0] ?? null;
}
