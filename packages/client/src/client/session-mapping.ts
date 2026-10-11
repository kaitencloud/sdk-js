// Maps the answers of the `/public/session/*` routes onto the SDK's types.
//
// The money and period vocabulary is the one of the public catalogue (see
// ./billing.ts): `currency` becomes `currencyCode`, a billing period an interval
// and an interval count, a price a `BillingPrice`. The amounts and totals are the
// server's, passed as they come: the SDK never sums or rounds a price.

import type * as Api from "../core/index.ts";
import {
  billingInterval,
  entitlementValue,
  headlinePrices,
  list,
  mapBillingPrice,
} from "./billing.ts";
import { entitlementStatus } from "./normalize.ts";
import type {
  CheckoutPreview,
  CheckoutResult,
  CheckoutSubscribed,
  InvoiceTotals,
  KaitenPage,
  KaitenPortal,
  PaymentMethodSummary,
  PortalSubscription,
  SessionAddon,
  SessionInvoice,
  VoucherValidation,
} from "./session-types.ts";
import type { EntitlementProvenance, ResolvedEntitlement } from "./types.ts";

/**
 * A JSON object of a session payload, not yet read through the contract's types.
 * Each mapper below leaves it for the generated type of its route.
 */
// oxlint-disable-next-line no-explicit-any
type Raw = Record<string, any>;

/** A payload member with the API's `currency` renamed to the SDK's `currencyCode`. */
function withCurrencyCode<T>(raw: Raw): T {
  const { currency, ...rest } = raw;
  return { ...rest, currencyCode: currency } as T;
}

/** The subscription of the portal, of a checkout, of a cancel or a reactivate. */
export function mapSubscription(raw: Api.SessionSubscription): PortalSubscription {
  const period = billingInterval(raw.billingPeriod);
  const change = raw.scheduledChange;
  return {
    status: raw.status,
    providerKind: raw.providerKind,
    collectionMethod: raw.collectionMethod,
    currencyCode: raw.currency,
    ...(period ? { billingInterval: period.interval } : {}),
    ...(period?.intervalCount ? { intervalCount: period.intervalCount } : {}),
    basePrice: mapBillingPrice(raw.basePrice),
    currentPeriodStart: raw.currentPeriodStart,
    currentPeriodEnd: raw.currentPeriodEnd,
    trialEndsAt: raw.trialEndsAt ?? null,
    cancelAtPeriodEnd: raw.cancelAtPeriodEnd === true,
    scheduledChange: change
      ? { price: mapBillingPrice(change.price), effectiveAt: change.effectiveAt }
      : null,
  };
}

/** A `SessionInvoice`, or a checkout preview's `dueToday`. */
const mapInvoice = <T extends InvoiceTotals>(raw: Raw): T =>
  withCurrencyCode<T>({ ...raw, lines: list(raw.lines) });

/** How each layer contributed to an entitlement's value. */
function mapProvenance(raw: Api.Provenance): EntitlementProvenance {
  const { license, number } = raw;
  return {
    license: license
      ? {
          licenseEntitlementId: license.licenseEntitlementId,
          value: entitlementValue(license.value),
          limitCapExceededOveragePercent: license.limitCapExceededOveragePercent ?? null,
        }
      : null,
    addons: list(raw.addons).map((addon) => ({
      instanceAddonId: addon.instanceAddonId,
      addonId: addon.addonId,
      addonEntitlementId: addon.addonEntitlementId,
      quantity: addon.quantity,
      overrideBehavior: addon.overrideBehavior,
      value: entitlementValue(addon.value),
      limitCapExceededOveragePercent: addon.limitCapExceededOveragePercent ?? null,
      attachedAt: addon.attachedAt,
    })),
    boosts: list(raw.boosts).map((boost) => ({
      instanceVoucherId: boost.instanceVoucherId,
      voucherId: boost.voucherId,
      voucherEntitlementGrantId: boost.voucherEntitlementGrantId,
      modifierType: boost.modifierType,
      modifierValue: boost.modifierValue ?? null,
      redeemedAt: boost.redeemedAt,
      effectiveStartsAt: boost.effectiveStartsAt,
      effectiveExpiresAt: boost.effectiveExpiresAt ?? null,
    })),
    number: number
      ? {
          license: number.license ?? null,
          afterAddons: number.afterAddons,
          boostSet: number.boostSet ?? null,
          boostAdd: number.boostAdd ?? null,
          boostMultiply: number.boostMultiply ?? null,
          unlimited: number.unlimited === true,
          effective: number.effective,
        }
      : null,
  };
}

/**
 * A portal entitlement, already effective: the server applied the add-ons and
 * boosts, measured the usage and computed the ceiling. Only `remaining` and
 * `status` are derived here, by the same rules as the licensing snapshot.
 */
function mapPortalEntitlement(raw: Api.PortalEntitlement): ResolvedEntitlement {
  // The limit is tagged, as the usage reads tag it; the usage is a bare number.
  const limitValue = entitlementValue(raw.limitValue);
  const numeric = limitValue.type === "number";
  // A number without its usage is unknown usage, never zero: that would open
  // every gate. Other grants are fully described by their value.
  const currentValue = !numeric
    ? limitValue
    : raw.currentValue == null
      ? null
      : entitlementValue(raw.currentValue);
  const maximumAllowedUsage = raw.maximumAllowedUsage ?? null;

  return {
    id: raw.slug,
    slug: raw.slug,
    name: raw.name,
    type: raw.type,
    limitValue,
    currentValue,
    ...(numeric && !currentValue ? { usageUnavailable: true } : {}),
    unlimited: raw.unlimited === true,
    limitCapExceededOveragePercent: raw.limitCapExceededOveragePercent ?? null,
    maximumAllowedUsage,
    percentageUsed: raw.percentageUsed ?? null,
    remaining:
      maximumAllowedUsage !== null && currentValue?.type === "number"
        ? Math.max(maximumAllowedUsage - currentValue.value, 0)
        : null,
    currentPeriodStart: raw.currentPeriodStart ?? null,
    currentPeriodEnd: raw.currentPeriodEnd ?? null,
    status: entitlementStatus(limitValue, currentValue, maximumAllowedUsage),
    // "credit" is not produced by any server yet; anything unknown reads as the
    // licence, the layer every entitlement has.
    source: raw.source === "addon" ? "addon" : "license",
    ...(raw.provenance ? { provenance: mapProvenance(raw.provenance) } : {}),
  };
}

/** The labels of a payment method: what the provider does not give is `null`. */
export function mapPaymentMethod(raw: Api.PortalPaymentMethod): PaymentMethodSummary {
  return {
    status: raw.status,
    brand: raw.brand ?? null,
    last4: raw.last4 ?? null,
    expMonth: raw.expMonth ?? null,
    expYear: raw.expYear ?? null,
  };
}

/**
 * An add-on the session's instance holds. Like a catalogue add-on, only the
 * default flat fees are in `prices`; every price is in `billingPrices`.
 */
export function mapSessionAddon(raw: Api.SessionAddon): SessionAddon {
  const billingPrices = list(raw.prices).map(mapBillingPrice);
  const [month, year] = headlinePrices(billingPrices);
  const shown = month ?? year;

  return {
    slug: raw.addonSlug,
    familySlug: raw.familySlug,
    name: raw.name,
    quantity: raw.quantity,
    maxQuantity: raw.maxQuantity ?? null,
    price: shown?.amount,
    currencyCode: shown?.currencyCode,
    interval: shown?.interval,
    prices: [month, year].filter((price) => price !== undefined),
    billingPrices,
  };
}

/** `GET /public/session/portal` as a `KaitenPortal`. */
export function mapPortal(raw: Api.SessionPortal): KaitenPortal {
  const { customer, instance, upcomingInvoice, capabilities } = raw;
  return {
    customer: {
      slug: customer.slug,
      name: customer.name,
      billingEmail: customer.billingEmail ?? null,
    },
    instance: instance
      ? {
          slug: instance.slug,
          name: instance.name,
          licenseSlug: instance.licenseSlug,
          licenseName: instance.licenseName,
        }
      : null,
    instances: list(raw.instances).map((summary) => ({
      slug: summary.slug,
      name: summary.name,
      licenseSlug: summary.licenseSlug,
      billingStatus: summary.billingStatus ?? null,
    })),
    subscription: raw.subscription ? mapSubscription(raw.subscription) : null,
    entitlements: list(raw.entitlements).map(mapPortalEntitlement),
    addOns: list(raw.addOns).map(mapSessionAddon),
    vouchers: list(raw.vouchers).map((voucher) => ({
      name: voucher.name,
      voucherType: voucher.voucherType,
      status: voucher.status,
      effectiveStartsAt: voucher.effectiveStartsAt,
      effectiveExpiresAt: voucher.effectiveExpiresAt ?? null,
    })),
    paymentMethod: raw.paymentMethod ? mapPaymentMethod(raw.paymentMethod) : null,
    upcomingInvoice: upcomingInvoice
      ? {
          currencyCode: upcomingInvoice.currency,
          subtotal: upcomingInvoice.subtotal,
          discountTotal: upcomingInvoice.discountTotal,
          total: upcomingInvoice.total,
          boundaryAt: upcomingInvoice.boundaryAt,
        }
      : null,
    capabilities: {
      paymentMethods: capabilities?.paymentMethods === true,
      invoices: capabilities?.invoices === true,
      unsubscribe: capabilities?.unsubscribe === true,
      checkout: capabilities?.checkout === true,
    },
    updatedAt: raw.updatedAt,
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
      subscription: mapSubscription(raw.subscription),
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
