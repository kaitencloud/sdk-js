// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Types of the customer-session surface: what a customer, signed in to the
// vendor's application, reads and changes about their own subscription through
// the `/public/session/*` routes, with a `kst_` customer session.
//
// Money follows the SDK's conventions throughout: amounts are integers in the
// currency's minor units, beside a `currencyCode`. The values the API may extend
// in a minor release (statuses, kinds, providers) are typed as open unions:
// handle a value you do not know rather than assuming the list is exhaustive.

import type {
  Addon,
  BillingCapabilities,
  BillingInterval,
  BillingPrice,
  BoostModifierType,
  CurrencyCode,
  ResolvedEntitlement,
} from "./types.ts";

/** `ACTIVE` (charged automatically), `EXPIRED` or `FAILED` (save another one). Open: more may come. */
export type PaymentMethodStatus = "ACTIVE" | "EXPIRED" | "FAILED" | (string & {});

/**
 * `INCOMPLETE` (a checkout waiting for its first payment: the plan it bought
 * starts once the payment is confirmed), `TRIAL`, `ACTIVE`, `PAST_DUE` or
 * `CANCELED`. Open: more may come.
 */
export type SubscriptionStatus =
  | "INCOMPLETE"
  | "TRIAL"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | (string & {});

/**
 * An issued invoice's status: `MANUAL` (collected outside the payment
 * provider), `PUSHED` (awaiting payment), `PAID`, `PAYMENT_FAILED`,
 * `UNCOLLECTIBLE` or `VOID`. Open: more may come.
 */
export type InvoiceStatus =
  | "MANUAL"
  | "PUSHED"
  | "PAID"
  | "PAYMENT_FAILED"
  | "UNCOLLECTIBLE"
  | "VOID"
  | (string & {});

/** `ACTIVATION`, `RENEWAL` or `FINAL`. Open: more may come. */
export type InvoiceKind = "ACTIVATION" | "RENEWAL" | "FINAL" | (string & {});

/**
 * What became of the payment a checkout attempted: `paid`; `requires_action`
 * (the customer must complete it on `hostedInvoiceUrl`, 3-D Secure for
 * instance); `failed`; `processing` (not known yet: poll the invoices);
 * `not_required` (nothing was due). Open: more may come.
 */
export type CheckoutPaymentStatus =
  | "paid"
  | "requires_action"
  | "failed"
  | "processing"
  | "not_required"
  | (string & {});

/**
 * One way through a list the API pages: the rows of this page, and the
 * cursor of the next one while `hasMore` is true.
 */
export interface KaitenPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
}

/** The subscription of a session's instance. */
export interface PortalSubscription {
  status: SubscriptionStatus;
  /** `STRIPE`, or `NOOP` (billed outside any payment provider). Open: more may come. */
  providerKind: "STRIPE" | "NOOP" | (string & {});
  /** `CHARGE_AUTOMATICALLY` or `SEND_INVOICE`. Open: more may come. */
  collectionMethod: "CHARGE_AUTOMATICALLY" | "SEND_INVOICE" | (string & {});
  currencyCode: CurrencyCode;
  /** The billing period, as an interval; a quarter is three months. */
  billingInterval?: BillingInterval;
  /** `3` for a quarterly period, `6` for a semi-annual one; absent for one interval. */
  intervalCount?: number;
  basePrice: BillingPrice;
  currentPeriodStart: string;
  /** The end of the current period: when the subscription renews, or ends. */
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  /** True when the subscription ends at `currentPeriodEnd` instead of renewing. */
  cancelAtPeriodEnd: boolean;
  /** A plan change that takes effect at a later boundary. */
  scheduledChange: { price: BillingPrice; effectiveAt: string } | null;
}

/**
 * The labels of a customer's payment method. Never its number. The provider
 * gives what it knows: a label it does not give is `null`.
 */
export interface PaymentMethodSummary {
  status: PaymentMethodStatus;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  /** When the payment method was saved. Only on the answer that completes a payment method session. */
  attachedAt?: string;
}

/** The payment provider's billing portal, to send the customer to. */
export interface PortalSession {
  url: string;
}

/** The provider's hosted page where the customer saves a payment method. */
export interface PaymentMethodSession {
  /** The provider's page: send the customer there. */
  url: string;
  /** Pass it to `completePaymentMethodSession` once the customer is back. */
  sessionId: string;
  expiresAt: string;
}

/** A payment method session completed: the payment method now charged. */
export interface CompletedPaymentMethodSession {
  paymentMethod: PaymentMethodSummary;
}

/** A voucher redeemed on the session's instance. Never its code. */
export interface PortalVoucher {
  name: string;
  /** `PRICE` (a discount) or `ENTITLEMENT_BOOST`. Open: more may come. */
  voucherType: "PRICE" | "ENTITLEMENT_BOOST" | (string & {});
  /** `ACTIVE`, `EXPIRED` or `REVOKED`. Open: more may come. */
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | (string & {});
  effectiveStartsAt: string;
  /** When a boost stops applying. Null when it does not expire, and for a `PRICE` voucher, which is counted in invoices. */
  effectiveExpiresAt: string | null;
}

/** An amount due, as the server computed it: the SDK never sums prices. */
export interface InvoiceTotals {
  currencyCode: CurrencyCode;
  subtotal: number;
  /** The discounts, as a non-negative amount subtracted from `subtotal`. */
  discountTotal: number;
  total: number;
}

/** `BASE`, `ADDON`, `USAGE`, `OVERAGE` or `DISCOUNT`. Open: more may come. */
export type InvoiceLineType = "BASE" | "ADDON" | "USAGE" | "OVERAGE" | "DISCOUNT" | (string & {});

/** One line of an invoice or of a checkout preview. */
export interface SessionInvoiceLine {
  seq: number;
  type: InvoiceLineType;
  label: string;
  /** The arithmetic of the line, as the server wrote it. Empty when it has none. */
  description: string;
  /** The quantity billed, in sale units, as a decimal string. */
  quantity: string;
  /** The unit amount in minor units, as a decimal string. Null on a `DISCOUNT` line, which has none. */
  unitAmountDecimal: string | null;
  /** The line's amount in minor units; negative on a `DISCOUNT` line. */
  amount: number;
  serviceFrom: string;
  serviceTo: string;
}

/** An invoice issued to the session's customer. Drafts are never listed. */
export interface SessionInvoice extends InvoiceTotals {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  /** Null while the invoice has not been issued. */
  issuedAt: string | null;
  /** Null when the invoice has no payment terms. */
  dueAt: string | null;
  /** Null until it is paid. */
  paidAt: string | null;
  serviceFrom: string;
  serviceTo: string;
  /** The invoice number the payment provider gave it. */
  providerInvoiceNumber: string | null;
  /** The vendor's own invoice number, for an invoice billed outside a provider. */
  externalReference: string | null;
  /** Where the customer pays the invoice, or confirms a payment that needs authenticating. */
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  lines: SessionInvoiceLine[];
}

/** The customer a session acts for. */
export interface PortalCustomer {
  slug: string;
  name: string;
  /** Where its invoices are sent. Null until one is set. */
  billingEmail: string | null;
}

/** The instance a session is bound to. */
export interface PortalInstance {
  slug: string;
  name: string;
  licenseSlug: string;
  licenseName: string;
}

/** One of a customer's instances, as listed on a session bound to the customer only. */
export interface PortalInstanceSummary {
  slug: string;
  name: string;
  licenseSlug: string;
  /** Its subscription's status. Null when it was never subscribed. */
  billingStatus: SubscriptionStatus | null;
}

/** What the next invoice will total, as the server estimates it now, on the usage so far. */
export interface UpcomingInvoice extends InvoiceTotals {
  /** When it is issued. */
  boundaryAt: string;
}

/**
 * An add-on an instance holds, on a portal or once its quantity is set. It is
 * an {@link Addon} whose members a session always knows.
 */
export interface SessionAddon extends Addon {
  familySlug: string;
  /** How many units the instance holds; `0` when it holds none. */
  quantity: number;
  /** The most units one instance may hold. Null when unbounded. */
  maxQuantity: number | null;
  /**
   * Every price it is billed at: the flat fee of the subscription's period and
   * the metered prices. A quantity change is billed from the next renewal, with
   * no proration.
   */
  billingPrices: BillingPrice[];
}

/**
 * Everything a customer portal shows, for the session's customer and, on a
 * session bound to an instance, that instance.
 */
export interface KaitenPortal {
  customer: PortalCustomer;
  /** The instance the session is bound to. Null on a session bound to the customer only. */
  instance: PortalInstance | null;
  /** The customer's instances, on a session bound to the customer only. Empty on a bound one. */
  instances: PortalInstanceSummary[];
  /** The bound instance's subscription. Null when it has none, or the session is not bound. */
  subscription: PortalSubscription | null;
  /**
   * The bound instance's effective entitlements: the licence grant with its
   * add-ons and voucher boosts applied, and its usage. `source` says which
   * layer grants it, and `provenance` how each layer contributed.
   */
  entitlements: ResolvedEntitlement[];
  /** The add-ons attached to the bound instance, each with its `quantity`. */
  addOns: SessionAddon[];
  vouchers: PortalVoucher[];
  /** The payment method the customer's invoices are charged to. Null when none is saved. */
  paymentMethod: PaymentMethodSummary | null;
  /** Null without a live subscription. */
  upcomingInvoice: UpcomingInvoice | null;
  capabilities: BillingCapabilities;
  /** When this snapshot was read. */
  updatedAt: string;
}

/** What a checkout subscribes the session's instance to. */
export interface CheckoutInput {
  /** The id of a price of the public catalog (`BillingPrice.id`). */
  licensePriceId: string;
  addOns?: { addonSlug: string; quantity: number }[];
  voucherCode?: string;
  /** Required when the customer has no billing email yet. */
  billingEmail?: string;
  /** `false` subscribes without the plan's trial. */
  trial?: boolean;
  /** The setup session a `requires_payment_method` answer sent the customer to. */
  setupSessionId?: string;
  /** Where the hosted setup page sends the customer back. An allowed origin. */
  returnUrl?: string;
  /** `true` computes what is due today and changes nothing. */
  dryRun?: boolean;
}

/** A checkout's `dryRun`: what is due today, as the server computed it. */
export interface CheckoutPreview {
  status: "preview";
  dueToday: InvoiceTotals & { lines: SessionInvoiceLine[] };
  trialEndsAt: string | null;
}

/** The customer needs a payment method first: send them to `setupUrl`, then check out again. */
export interface CheckoutRequiresPaymentMethod {
  status: "requires_payment_method";
  setupUrl: string;
  setupSessionId: string;
  expiresAt: string;
}

/** The instance is subscribed, whatever became of the payment. */
export interface CheckoutSubscribed {
  status: "subscribed";
  subscription: PortalSubscription;
  activationInvoice: SessionInvoice | null;
  payment: { status: CheckoutPaymentStatus; hostedInvoiceUrl: string | null };
}

export type CheckoutResult = CheckoutPreview | CheckoutRequiresPaymentMethod | CheckoutSubscribed;

/** What a `PRICE` voucher takes off. */
export interface VoucherDiscount {
  /** `PERCENTAGE` or `FIXED_AMOUNT`. Open: more may come. */
  type: "PERCENTAGE" | "FIXED_AMOUNT" | (string & {});
  /**
   * A percentage in (0, 100], or an amount in minor units of `currencyCode`, as
   * a decimal string: it is exact, and `Number` reads it when a host needs one.
   */
  value: string;
  /** The currency of a `FIXED_AMOUNT` discount. */
  currencyCode?: CurrencyCode;
  /**
   * What it applies to: `LICENSE_BASE`, `ADDONS`, `BOTH` or `SELECTED_PRICES`.
   * Open: more may come.
   */
  appliesTo: "LICENSE_BASE" | "ADDONS" | "BOTH" | "SELECTED_PRICES" | (string & {});
}

/** One entitlement an `ENTITLEMENT_BOOST` voucher raises. */
export interface VoucherBoost {
  entitlementSlug: string;
  modifierType: BoostModifierType;
  /** A decimal string. Null for `UNLIMITED`, which has none. */
  modifierValue: string | null;
}

/** What a valid voucher gives. Never its code. */
export interface VoucherSummary {
  name: string;
  /** `PRICE` (a discount) or `ENTITLEMENT_BOOST`. Open: more may come. */
  voucherType: "PRICE" | "ENTITLEMENT_BOOST" | (string & {});
  /**
   * `ONE_TIME`, `REPEATING` or `FOREVER`. For a `PRICE` voucher, how many
   * invoices it discounts: one, `durationInPeriods`, or every one. For a boost,
   * how long it lasts, in billing periods. Open: more may come.
   */
  duration: "ONE_TIME" | "REPEATING" | "FOREVER" | (string & {});
  durationInPeriods: number | null;
  /** A `PRICE` voucher's discount. */
  discount?: VoucherDiscount;
  /** An `ENTITLEMENT_BOOST` voucher's boosts. */
  boosts?: VoucherBoost[];
}

/**
 * A voucher code's check. Every refusal is the same `{ valid: false }`, whatever
 * its reason: unknown, expired, used up, reserved for another customer.
 */
export type VoucherValidation = { valid: false } | { valid: true; voucher: VoucherSummary };
