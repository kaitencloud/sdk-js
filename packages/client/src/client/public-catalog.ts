// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The public catalogue, read with a publishable key: GET /api/public/catalog.
//
// The wire shape is written here rather than generated, because the vendored
// contract (contracts/openapi.yaml) follows released kaiten versions and this
// route is newer than the last one. When contract-drift brings it in, these
// types can give way to the generated ones; the mapping stays.
//
// The API does not mirror the SDK's shapes; this maps them (§14.5 of the
// billing spec): amounts stay in minor units, periods become intervals, the
// default monthly and annual flat fees become `price` and `annualPrice`.

import type {
  Addon,
  BillingInterval,
  EntitlementValue,
  KaitenCatalog,
  Plan,
  PlanEntitlement,
  PlanPrice,
} from "./types.ts";

export const PUBLIC_CATALOG_PATH = "/public/catalog";

export interface PublicCatalogResponse {
  plans: PublicPlanWire[];
  addOns: PublicAddOnWire[];
  capabilities: { checkout: boolean; paymentMethods: boolean };
}

interface PublicPriceWire {
  id: string;
  billingModel: "FLAT_FEE" | "USAGE_BASED" | "OVERAGE";
  billingTiming: "ADVANCE" | "ARREARS";
  billingPeriod?: "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL";
  currency: string;
  unitAmount?: number;
  unitAmountDecimal: string;
  metered?: {
    entitlementSlug: string;
    saleUnitFactor: string;
    saleUnitSingular?: string;
    saleUnitPlural?: string;
  };
  displayLabel?: string;
  displayOrder: number;
  isDefault: boolean;
}

interface PublicPlanEntitlementWire {
  slug: string;
  name: string;
  description?: string;
  type: "BOOLEAN" | "NUMBER" | "CONFIG";
  value: unknown;
  unlimited: boolean;
  limitCapExceededOveragePercent?: number;
  icon?: string;
  unitSingular?: string;
  unitPlural?: string;
  saleUnitSingular?: string;
  saleUnitPlural?: string;
  saleUnitFactor?: string;
  displayOrder: number;
}

interface PublicPlanWire {
  familySlug: string;
  licenseSlug: string;
  licenseId: string;
  name: string;
  description: string;
  lifecycleState: "PUBLISHED";
  pricingType: "FREE" | "PAID" | "CUSTOM";
  trialPeriodDays: number | null;
  requiresPaymentMethod: boolean;
  selfServe: boolean;
  selfServeCtaUrl: string | null;
  currency: string | null;
  prices: PublicPriceWire[];
  compatibleAddonFamilies: string[];
  entitlements: PublicPlanEntitlementWire[];
}

interface PublicAddOnWire {
  familySlug: string;
  addonSlug: string;
  addonId: string;
  name: string;
  description: string;
  pricingType: "FREE" | "PAID" | "CUSTOM";
  maxQuantity: number | null;
  prices: PublicPriceWire[];
  entitlements: {
    slug: string;
    name: string;
    type: "BOOLEAN" | "NUMBER" | "CONFIG";
    value: unknown;
    overrideBehavior: "ADD" | "OVERRIDE" | "MAX";
    limitCapExceededOveragePercent?: number;
  }[];
  compatibleLicenseFamilies: string[];
}

const PERIODS: Record<
  NonNullable<PublicPriceWire["billingPeriod"]>,
  { interval: BillingInterval; intervalCount?: number }
> = {
  MONTHLY: { interval: "month" },
  QUARTERLY: { interval: "month", intervalCount: 3 },
  SEMI_ANNUAL: { interval: "month", intervalCount: 6 },
  ANNUAL: { interval: "year" },
};

function toPlanPrice(price: PublicPriceWire): PlanPrice {
  const out: PlanPrice = {
    id: price.id,
    amount: price.unitAmount ?? Number(price.unitAmountDecimal),
    currencyCode: price.currency,
    unitAmountDecimal: price.unitAmountDecimal,
    billingModel: price.billingModel,
    isDefault: price.isDefault,
  };
  if (price.billingPeriod) {
    const period = PERIODS[price.billingPeriod];
    out.interval = period.interval;
    if (period.intervalCount !== undefined) out.intervalCount = period.intervalCount;
  }
  if (price.displayLabel) out.label = price.displayLabel;
  if (price.metered) {
    out.meteredEntitlementSlug = price.metered.entitlementSlug;
    out.saleUnitFactor = Number(price.metered.saleUnitFactor);
  }
  return out;
}

// The stored value is { type, value } in lower case; the API sends the inner
// value and the type beside it, so the SDK's EntitlementValue is rebuilt.
function toValue(type: PublicPlanEntitlementWire["type"], value: unknown): EntitlementValue {
  return { type: type.toLowerCase(), value } as EntitlementValue;
}

function toPlanEntitlement(grant: PublicPlanEntitlementWire): PlanEntitlement {
  return {
    slug: grant.slug,
    name: grant.name,
    description: grant.description ?? null,
    type: grant.type,
    value: toValue(grant.type, grant.value),
    unlimited: grant.unlimited,
    icon: grant.icon ?? null,
    unitSingular: grant.unitSingular ?? null,
    unitPlural: grant.unitPlural ?? null,
    saleUnitSingular: grant.saleUnitSingular ?? null,
    saleUnitPlural: grant.saleUnitPlural ?? null,
    saleUnitFactor: grant.saleUnitFactor === undefined ? null : Number(grant.saleUnitFactor),
    userFacing: true,
  };
}

// The default flat fee of a period: what a pricing table shows as "€29 / month".
function headline(prices: PublicPriceWire[], period: "MONTHLY" | "ANNUAL"): number | undefined {
  const price = prices.find(
    (p) => p.billingModel === "FLAT_FEE" && p.isDefault && p.billingPeriod === period,
  );
  return price?.unitAmount;
}

function toAddon(addon: PublicAddOnWire): Addon {
  const monthly = headline(addon.prices, "MONTHLY");
  const out: Addon = {
    id: addon.addonId,
    slug: addon.addonSlug,
    familySlug: addon.familySlug,
    name: addon.name,
    description: addon.description,
    maxQuantity: addon.maxQuantity,
    prices: addon.prices.map(toPlanPrice),
    entitlements: addon.entitlements.map((grant) => ({
      slug: grant.slug,
      name: grant.name,
      type: grant.type,
      value: toValue(grant.type, grant.value),
      userFacing: true,
    })),
  };
  const currency = addon.prices[0]?.currency;
  if (currency) out.currencyCode = currency;
  if (monthly !== undefined) {
    out.price = monthly;
    out.interval = "month";
  }
  return out;
}

/** Maps GET /api/public/catalog to the SDK's catalogue. */
export function catalogFromPublic(response: PublicCatalogResponse): KaitenCatalog {
  const addOns = response.addOns.map(toAddon);
  const addOnsByFamily = new Map<string, Addon>();
  for (const addon of addOns) {
    if (addon.familySlug) addOnsByFamily.set(addon.familySlug, addon);
  }

  const plans = response.plans.map((wire): Plan => {
    const plan: Plan = {
      id: wire.licenseId,
      slug: wire.licenseSlug,
      name: wire.name,
      description: wire.description,
      prices: wire.prices.map(toPlanPrice),
      entitlements: wire.entitlements.map(toPlanEntitlement),
      addOns: wire.compatibleAddonFamilies.flatMap((family) => {
        const addon = addOnsByFamily.get(family);
        return addon ? [addon] : [];
      }),
      published: wire.lifecycleState === "PUBLISHED",
      lifecycleState: wire.lifecycleState,
      familyId: wire.familySlug,
      pricingType: wire.pricingType,
      selfServe: wire.selfServe,
      selfServeCtaUrl: wire.selfServeCtaUrl,
      trialPeriodDays: wire.trialPeriodDays,
      requiresPaymentMethod: wire.requiresPaymentMethod,
    };
    if (wire.currency) plan.currencyCode = wire.currency;
    const monthly = headline(wire.prices, "MONTHLY");
    const annual = headline(wire.prices, "ANNUAL");
    if (monthly !== undefined) {
      plan.price = monthly;
      plan.interval = "month";
    }
    if (annual !== undefined) plan.annualPrice = annual;
    return plan;
  });

  return {
    plans,
    addOns,
    capabilities: {
      checkout: response.capabilities.checkout,
      paymentMethods: response.capabilities.paymentMethods,
    },
  };
}
