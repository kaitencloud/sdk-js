// What a customer session (kst_) does from the customer's browser:
// /api/public/session/*. The vendor's backend mints the session
// (`@kaitencloud/server`: `CustomerSessions.createCustomerSession`) and hands
// the token to the page, which passes it as a bearer token -- through
// `tokenProvider`, called on every request, so the host can mint a new one
// before `expiresAt` without remounting anything.
//
// The API's shapes are mapped to the SDK's conventions: amounts stay in minor
// units, `currency` becomes `currencyCode`, and a price reads as a `PlanPrice`.
// Totals always come from the server; nothing here adds amounts up.

import type {
  DueToday as DueTodayWire,
  PageSessionInvoice as PageSessionInvoiceWire,
  PublicPrice as PublicPriceWire,
  SessionCheckout as SessionCheckoutWire,
  SessionInvoice as SessionInvoiceWire,
  SessionLine as SessionLineWire,
  SessionSubscription as SessionSubscriptionWire,
} from "../core/generated/types.gen.ts";
import { planPriceFromPublic } from "./public-catalog.ts";
import type { PlanPrice } from "./types.ts";

/** A checkout: the plan's price, and what comes with it. */
export interface CheckoutOrder {
  /** An ACTIVE flat-fee price of a plan in the public catalogue (`PlanPrice.id`). */
  licensePriceId: string;
  /** Public add-ons that fit the plan (`Plan.addOns`), with their quantity. */
  addOns?: { addonSlug: string; quantity?: number }[];
  voucherCode?: string;
  /** Where invoices go. Required when the customer has none. */
  billingEmail?: string;
  /** `false` skips the plan's trial. */
  trial?: boolean;
  /** The `setupSessionId` a `requires_payment_method` answer gave, once the customer is back. */
  setupSessionId?: string;
  /** Where the setup page sends the customer back. Required when a card has to be saved. */
  returnUrl?: string;
}

/** What a checkout bills today. */
export interface CheckoutDue {
  currencyCode: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  lines: SessionInvoiceLine[];
}

/** How paying the first invoice went. */
export interface CheckoutPayment {
  /**
   * - `paid`
   * - `requires_action`: the customer confirms the payment (3-D Secure) on `hostedInvoiceUrl`.
   * - `failed`: the charge was refused; offer another card, or `hostedInvoiceUrl`.
   * - `processing`: not known yet; poll `session.invoices()`.
   * - `not_required`: nothing was due today.
   */
  status: "paid" | "requires_action" | "failed" | "processing" | "not_required";
  hostedInvoiceUrl: string | null;
}

export type CheckoutResult =
  | { status: "preview"; dueToday: CheckoutDue; trialEndsAt: string | null }
  | {
      status: "requires_payment_method";
      setupUrl: string;
      setupSessionId: string;
      expiresAt: string;
    }
  | {
      status: "subscribed";
      subscription: SessionSubscription;
      activationInvoice: SessionInvoice | null;
      payment: CheckoutPayment;
    };

export interface SessionSubscription {
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED";
  providerKind: "NOOP" | "STRIPE";
  collectionMethod: "SEND_INVOICE" | "CHARGE_AUTOMATICALLY";
  currencyCode: string;
  billingPeriod: "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL";
  basePrice: PlanPrice;
  currentPeriodStart: string;
  /** The renewal date, or the end of the trial. */
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface SessionInvoice {
  id: string;
  kind: "ACTIVATION" | "RENEWAL" | "FINAL";
  status: "MANUAL" | "PUSHED" | "PAID" | "PAYMENT_FAILED" | "UNCOLLECTIBLE" | "VOID";
  currencyCode: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  serviceFrom: string;
  serviceTo: string;
  providerInvoiceNumber: string | null;
  externalReference: string | null;
  /** Where the customer pays, or confirms a payment. */
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  lines: SessionInvoiceLine[];
}

export interface SessionInvoiceLine {
  seq: number;
  type: "BASE" | "ADDON" | "USAGE" | "OVERAGE" | "DISCOUNT";
  label: string;
  description: string;
  /** In sale units, a decimal string. */
  quantity: string;
  /** Minor units, a decimal string; empty on a DISCOUNT line. */
  unitAmountDecimal: string;
  /** Minor units; negative on a DISCOUNT line. */
  amount: number;
  serviceFrom: string;
  serviceTo: string;
}

export interface SessionInvoicePage {
  items: SessionInvoice[];
  hasMore: boolean;
  nextCursor: string | null;
}

function lineFrom(line: SessionLineWire): SessionInvoiceLine {
  return { ...line };
}

function dueFrom(due: DueTodayWire): CheckoutDue {
  return {
    currencyCode: due.currency,
    subtotal: due.subtotal,
    discountTotal: due.discountTotal,
    total: due.total,
    lines: due.lines.map(lineFrom),
  };
}

export function sessionInvoiceFrom(invoice: SessionInvoiceWire): SessionInvoice {
  const { currency, lines, ...rest } = invoice;
  return { ...rest, currencyCode: currency, lines: lines.map(lineFrom) };
}

function subscriptionFrom(subscription: SessionSubscriptionWire): SessionSubscription {
  const { currency, basePrice, ...rest } = subscription;
  return {
    ...rest,
    currencyCode: currency,
    basePrice: planPriceFromPublic(basePrice as PublicPriceWire),
    trialEndsAt: subscription.trialEndsAt ?? null,
  };
}

/** Maps POST /api/public/session/checkout. */
export function checkoutFrom(wire: SessionCheckoutWire): CheckoutResult {
  switch (wire.status) {
    case "preview":
      return {
        status: "preview",
        dueToday: dueFrom(
          wire.dueToday ?? { currency: "", subtotal: 0, discountTotal: 0, total: 0, lines: [] },
        ),
        trialEndsAt: wire.trialEndsAt ?? null,
      };
    case "requires_payment_method":
      return {
        status: "requires_payment_method",
        setupUrl: wire.setupUrl ?? "",
        setupSessionId: wire.setupSessionId ?? "",
        expiresAt: wire.expiresAt ?? "",
      };
    default:
      if (!wire.subscription || !wire.payment) {
        throw new TypeError("Kaiten: a subscribed checkout answered without its subscription");
      }
      return {
        status: "subscribed",
        subscription: subscriptionFrom(wire.subscription),
        activationInvoice: wire.activationInvoice
          ? sessionInvoiceFrom(wire.activationInvoice)
          : null,
        payment: {
          status: wire.payment.status,
          hostedInvoiceUrl: wire.payment.hostedInvoiceUrl ?? null,
        },
      };
  }
}

/** Maps GET /api/public/session/invoices. */
export function invoicePageFrom(wire: PageSessionInvoiceWire): SessionInvoicePage {
  return {
    items: wire.items.map(sessionInvoiceFrom),
    hasMore: wire.hasMore,
    nextCursor: wire.nextCursor ?? null,
  };
}
