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
  CurrencyCode,
  ResolvedEntitlement,
} from "./types.ts";

/** `TRIAL`, `ACTIVE`, `PAST_DUE` or `CANCELED`. Open: more may come. */
export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED" | (string & {});

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

/** The labels of a customer's payment method. Never its number. */
export interface PaymentMethodSummary {
  /** `ACTIVE`, `EXPIRED` or `FAILED`. Open. */
  status: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** A voucher redeemed on the session's instance. Never its code. */
export interface PortalVoucher {
  name: string;
  /** `PRICE` (a discount) or `ENTITLEMENT_BOOST`. Open. */
  voucherType: string;
  status: string;
  effectiveStartsAt: string;
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

/** One line of an invoice or of a checkout preview. */
export interface SessionInvoiceLine {
  seq: number;
  /** `BASE`, `ADDON`, `USAGE`, `OVERAGE` or `DISCOUNT`. Open. */
  type: string;
  label: string;
  description: string | null;
  /** The quantity billed, as a decimal string. */
  quantity: string;
  /** The unit amount in minor units, as a decimal string. */
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
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  serviceFrom: string;
  serviceTo: string;
  /** The invoice number the payment provider gave it. */
  providerInvoiceNumber: string | null;
  /** The vendor's own invoice number, for an invoice billed outside a provider. */
  externalReference: string | null;
  /** Where the customer pays the invoice, while it is payable. */
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  lines: SessionInvoiceLine[];
}

/**
 * Everything a customer portal shows, for the session's customer and, on a
 * session bound to an instance, that instance.
 */
export interface KaitenPortal {
  customer: { slug: string; name: string; billingEmail: string | null };
  /** The instance the session is bound to. Null on a customer-wide session. */
  instance: { slug: string; name: string; licenseSlug: string; licenseName: string } | null;
  /** The customer's instances, on a customer-wide session. Null on a bound one. */
  instances:
    | {
        slug: string;
        name: string;
        licenseSlug: string;
        billingStatus: SubscriptionStatus | null;
      }[]
    | null;
  /** The bound instance's subscription. Null when it has none, or the session is not bound. */
  subscription: PortalSubscription | null;
  /**
   * The bound instance's effective entitlements: the licence grant with its
   * add-ons and voucher boosts applied, and its usage. `source` says which
   * layer grants it, and `provenance` how each layer contributed.
   */
  entitlements: ResolvedEntitlement[];
  /** The add-ons attached to the bound instance, each with its `quantity`. */
  addOns: Addon[];
  vouchers: PortalVoucher[];
  paymentMethod: PaymentMethodSummary | null;
  /** What the next invoice will total, as the server estimates it now. */
  upcomingInvoice: (InvoiceTotals & { boundaryAt: string }) | null;
  capabilities: BillingCapabilities;
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

/** A voucher code's check. Every refusal is the same `{ valid: false }`, whatever its reason. */
export type VoucherValidation =
  | { valid: false }
  | {
      valid: true;
      voucher: {
        name: string;
        voucherType: string;
        /** `ONCE`, `REPEATING` or `FOREVER`. */
        duration: string;
        durationInPeriods: number | null;
        discount?: {
          /** `PERCENTAGE` or `FIXED_AMOUNT`. */
          type: string;
          /** A percentage, or an amount in minor units of `currencyCode`. */
          value: number;
          currencyCode?: CurrencyCode;
          appliesTo: string;
        };
        boosts?: { entitlementSlug: string; modifierType: string; modifierValue: number | null }[];
      };
    };
