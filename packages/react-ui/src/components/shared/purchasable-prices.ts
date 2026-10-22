// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { BillingPrice, Plan } from "@kaitencloud/react";

import { monthsOf } from "./addon-fee.ts";

/**
 * The prices a customer can buy a plan at: the flat fees of its billing periods that the catalog
 * calls the default of their period, shortest first, and the one the host asks for if it is
 * another. A usage price is never bought on its own, and a fee with no amount cannot be named.
 */
export function purchasablePrices(plan: Plan, chosen: string | undefined): BillingPrice[] {
  return (plan.billingPrices ?? [])
    .filter(
      (price) =>
        price.billingModel === "FLAT_FEE" &&
        price.amount !== undefined &&
        price.interval !== undefined &&
        (price.isDefault || price.id === chosen),
    )
    .sort((a, b) => monthsOf(a) - monthsOf(b));
}

/** The price a checkout starts at: the one asked for, else the monthly fee, else the shortest period. */
export function initialPrice(
  prices: BillingPrice[],
  chosen: string | undefined,
): BillingPrice | null {
  return (
    prices.find((price) => price.id === chosen) ??
    prices.find((price) => monthsOf(price) === 1) ??
    prices[0] ??
    null
  );
}
