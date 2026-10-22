// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The types of the anonymous checkout: a visitor the vendor's backend does not
// know yet buys a self-serve plan from the vendor's own pages, with no account.
// Money follows the SDK's conventions, as everywhere else: `currencyCode`, integer
// minor units, totals from the server only.

import type {
  CheckoutPaymentStatus,
  InvoiceTotals,
  SessionInvoice,
  SessionInvoiceLine,
} from "./session-types.ts";
import type { BillingInterval } from "./types.ts";

/**
 * A billing period of a price, as the API writes it. Open: more may come. A
 * period is also an interval and a count in what the API answers
 * (`CheckoutSession.billingInterval`, `intervalCount`).
 */
export type CheckoutBillingPeriod =
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMI_ANNUAL"
  | "ANNUAL"
  | (string & {});

/**
 * What an anonymous checkout buys, and who buys it.
 *
 * Name the plan by `priceId`, or by `licenseSlug` with a `billingPeriod`, which
 * designates the default flat fee of that period on that version of the plan. One
 * of the two forms, not both: the client refuses anything else before it spends
 * the Turnstile token.
 */
export interface StartCheckoutInput {
  /**
   * The token the Turnstile widget gave the page. It is single-use, and a `dryRun`
   * spends one too: obtain a fresh token for each start.
   */
  turnstileToken: string;
  /** The id of a price of the public catalog (`BillingPrice.id`). */
  priceId?: string;
  /** A version of a public plan, with `billingPeriod`. */
  licenseSlug?: string;
  billingPeriod?: CheckoutBillingPeriod;
  addOns?: { addonSlug: string; quantity: number }[];
  voucherCode?: string;
  /** `false` declines the plan's trial. */
  trial?: boolean;
  /**
   * The buyer's e-mail. It becomes the new customer's billing e-mail once the
   * checkout completes. Required unless `dryRun`.
   */
  email?: string;
  /**
   * Where the hosted setup page sends the visitor back, with
   * `kaiten_checkout_session=<sessionId>` added: https, or http on localhost, on
   * an origin the publishable key allows. Required unless `dryRun`.
   */
  returnUrl?: string;
  /** Your own reference for the buyer, at most 255 characters. Echoed on the checkout's events. */
  clientReferenceId?: string;
  /** `true` computes what is due today and writes nothing. It spends a Turnstile token all the same. */
  dryRun?: boolean;
}

/**
 * Why a trial was not granted. Only `ALREADY_CONSUMED` today: a customer with the
 * same e-mail already had a trial of the plan's family. Open: more may come.
 */
export type TrialRefusedReason = "ALREADY_CONSUMED" | (string & {});

/** What a checkout bills today: the server's totals, and the lines they come from. */
export type CheckoutDueToday = InvoiceTotals & { lines: SessionInvoiceLine[] };

/** What the start of a checkout computed, in a preview and in a session. */
interface CheckoutQuote {
  dueToday: CheckoutDueToday;
  /** The end of the trial the subscription would start with; `null` without one. */
  trialEndsAt: string | null;
  /** Why no trial is granted, when the plan has one. `null` otherwise. */
  trialRefusedReason: TrialRefusedReason | null;
  /** Whether the confirm sends the visitor to a page that saves a payment method. */
  requiresPaymentMethod: boolean;
}

/** A `dryRun`: what the checkout would bill. Nothing was written, and there is no session. */
export interface CheckoutSessionPreview extends CheckoutQuote {
  status: "preview";
}

/**
 * A session opened. Its token is kept by the client that opened it and sent to
 * its own session's routes, and to nowhere else; it is not returned.
 */
export interface CheckoutSessionOpened extends CheckoutQuote {
  status: "open";
  sessionId: string;
  /** When the session is abandoned if it is still open: 24 hours after the start. */
  expiresAt: string;
}

/** The answer of `startCheckout`: a preview of a `dryRun`, or the session opened. */
export type CheckoutSessionStart = CheckoutSessionPreview | CheckoutSessionOpened;

/**
 * Where a checkout session stands. `OPEN`: started. `AWAITING_PAYMENT`: the payment
 * method is saved and the first invoice is being paid. `COMPLETED`: the customer,
 * the instance and the subscription exist. `ABANDONED` and `EXPIRED`: closed
 * without them, the first because it stayed open for 24 hours, the second because
 * the payment never came. Open: more may come.
 */
export type CheckoutSessionStatus =
  | "OPEN"
  | "AWAITING_PAYMENT"
  | "COMPLETED"
  | "ABANDONED"
  | "EXPIRED"
  | (string & {});

/** One anonymous checkout session, as `getCheckoutSession` and `confirmCheckout` read it. */
export interface CheckoutSession extends CheckoutQuote {
  sessionId: string;
  status: CheckoutSessionStatus;
  email: string;
  clientReferenceId: string | null;
  licenseSlug: string;
  /** The period the price bills, as the API writes it. */
  billingPeriod: CheckoutBillingPeriod;
  /** The same period as an interval, when the SDK has one for it. */
  billingInterval?: BillingInterval;
  /** With `billingInterval: "month"`, `3` for a quarter and `6` for half a year. */
  intervalCount?: number;
  priceId: string;
  addOns: { addonSlug: string; quantity: number }[];
  expiresAt: string;
  /** Set by the completion. */
  customerSlug: string | null;
  /** Set by the completion. */
  instanceSlug: string | null;
  /** Once a first invoice was issued. */
  activationInvoice: SessionInvoice | null;
  /** What became of the payment, once one was attempted. */
  payment: { status: CheckoutPaymentStatus; hostedInvoiceUrl: string | null } | null;
  createdAt: string;
  completedAt: string | null;
}

/** A payment method has to be saved first: send the visitor to `setupUrl`, then confirm again. */
export interface ConfirmationRequiresPaymentMethod {
  status: "requires_payment_method";
  setupUrl: string;
  setupExpiresAt: string;
  session: CheckoutSession;
}

/** The setup is done and the first invoice is being paid: read the session until it closes. */
export interface ConfirmationAwaitingPayment {
  status: "awaiting_payment";
  session: CheckoutSession;
}

/** The customer, the instance and the subscription exist. */
export interface ConfirmationCompleted {
  status: "completed";
  session: CheckoutSession;
}

export type CheckoutConfirmation =
  | ConfirmationRequiresPaymentMethod
  | ConfirmationAwaitingPayment
  | ConfirmationCompleted;
