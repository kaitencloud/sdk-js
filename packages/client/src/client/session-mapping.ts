// Maps the answers of the `/public/session/*` routes onto the SDK's types.
//
// The money and period vocabulary is the one of the public catalogue (see
// ./billing.ts): `currency` becomes `currencyCode`, a billing period an interval
// and an interval count, a price a `BillingPrice`. The amounts and totals are the
// server's, passed as they come: the SDK never sums or rounds a price.

import type { PublicAddOn } from "../core/index.ts";
import { billingInterval, entitlementValue, list, mapAddon, mapBillingPrice } from "./billing.ts";
import { entitlementStatus } from "./normalize.ts";
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
import type { ResolvedEntitlement } from "./types.ts";

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
