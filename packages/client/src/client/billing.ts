// Maps the payloads of the public billing routes onto the SDK's types.
//
// The API speaks its own money and period vocabulary (`currency`, integer
// `unitAmount` beside a decimal `unitAmountDecimal`, `billingPeriod`); the SDK's
// types, fixed by `@kaitencloud/client` 1.0, speak another (`currencyCode`,
// `amount`, `interval`). The rules are the API's SDK contract: the amount is
// never scaled or rounded, a price that is not a whole number of minor units
// never gets an `amount`, and quarterly and semi-annual periods are months
// with an `intervalCount`. Members the two vocabularies share are passed
// through as the API sends them.

import type {
  Addon,
  BillingInterval,
  BillingPrice,
  EntitlementValue,
  KaitenCatalog,
  Plan,
  PlanEntitlement,
  PlanPrice,
} from "./types.ts";
import { normalizeBrandingCapability } from "./normalize.ts";

/** A JSON object of a billing payload, whose shape the API's contract fixes. */
type Raw = Record<string, any>;

const list = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === "object" && entry !== null) : [];

/** The API's billing periods, as the SDK's interval and interval count. */
const PERIODS: Record<string, { interval: BillingInterval; intervalCount?: number }> = {
  MONTHLY: { interval: "month" },
  QUARTERLY: { interval: "month", intervalCount: 3 },
  SEMI_ANNUAL: { interval: "month", intervalCount: 6 },
  ANNUAL: { interval: "year" },
};

/**
 * The interval of an API billing period. An unknown period, or none (a metered
 * price), yields none: such a price stays out of every interval-keyed reading.
 */
export const billingInterval = (period: unknown) =>
  typeof period === "string" ? PERIODS[period] : undefined;

/** An API `Price` as a `BillingPrice`. */
export function mapBillingPrice(raw: Raw, fallbackCurrency?: string): BillingPrice {
  const { unitAmount, metered, displayLabel } = raw;
  const price: BillingPrice = {
    id: raw.id,
    unitAmountDecimal: raw.unitAmountDecimal ?? `${unitAmount}`,
    currencyCode: raw.currency ?? fallbackCurrency,
    // No model, no headline: an unknown price is never taken for a flat fee.
    billingModel: raw.billingModel ?? "",
    isDefault: raw.isDefault === true,
    ...billingInterval(raw.billingPeriod),
  };
  // `unitAmount` is present exactly when the price is a whole number of minor
  // units. It is taken as it is: never multiplied, divided or rounded.
  if (Number.isSafeInteger(unitAmount)) price.amount = unitAmount;
  if (displayLabel != null) price.label = displayLabel;
  if (metered) {
    price.meteredEntitlementSlug = metered.entitlementSlug;
    price.saleUnitFactor = metered.saleUnitFactor;
    price.saleUnitSingular = metered.saleUnitSingular ?? null;
    price.saleUnitPlural = metered.saleUnitPlural ?? null;
  }
  return price;
}

/**
 * The 1.0-typed view of a price list: the default monthly and annual flat fees,
 * in that order, when their amount is an integer. Every other price is in
 * `billingPrices` only, so a consumer written against 1.0 — which reads
 * `interval === "month"` as per month, and `amount` as the whole price — never
 * shows a quarterly fee as monthly nor a per-token price as a flat one.
 */
function headlinePrices(prices: readonly BillingPrice[]): (PlanPrice | undefined)[] {
  return (["month", "year"] as const).map((interval) =>
    prices.find(
      (price): price is BillingPrice & PlanPrice =>
        price.isDefault &&
        price.billingModel === "FLAT_FEE" &&
        price.interval === interval &&
        !price.intervalCount &&
        price.amount !== undefined,
    ),
  );
}

/**
 * An entitlement value from a billing payload, which carries the bare value
 * (`100000`, `true`) beside its `type`, as the SDK's tagged `EntitlementValue`.
 * A value that already carries its tag is kept as it is.
 */
export function entitlementValue(value: unknown): EntitlementValue {
  if (typeof value === "object" && value !== null && "type" in value) {
    return value as EntitlementValue;
  }
  if (typeof value === "number") return { type: "number", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  return { type: "object", value: (value ?? {}) as never };
}

const mapPlanEntitlement = (raw: Raw): PlanEntitlement => ({
  ...(raw as PlanEntitlement),
  value: entitlementValue(raw.value),
});

/** A catalogue plan: the default PUBLISHED version of a public licence family. */
export function mapPlan(raw: Raw): Plan {
  const { licenseId, licenseSlug, familySlug, currency, prices, entitlements, ...rest } = raw;
  const billingPrices = list(prices).map((price) => mapBillingPrice(price, currency));
  const [month, year] = headlinePrices(billingPrices);

  return {
    ...rest,
    id: licenseId,
    slug: licenseSlug,
    name: rest.name,
    price: month?.amount,
    annualPrice: year?.amount,
    currencyCode: currency,
    prices: [month, year].filter((price) => price !== undefined),
    billingPrices,
    entitlements: list(entitlements).map(mapPlanEntitlement),
    // `published` follows the lifecycle state alone: the removed `isActive` is
    // not read, whatever a payload still carries.
    published: rest.lifecycleState === "PUBLISHED",
    familyId: familySlug,
  };
}

/**
 * An add-on, from the catalogue or from a customer's portal: both carry
 * `addonSlug`, `familySlug`, `name`, `maxQuantity` and `prices`; the portal
 * adds `quantity`, the catalogue `addonId`, entitlements and compatibility.
 */
export function mapAddon(raw: Raw, fallbackCurrency?: string): Addon {
  const { addonId, addonSlug, prices, entitlements, ...rest } = raw;
  const billingPrices = list(prices).map((price) => mapBillingPrice(price, fallbackCurrency));
  const [month, year] = headlinePrices(billingPrices);
  const shown = month ?? year;

  return {
    ...rest,
    id: addonId,
    slug: addonSlug,
    name: rest.name,
    maxQuantity: rest.maxQuantity ?? null,
    price: shown?.amount,
    currencyCode: shown?.currencyCode,
    interval: shown?.interval,
    prices: [month, year].filter((price) => price !== undefined),
    billingPrices,
    ...(entitlements ? { entitlements: list(entitlements).map(mapPlanEntitlement) } : {}),
  };
}

/** `GET /public/catalog` as a `KaitenCatalog`. */
export function mapPublicCatalog(payload: unknown): KaitenCatalog {
  const raw: Raw = typeof payload === "object" && payload !== null ? payload : {};
  const capabilities: Raw = raw.capabilities ?? {};

  return {
    plans: list(raw.plans).map(mapPlan),
    addOns: list(raw.addOns).map((addon) => mapAddon(addon)),
    capabilities: {
      checkout: capabilities.checkout === true,
      paymentMethods: capabilities.paymentMethods === true,
    },
    branding: normalizeBrandingCapability(undefined),
  };
}
