// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Plan } from "@kaitencloud/client";

// Kaiten's catalogue has no order between plans, so a pricing page chooses one, as a vendor's site
// does. This one goes from the cheapest: the free plans, then the paid plans by their monthly fee,
// then the plans priced on request. Fees in two currencies are not compared: the paid plans of a
// currency stay together, in the order the catalogue first names that currency. Plans the order
// cannot tell apart keep the catalogue's order.

const FREE = 0;
const PAID = 1;
const CUSTOM = 2;

/** Free, paid or priced on request: a plan with no type, or one this page does not know, is paid. */
function rank(plan: Plan): number {
  if (plan.pricingType === "FREE") return FREE;
  if (plan.pricingType === "CUSTOM") return CUSTOM;
  return PAID;
}

/** A plan's lowest fee for a month, in its currency's minor units: of its default fees when it has any. */
function monthlyFee(plan: Plan): { currency: string; amount: number } | null {
  const prices = plan.prices ?? [];
  const fees = prices.some((price) => price.isDefault)
    ? prices.filter((price) => price.isDefault)
    : prices;
  let lowest: { currency: string; amount: number } | null = null;
  for (const price of fees) {
    // `prices` holds flat fees for a month or for a year only (see `PlanPrice`).
    const amount = price.interval === "year" ? price.amount / 12 : price.amount;
    if (!lowest || amount < lowest.amount) {
      lowest = { currency: price.currencyCode ?? plan.currencyCode ?? "", amount };
    }
  }
  return lowest;
}

/** The plans from the cheapest, as this storefront lists them. */
export function cheapestFirst(plans: readonly Plan[]): Plan[] {
  // Only the paid plans are told apart by their fees.
  const fees = plans.map((plan) => (rank(plan) === PAID ? monthlyFee(plan) : null));
  const currencies: string[] = [];
  for (const fee of fees) {
    if (fee && !currencies.includes(fee.currency)) currencies.push(fee.currency);
  }
  const keys = new Map<Plan, readonly [number, number, number]>(
    plans.map((plan, index) => {
      const fee = fees[index];
      if (rank(plan) !== PAID) return [plan, [rank(plan), 0, 0]];
      return fee
        ? [plan, [PAID, currencies.indexOf(fee.currency), fee.amount]]
        : [plan, [PAID, currencies.length, 0]];
    }),
  );
  return plans.slice().sort((left, right) => {
    const a = keys.get(left)!;
    const b = keys.get(right)!;
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
}
