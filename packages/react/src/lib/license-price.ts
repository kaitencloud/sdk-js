import type { License, Plan, PlanPrice } from "../types.ts";

/**
 * The price of the plan the customer is currently on, or `null`.
 *
 * The portal reads a `License`; prices live on `Plan`. Nothing joined the two,
 * which is why the portal has never shown an amount even when one existed. Both
 * sides travel in the same snapshot and `planFromLicense` builds every plan with
 * `slug = license.slug`, so the join is that slug — no extra request, no new
 * endpoint.
 *
 * Returns `null` rather than a zero whenever an amount cannot be established.
 * Kaiten models no prices server-side today, so that is the normal answer and
 * the caller is expected to render nothing: a fabricated "0.00" on a billing
 * screen is worse than a missing line.
 */
export function resolveLicensePrice(
  license: License | null | undefined,
  plans: Plan[] | null | undefined,
): PlanPrice | null {
  if (!license || !plans?.length) return null;

  const plan = plans.find((candidate) => candidate.slug === license.slug);
  if (!plan) return null;

  const currencyCode = plan.currencyCode;

  // The portal has no interval toggle: the billing interval is a property of the
  // license the customer already holds. Prefer what the license states, fall
  // back to the plan's own interval.
  const interval = license.billingInterval ?? plan.interval;

  if (plan.prices?.length) {
    const matched =
      plan.prices.find((price) => price.interval === interval) ??
      // No interval to match on, or none matching: a single price is
      // unambiguous and safe to show. Several are not — showing one of them
      // would be picking a tariff on the customer's behalf.
      (plan.prices.length === 1 ? plan.prices[0] : undefined);

    if (!matched) return null;
    return {
      amount: matched.amount,
      currencyCode: matched.currencyCode ?? currencyCode,
      interval: matched.interval ?? interval,
      label: matched.label,
    };
  }

  if (interval === "year" && typeof plan.annualPrice === "number") {
    return { amount: plan.annualPrice, currencyCode, interval: "year" };
  }

  if (typeof plan.price === "number") {
    return { amount: plan.price, currencyCode, interval: plan.interval ?? interval };
  }

  return null;
}
