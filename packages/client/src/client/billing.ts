// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

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
//
// The inputs are typed by the generated contract (`PublicCatalog` and its
// parts), so the compiler reports a member the API renames or retypes. The
// values themselves are still read defensively: a payload comes off the wire.

import type {
  Addon,
  BillingInterval,
  BillingPrice,
  EntitlementValue,
  GetCatalogOptions,
  KaitenCatalog,
  Plan,
  PlanEntitlement,
  PlanPrice,
  ResolvedEntitlement,
} from "./types.ts";
import type {
  PublicAddOn,
  PublicAddOnEntitlement,
  PublicCatalog,
  PublicPlan,
  PublicPlanEntitlement,
  PublicPrice,
} from "../core/index.ts";
import type {
  CheckoutPreview,
  CheckoutResult,
  CheckoutSubscribed,
  InvoiceTotals,
  KaitenPage,
  KaitenPortal,
  PortalSubscription,
  SessionInvoice,
  VoucherValidation,
} from "./session-types.ts";
import { entitlementStatus, normalizeBrandingCapability } from "./normalize.ts";

/** The objects of a list a payload may omit, or send as `null`. */
const list = <T extends object>(value: readonly T[] | null | undefined): T[] =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === "object" && entry !== null) : [];

/** The API's billing periods, as the SDK's interval and interval count. */
const PERIODS: Partial<Record<string, { interval: BillingInterval; intervalCount?: number }>> = {
  MONTHLY: { interval: "month" },
  QUARTERLY: { interval: "month", intervalCount: 3 },
  SEMI_ANNUAL: { interval: "month", intervalCount: 6 },
  ANNUAL: { interval: "year" },
};

/**
 * The interval of an API billing period. An unknown period, or none (a metered
 * price), yields none: such a price stays out of every interval-keyed reading.
 */
export const billingInterval = (period: string | null | undefined) =>
  typeof period === "string" ? PERIODS[period] : undefined;

/**
 * Measured units in one sale unit. The API sends it as a decimal string; the SDK
 * has always typed it `number`. A value that is not a finite number above zero
 * is no factor: it is left out, never turned into `NaN` or into a `1` that would
 * pass for a real sale unit.
 */
const toSaleUnitFactor = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const factor = Number(value);
  return Number.isFinite(factor) && factor > 0 ? factor : undefined;
};

/** An API `Price` as a `BillingPrice`. */
export function mapBillingPrice(raw: PublicPrice): BillingPrice {
  const { unitAmount, metered, displayLabel } = raw;
  const price: BillingPrice = {
    id: raw.id,
    unitAmountDecimal: raw.unitAmountDecimal,
    currencyCode: raw.currency,
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
    const factor = toSaleUnitFactor(metered.saleUnitFactor);
    if (factor !== undefined) price.saleUnitFactor = factor;
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

/** A grant of the plan, with the value tagged and the sale unit factor a number. */
const mapPlanEntitlement = (raw: PublicPlanEntitlement): PlanEntitlement => ({
  ...raw,
  value: entitlementValue(raw.value),
  // No distinct sale unit is `null`: quote in base units, never in a made-up one.
  saleUnitFactor: toSaleUnitFactor(raw.saleUnitFactor) ?? null,
});

/** A grant of an add-on: one unit's worth, which the API describes less than a plan's. */
const mapAddonEntitlement = (raw: PublicAddOnEntitlement): PlanEntitlement => ({
  ...raw,
  value: entitlementValue(raw.value),
});

/** A catalogue plan: the default PUBLISHED version of a public licence family. */
export function mapPlan(raw: PublicPlan): Plan {
  const { licenseId, licenseSlug, familySlug, currency, prices, entitlements, ...rest } = raw;
  const billingPrices = list(prices).map(mapBillingPrice);
  const [month, year] = headlinePrices(billingPrices);

  return {
    ...rest,
    id: licenseId,
    slug: licenseSlug,
    name: rest.name,
    price: month?.amount,
    annualPrice: year?.amount,
    currencyCode: currency ?? undefined,
    prices: [month, year].filter((price) => price !== undefined),
    billingPrices,
    entitlements: list(entitlements).map(mapPlanEntitlement),
    // `published` follows the lifecycle state alone: the removed `isActive` is
    // not read, whatever a payload still carries.
    published: rest.lifecycleState === "PUBLISHED",
    familyId: familySlug,
  };
}

/** An add-on of the catalogue. */
export function mapAddon(raw: PublicAddOn): Addon {
  const { addonId, addonSlug, prices, entitlements, ...rest } = raw;
  const billingPrices = list(prices).map(mapBillingPrice);
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
    ...(entitlements ? { entitlements: list(entitlements).map(mapAddonEntitlement) } : {}),
  };
}

/**
 * The query string of `GET /public/catalog` for `options`, or nothing when they
 * narrow nothing. An option the route would not understand is refused here, with
 * a `TypeError` as for a bad `authScheme`, rather than sent to be answered by a
 * 422, or worse, ignored: an empty family slug reads as "every family" to the
 * API, which is never what a caller who passed one meant.
 */
export function catalogQuery(
  options: GetCatalogOptions | undefined,
): Record<string, string> | undefined {
  const { familySlug, include } = options ?? {};
  if (familySlug !== undefined && (typeof familySlug !== "string" || familySlug === "")) {
    throw new TypeError("Kaiten: getCatalog familySlug must be a non-empty string.");
  }
  if (include !== undefined && include !== "addons" && include !== "none") {
    throw new TypeError('Kaiten: getCatalog include must be "addons" or "none".');
  }
  if (familySlug === undefined && include === undefined) return undefined;
  return {
    ...(familySlug === undefined ? {} : { familySlug }),
    ...(include === undefined ? {} : { include }),
  };
}

/** `GET /public/catalog` as a `KaitenCatalog`. */
export function mapPublicCatalog(payload: unknown): KaitenCatalog {
  const raw = (
    typeof payload === "object" && payload !== null ? payload : {}
  ) as Partial<PublicCatalog>;

  return {
    plans: list(raw.plans).map(mapPlan),
    addOns: list(raw.addOns).map(mapAddon),
    capabilities: {
      checkout: raw.capabilities?.checkout === true,
      paymentMethods: raw.capabilities?.paymentMethods === true,
    },
    branding: normalizeBrandingCapability(undefined),
  };
}

// ---------------------------------------------------------------------------
// Customer-session payloads
// ---------------------------------------------------------------------------

/** A JSON object of a session payload, whose shape the API's contract fixes. */
// oxlint-disable-next-line no-explicit-any
type Raw = Record<string, any>;

/** A payload member with the API's `currency` renamed to the SDK's `currencyCode`. */
function withCurrencyCode<T>(raw: Raw): T {
  const { currency, ...rest } = raw;
  return { ...rest, currencyCode: currency } as T;
}

/** The subscription of the portal, of a checkout, of a cancel or a reactivate. */
export function mapSubscription(raw: Raw): PortalSubscription {
  const { currency, billingPeriod, basePrice, scheduledChange: change, ...rest } = raw;
  const period = billingInterval(billingPeriod);
  return {
    ...(rest as PortalSubscription),
    currencyCode: currency,
    billingInterval: period?.interval,
    ...(period?.intervalCount ? { intervalCount: period.intervalCount } : {}),
    basePrice: mapBillingPrice(basePrice ?? {}),
    cancelAtPeriodEnd: rest.cancelAtPeriodEnd === true,
    scheduledChange: change
      ? { price: mapBillingPrice(change.price ?? {}), effectiveAt: change.effectiveAt }
      : null,
  };
}

/** A `SessionInvoice`, or a checkout preview's `dueToday`. */
const mapInvoice = <T extends InvoiceTotals>(raw: Raw): T =>
  withCurrencyCode<T>({ ...raw, lines: list(raw.lines) });

/**
 * A portal entitlement, already effective: the server applied the add-ons and
 * boosts, measured the usage and computed the ceiling. Only `remaining` and
 * `status` are derived here, by the same rules as the licensing snapshot.
 */
function mapPortalEntitlement(raw: Raw): ResolvedEntitlement {
  const limitValue = entitlementValue(raw.limitValue);
  const numeric = limitValue.type === "number";
  // A number without its usage is unknown usage, never zero: that would open
  // every gate. Other grants are fully described by their value.
  const currentValue = !numeric
    ? limitValue
    : raw.currentValue == null
      ? null
      : entitlementValue(raw.currentValue);
  const maxAllowed: number | null = raw.maximumAllowedUsage ?? null;

  return {
    ...(raw as ResolvedEntitlement),
    id: raw.slug,
    limitValue,
    currentValue,
    ...(numeric && !currentValue ? { usageUnavailable: true } : {}),
    unlimited: raw.unlimited === true,
    maximumAllowedUsage: maxAllowed,
    remaining:
      maxAllowed !== null && currentValue?.type === "number"
        ? Math.max(maxAllowed - currentValue.value, 0)
        : null,
    status: entitlementStatus(limitValue, currentValue, maxAllowed),
    // "credit" is not produced by any server yet; anything unknown reads as the
    // licence, the layer every entitlement has.
    source: raw.source === "addon" ? "addon" : "license",
  };
}

/** `GET /public/session/portal` as a `KaitenPortal`. */
export function mapPortal(raw: Raw): KaitenPortal {
  const subscription = raw.subscription ? mapSubscription(raw.subscription) : null;
  const capabilities: Raw = raw.capabilities ?? {};
  return {
    ...(raw as KaitenPortal),
    subscription,
    entitlements: list(raw.entitlements).map(mapPortalEntitlement),
    addOns: list<Raw>(raw.addOns).map((addon) => mapAddon(addon as PublicAddOn)),
    upcomingInvoice: raw.upcomingInvoice ? withCurrencyCode(raw.upcomingInvoice) : null,
    capabilities: {
      paymentMethods: capabilities.paymentMethods === true,
      invoices: capabilities.invoices === true,
      unsubscribe: capabilities.unsubscribe === true,
      checkout: capabilities.checkout === true,
    },
  };
}

/** `GET /public/session/invoices` as a page of `SessionInvoice`. */
export const mapInvoicePage = (raw: Raw): KaitenPage<SessionInvoice> => ({
  ...(raw as KaitenPage<SessionInvoice>),
  items: list(raw.items).map((invoice) => mapInvoice<SessionInvoice>(invoice)),
  hasMore: raw.hasMore === true,
});

/** The answer of `POST /public/session/checkout`, whichever it is. */
export function mapCheckout(raw: Raw): CheckoutResult {
  if (raw.status === "preview") {
    return {
      ...(raw as CheckoutPreview),
      dueToday: mapInvoice(raw.dueToday ?? {}),
      // The API leaves the trial out when the plan has none.
      trialEndsAt: raw.trialEndsAt ?? null,
    };
  }
  if (raw.status === "subscribed") {
    return {
      ...(raw as CheckoutSubscribed),
      subscription: mapSubscription(raw.subscription ?? {}),
      activationInvoice: raw.activationInvoice ? mapInvoice(raw.activationInvoice) : null,
      // Likewise the hosted page, when the payment needs none.
      payment: raw.payment && {
        ...raw.payment,
        hostedInvoiceUrl: raw.payment.hostedInvoiceUrl ?? null,
      },
    };
  }
  return raw as CheckoutResult;
}

/** The answer of `POST /public/session/vouchers/validate`. */
export function mapVoucherValidation(raw: Raw): VoucherValidation {
  const voucher: Raw | undefined = raw.voucher;
  if (raw.valid !== true || !voucher) return { valid: false };
  return {
    valid: true,
    voucher: {
      ...(voucher as Extract<VoucherValidation, { valid: true }>["voucher"]),
      ...(voucher.discount ? { discount: withCurrencyCode(voucher.discount) } : {}),
    },
  };
}
