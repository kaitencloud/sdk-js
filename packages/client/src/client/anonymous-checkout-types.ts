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
 * The plan a checkout buys: by `priceId`, or by `licenseSlug` with a `billingPeriod`, which
 * designates the default flat fee of that period on that version of the plan. One of the two
 * forms, not both: the compiler refuses a start with neither or with both, and the client
 * refuses it too, before it spends the Turnstile token, for a caller that is not type-checked.
 */
export type CheckoutPriceChoice =
  | {
      /** The id of a price of the public catalog (`BillingPrice.id`). */
      priceId: string;
      licenseSlug?: never;
      billingPeriod?: never;
    }
  | {
      priceId?: never;
      /** A version of a public plan, with `billingPeriod`. */
      licenseSlug: string;
      billingPeriod: CheckoutBillingPeriod;
    };

/** What a start takes besides the plan and the buyer's contact. */
interface StartCheckoutOptions {
  /**
   * The token the Turnstile widget gave the page. It is single-use, and a `dryRun`
   * spends one too: obtain a fresh token for each start.
   */
  turnstileToken: string;
  addOns?: { addonSlug: string; quantity: number }[];
  voucherCode?: string;
  /** `false` declines the plan's trial. */
  trial?: boolean;
  /**
   * Your own reference for the buyer, at most 255 characters. Echoed on the checkout's events.
   * Untrusted once it comes back through a browser: a visitor can change it, and a value taken from
   * a request parameter of your page is the visitor's too. Link a buyer to an account from the
   * signed `checkout_session.v1.completed` event your backend receives, never from this value read
   * in the browser.
   */
  clientReferenceId?: string;
}

/**
 * What an anonymous checkout buys, and who buys it.
 *
 * Name the plan with {@link CheckoutPriceChoice}. A real start gives the buyer's `email` and
 * the `returnUrl`, and the compiler asks for both; a `dryRun` computes what is due and takes
 * neither, though it takes an `email` to tell a trial already used from one that is offered.
 */
export type StartCheckoutInput = CheckoutPriceChoice &
  StartCheckoutOptions &
  (
    | {
        /** `true` computes what is due today and writes nothing. It spends a Turnstile token all the same. */
        dryRun: true;
        /** The buyer's e-mail. Optional for a `dryRun`. */
        email?: string;
        /** Optional for a `dryRun`. */
        returnUrl?: string;
      }
    | {
        dryRun?: false;
        /**
         * The buyer's e-mail. It becomes the new customer's billing e-mail once the
         * checkout completes.
         */
        email: string;
        /**
         * Where the hosted setup page sends the visitor back, with
         * `kaiten_checkout_session=<sessionId>` added: https, or http on localhost, on
         * an origin the publishable key allows.
         */
        returnUrl: string;
      }
  );

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
 * A session opened. `token` is the session's `ksc_`, which the API returns once. The
 * client that opened the session keeps it already (in memory and in its `storage`)
 * and sends it to that session's two routes, and to nowhere else: a host reads
 * `token` only to keep it somewhere of its own, such as a server-side session when
 * the page that confirms is not this one. It is a credential: never in a URL, in
 * `localStorage` or in a log.
 */
export interface CheckoutSessionOpened extends CheckoutQuote {
  status: "open";
  sessionId: string;
  /** The session's `ksc_`: a bearer credential for this one session, which reads and confirms it. Do not log or share it. */
  token: string;
  /** When the session is abandoned if it is still open: 24 hours after the start. */
  expiresAt: string;
}

/**
 * The answer of `startCheckout`: a preview of a `dryRun`, or the session opened.
 * A closed union: an answer of any other status rejects with a `KaitenError`
 * instead of reaching the host outside the type.
 */
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

/**
 * A payment method has to be saved first: send the visitor to `setupUrl`, then confirm
 * again. The confirm may have changed the session since the start (a trial another
 * checkout used up meanwhile, which recomposes `session.dueToday`): compare
 * `session.dueToday.total`, `currencyCode` and `trialEndsAt` with what the visitor was
 * shown, and show the new amount before you send them away.
 */
export interface ConfirmationRequiresPaymentMethod {
  status: "requires_payment_method";
  setupUrl: string;
  setupExpiresAt: string;
  session: CheckoutSession;
}

/**
 * The setup is done and the first invoice is being paid: read the session until it closes.
 * Read `session.payment` meanwhile: `requires_action` means the visitor must go to
 * `hostedInvoiceUrl` (3-D Secure, say) to authorise the payment, and `failed` that the
 * payment was refused, with the same page to pay again.
 */
export interface ConfirmationAwaitingPayment {
  status: "awaiting_payment";
  session: CheckoutSession;
}

/** The customer, the instance and the subscription exist. */
export interface ConfirmationCompleted {
  status: "completed";
  session: CheckoutSession;
}

/**
 * The answer of `confirmCheckout`. A closed union: an answer of any other status
 * rejects with a `KaitenError`, and `getCheckoutSession` tells where the session stands.
 */
export type CheckoutConfirmation =
  | ConfirmationRequiresPaymentMethod
  | ConfirmationAwaitingPayment
  | ConfirmationCompleted;
