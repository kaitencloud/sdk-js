import { DEFAULT_CURRENCY_CODE } from "../localization/money.ts";
import type { KaitenLocalization } from "../localization/types.ts";
import type {
  BillingInterval,
  BillingPrice,
  CurrencyCode,
  License,
  Plan,
  PlanEntitlement,
  PlanPrice,
} from "../types.ts";

/**
 * Whether a price reads as "per month" or "per year": a flat fee billed every
 * single `interval` (any interval when none is given).
 *
 * A quarterly price is `interval: "month"` with `intervalCount: 3`, and a
 * metered one is a `USAGE_BASED` or `OVERAGE` price: shown under "/ month",
 * the first would be read as a third of what it is, and the second as the
 * whole bill. A price with no `billingModel`, as a host may write one, is a
 * flat fee.
 */
export function isHeadlinePrice(price: PlanPrice, interval?: BillingInterval): boolean {
  return (
    (interval === undefined || price.interval === interval) &&
    (price.intervalCount ?? 1) === 1 &&
    (price.billingModel ?? "FLAT_FEE") === "FLAT_FEE"
  );
}

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
      plan.prices.find((price) => price.interval === interval && isHeadlinePrice(price)) ??
      // No interval to match on, or none matching: a single price is
      // unambiguous and safe to show. Several are not — showing one of them
      // would be picking a tariff on the customer's behalf. Nor is a single
      // quarterly or metered price, which would read as a monthly one.
      (plan.prices.length === 1 && isHeadlinePrice(plan.prices[0]!) ? plan.prices[0] : undefined);

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

/** Any price the SDK carries: the 1.0-typed `PlanPrice`, or a `BillingPrice`. */
type AnyPrice = PlanPrice | BillingPrice;

/**
 * A price, cut where a card draws it: the amount, and what the amount is for.
 *
 * `attached` says the suffix is written against the amount ("€49.00/month"), and
 * is not a phrase of its own ("€135.00 every 3 months", "€2.00 per 1M tokens").
 */
export interface KaitenPriceParts {
  amount: string;
  suffix: string;
  attached: boolean;
}

/** The unit a usage price is per: its sale unit, else the entitlement's unit, else "unit". */
function meteredUnit(
  price: AnyPrice,
  entitlements: readonly PlanEntitlement[] | undefined,
  localization: KaitenLocalization,
): string {
  const entitlement = entitlements?.find((entry) => entry.slug === price.meteredEntitlementSlug);
  const factor = price.saleUnitFactor;

  // The sale unit the price names: "1M tokens", one of which the amount buys.
  const saleUnit =
    (price as Partial<BillingPrice>).saleUnitSingular ?? entitlement?.saleUnitSingular;
  if (saleUnit) return saleUnit;

  const single = entitlement?.unitSingular ?? entitlement?.unitPlural;
  if (!single) return localization.price.unit;
  // A sale unit of several measured units with no name of its own is spelled out.
  if (typeof factor === "number" && factor > 1) {
    return `${factor} ${entitlement?.unitPlural ?? single}`;
  }
  return single;
}

/**
 * The parts of a price's label, or `null` when the price cannot be written
 * without guessing: it has no amount, or it is neither a flat fee nor a usage price
 * the SDK knows. The currency is the price's, else `options.currencyCode`, else the
 * default one, as `formatKaitenMoney` has it.
 *
 * A flat fee is per billing period: "/month", "/year", and "every 3 months" for a
 * quarterly one. A usage or overage price is per sale unit: "per 1M tokens". An
 * amount below one minor unit (`unitAmountDecimal` `"0.0002"`) is written whole:
 * "€0.000002 per call", never rounded to "€0.00".
 */
export function kaitenPriceParts(
  price: AnyPrice,
  localization: KaitenLocalization,
  options: { currencyCode?: CurrencyCode; entitlements?: readonly PlanEntitlement[] } = {},
): KaitenPriceParts | null {
  const currencyCode = price.currencyCode ?? options.currencyCode ?? DEFAULT_CURRENCY_CODE;
  const model = price.billingModel ?? "FLAT_FEE";

  // An integer is a whole number of minor units, whatever else the price says; any
  // other amount is only in the exact decimal.
  const amount =
    typeof price.amount === "number"
      ? price.amount
      : price.unitAmountDecimal !== undefined
        ? price.unitAmountDecimal
        : undefined;
  if (amount === undefined) return null;
  const shown = localization.formatMoney(amount, currencyCode);

  const words = localization.price;
  if (model === "USAGE_BASED" || model === "OVERAGE") {
    const unit = meteredUnit(price, options.entitlements, localization);
    return { amount: shown, suffix: words.perUnit.replace("{unit}", unit), attached: false };
  }
  if (model !== "FLAT_FEE") return null;

  if (price.interval === undefined || price.interval === "one_time") {
    return { amount: shown, suffix: "", attached: true };
  }
  const count = price.intervalCount ?? 1;
  const year = price.interval === "year";
  return count === 1
    ? { amount: shown, suffix: year ? words.perYear : words.perMonth, attached: true }
    : {
        amount: shown,
        suffix: (year ? words.everyYears : words.everyMonths).replace("{n}", String(count)),
        attached: false,
      };
}

/**
 * A price as a line of text: "€49.00/month", "€135.00 every 3 months",
 * "€2.00 per 1M tokens", "€0.000002 per call". `null` when it cannot be written
 * without guessing (see {@link kaitenPriceParts}).
 *
 * Pass the entitlements of the plan or add-on the price belongs to, so that a usage
 * price names the unit of the entitlement it meters ("per call") when the price
 * names no sale unit of its own. `Plan.price` is the headline; a usage price is
 * never added into it, and never shown as one.
 *
 * ```tsx
 * const localization = useLocalization();
 * plan.billingPrices?.map((price) =>
 *   formatKaitenPrice(price, localization, { entitlements: plan.entitlements }),
 * );
 * ```
 *
 * @experimental Until Kaiten billing ships (see STABILITY.md).
 */
export function formatKaitenPrice(
  price: AnyPrice,
  localization: KaitenLocalization,
  options: { currencyCode?: CurrencyCode; entitlements?: readonly PlanEntitlement[] } = {},
): string | null {
  const parts = kaitenPriceParts(price, localization, options);
  if (!parts) return null;
  if (!parts.suffix) return parts.amount;
  return parts.attached ? `${parts.amount}${parts.suffix}` : `${parts.amount} ${parts.suffix}`;
}
