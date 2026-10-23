// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

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
import type { WireRedemption, WireSessionPortal } from "./session-spec-shapes.ts";
import type {
  CheckoutPreview,
  CheckoutResult,
  CompletedPaymentMethodSession,
  KaitenPage,
  KaitenPortal,
  PaymentMethodSession,
  PaymentMethodSummary,
  PortalSession,
  PortalSubscription,
  PortalTrial,
  PortalVoucher,
  SessionAddon,
  SessionInvoice,
  SessionInvoiceLine,
  VoucherValidation,
} from "./session-types.ts";
import type { EntitlementProvenance, ResolvedEntitlement } from "./types.ts";

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

/**
 * The labels of a payment method: what the provider does not give is `null`.
 * The portal's carry no date, and a completed session's may.
 */
export function mapPaymentMethod(
  raw: Api.PortalPaymentMethod | Api.PaymentMethodLabels,
): PaymentMethodSummary {
  return {
    status: raw.status,
    brand: raw.brand ?? null,
    last4: raw.last4 ?? null,
    expMonth: raw.expMonth ?? null,
    expYear: raw.expYear ?? null,
    ...("attachedAt" in raw && raw.attachedAt ? { attachedAt: raw.attachedAt } : {}),
  };
}

/** `POST /public/session/billing/portal-session`: a link, and nothing else. */
export const mapPortalSession = (raw: Api.PortalSession): PortalSession => ({ url: raw.url });

/** `POST /public/session/billing/payment-method-session`. */
export const mapPaymentMethodSession = (raw: Api.PaymentMethodSession): PaymentMethodSession => ({
  url: raw.url,
  sessionId: raw.sessionId,
  expiresAt: raw.expiresAt,
});

/** `POST …/payment-method-session/{sessionId}/complete`. */
export const mapCompletedPaymentMethodSession = (
  raw: Api.CompletedPaymentMethodSession,
): CompletedPaymentMethodSession => ({ paymentMethod: mapPaymentMethod(raw.paymentMethod) });

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

/**
 * One redemption: a line of the portal's `vouchers`, or the answer of a redemption. The members a
 * server that predates them does not send stay absent rather than made up.
 */
export function mapRedemption(raw: WireRedemption): PortalVoucher {
  return {
    name: raw.name,
    voucherType: raw.voucherType,
    status: raw.status,
    ...(raw.appliesFromInvoice !== undefined
      ? { appliesFromInvoice: raw.appliesFromInvoice === "next" ? ("next" as const) : null }
      : {}),
    ...(typeof raw.applicationsCount === "number"
      ? { applicationsCount: raw.applicationsCount }
      : {}),
    ...(raw.applicationsMax !== undefined ? { applicationsMax: raw.applicationsMax } : {}),
    effectiveStartsAt: raw.effectiveStartsAt,
    effectiveExpiresAt: raw.effectiveExpiresAt ?? null,
  };
}

/** The portal's trial block. The charge is the server's figure, passed as it comes. */
function mapTrial(raw: Api.PortalTrial): PortalTrial {
  const charge = raw.charge;
  const period = charge ? billingInterval(charge.billingPeriod) : null;
  const card = raw.paymentMethod;
  return {
    endsAt: raw.endsAt,
    reminderAt: raw.reminderAt ?? null,
    charge: charge
      ? {
          amount: charge.amount,
          currencyCode: charge.currency,
          ...(period ? { billingInterval: period.interval } : {}),
          ...(period?.intervalCount ? { intervalCount: period.intervalCount } : {}),
        }
      : null,
    paymentMethod: card ? { brand: card.brand ?? null, last4: card.last4 ?? null } : null,
  };
}

/** `GET /public/session/portal` as a `KaitenPortal`. */
export function mapPortal(raw: WireSessionPortal): KaitenPortal {
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
    vouchers: list(raw.vouchers).map(mapRedemption),
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
    // A server older than the contract leaves the member out: it stays absent, and a TRIAL
    // subscription with none shows no banner.
    ...(raw.trial !== undefined ? { trial: raw.trial ? mapTrial(raw.trial) : null } : {}),
    updatedAt: raw.updatedAt,
  };
}

/**
 * One invoice line. A discount has no unit amount: the API sends `null`, and
 * servers that predate it sent an empty string, which says the same.
 */
function mapInvoiceLine(raw: Api.SessionLine): SessionInvoiceLine {
  return {
    seq: raw.seq,
    type: raw.type,
    label: raw.label,
    description: raw.description ?? "",
    quantity: raw.quantity,
    unitAmountDecimal: raw.unitAmountDecimal || null,
    amount: raw.amount,
    serviceFrom: raw.serviceFrom,
    serviceTo: raw.serviceTo,
  };
}

/** An invoice of `GET /public/session/invoices`, or a checkout's activation invoice. */
export function mapInvoice(raw: Api.SessionInvoice): SessionInvoice {
  return {
    id: raw.id,
    kind: raw.kind,
    status: raw.status,
    currencyCode: raw.currency,
    subtotal: raw.subtotal,
    discountTotal: raw.discountTotal,
    total: raw.total,
    issuedAt: raw.issuedAt ?? null,
    dueAt: raw.dueAt ?? null,
    paidAt: raw.paidAt ?? null,
    serviceFrom: raw.serviceFrom,
    serviceTo: raw.serviceTo,
    providerInvoiceNumber: raw.providerInvoiceNumber ?? null,
    externalReference: raw.externalReference ?? null,
    hostedInvoiceUrl: raw.hostedInvoiceUrl ?? null,
    invoicePdfUrl: raw.invoicePdfUrl ?? null,
    lines: list(raw.lines).map(mapInvoiceLine),
  };
}

/** `GET /public/session/invoices` as a page of `SessionInvoice`. */
export const mapInvoicePage = (raw: Api.PageSessionInvoice): KaitenPage<SessionInvoice> => ({
  items: list(raw.items).map(mapInvoice),
  hasMore: raw.hasMore === true,
  ...(raw.nextCursor ? { nextCursor: raw.nextCursor } : {}),
});

type Checkout = Api.SessionCheckout;

/**
 * The answer of `POST /public/session/checkout`. The contract writes one object
 * whose members are optional, and says in each description which status it is
 * for: this is the same answer read as the three it is.
 */
export type WireCheckout =
  | (Checkout & { status: "preview" } & Required<Pick<Checkout, "dueToday">>)
  | (Checkout & { status: "requires_payment_method" } & Required<
        Pick<Checkout, "setupUrl" | "setupSessionId" | "expiresAt">
      >)
  | (Checkout & { status: "subscribed" } & Required<Pick<Checkout, "subscription" | "payment">>);

/** What a checkout bills today: the server's totals, and the lines they come from. */
export function mapDueToday(raw: Api.DueToday): CheckoutPreview["dueToday"] {
  return {
    currencyCode: raw.currency,
    subtotal: raw.subtotal,
    discountTotal: raw.discountTotal,
    total: raw.total,
    lines: list(raw.lines).map(mapInvoiceLine),
  };
}

/** The answer of `POST /public/session/checkout`, whichever it is. */
export function mapCheckout(raw: WireCheckout): CheckoutResult {
  switch (raw.status) {
    case "preview":
      return {
        status: "preview",
        dueToday: mapDueToday(raw.dueToday),
        // The API leaves the trial out when the plan has none.
        trialEndsAt: raw.trialEndsAt ?? null,
      };
    case "requires_payment_method":
      return {
        status: "requires_payment_method",
        setupUrl: raw.setupUrl,
        setupSessionId: raw.setupSessionId,
        expiresAt: raw.expiresAt,
      };
    case "subscribed":
      return {
        status: "subscribed",
        subscription: mapSubscription(raw.subscription),
        // Absent during a trial.
        activationInvoice: raw.activationInvoice ? mapInvoice(raw.activationInvoice) : null,
        payment: {
          status: raw.payment.status,
          // Likewise the hosted page, when the payment needs none.
          hostedInvoiceUrl: raw.payment.hostedInvoiceUrl ?? null,
        },
      };
    default:
      // A status this client does not know, from a newer server: handed to the
      // host as it came, which can at least read the status.
      return raw as unknown as CheckoutResult;
  }
}

/** The answer of `POST /public/session/vouchers/validate`. */
export function mapVoucherValidation(raw: Api.SessionVoucherValidity): VoucherValidation {
  const { voucher } = raw;
  if (raw.valid !== true || !voucher) return { valid: false };
  const { discount } = voucher;
  return {
    valid: true,
    voucher: {
      name: voucher.name,
      voucherType: voucher.voucherType,
      duration: voucher.duration,
      durationInPeriods: voucher.durationInPeriods ?? null,
      ...(discount
        ? {
            discount: {
              type: discount.type,
              value: discount.value,
              ...(discount.currency ? { currencyCode: discount.currency } : {}),
              appliesTo: discount.appliesTo,
            },
          }
        : {}),
      ...(voucher.boosts
        ? {
            boosts: list(voucher.boosts).map((boost) => ({
              entitlementSlug: boost.entitlementSlug,
              modifierType: boost.modifierType,
              modifierValue: boost.modifierValue ?? null,
            })),
          }
        : {}),
    },
  };
}
