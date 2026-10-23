// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A stand-in for Kaiten, to run the storefront and its end-to-end tests without one.
//
// It answers the routes the storefront calls: the public catalogue, the minting of a customer
// session, and the eleven routes of `/public/session/*`. The answers are the ones recorded from
// Kaiten's own code in the client's fixtures, which `fixtures-contract.test.ts` holds to the
// API contract; what it adds to them is a customer who moves. A checkout subscribes the
// instance, after a card has been saved on a provider's page if there is none (and replaces a free
// subscription), and keeps the add-ons the instance holds, billed from its activation or
// refused when the new price cannot bill them; a cancellation ends the subscription with its
// period, and leaves the add-ons on the instance; a payment can be declined, wait for the
// customer's confirmation, or be unknown for a while. A presenter can move it to the next
// boundary: a trial converts, a period renews (an invoice that can fail and leave the
// subscription PAST_DUE), a scheduled plan change applies, a cancellation takes effect.
//
// The vendor's own reads and updates of a customer and an instance (`GET` and `PUT` on both) are
// there too, for the storefront to name what an anonymous checkout made. A completed checkout's
// customer and instance are made by Kaiten's own identity, as in Kaiten, and carry the visitor's
// address as their name until a vendor writes another.
//
// It also plays a Kaiten with no customer yet: in the sign-up scenario (`Scenario.signUp`) a visitor
// makes one, through `POST /customers` and `POST /instances`, and then gets a session for it, as a
// vendor's backend does when someone signs up on its site. It plays one instance at a time: a new
// instance starts the billing state over, on the licence it was created on, and replaces the account
// before it (no session is minted for that one any more, and the sessions it held end).
//
// It is not a Kaiten. The sums are its own (a plan's price, an add-on's, a voucher's
// percentage), the entitlements are the plan's own as the catalogue lists them (limits from the
// catalogue, usage a fixed share of the limit, nothing metered), and it accepts every origin and
// never limits a rate. What it proves is that the storefront asks for the right routes with
// the right credentials, and that the SDK's components draw what comes back, including the
// refusals a test makes it send. It proves nothing about Kaiten.
//
// It speaks HTTP: the page reaches it under `/kaiten-double/api`, as it would reach a Kaiten
// under `/api`, and the storefront's own backend reaches it through the `fetch` the server SDK
// is given. Beside the API it serves the pages of a payment provider (a card to save, an invoice
// to pay) and a control surface for tests under `/kaiten-double/control`.

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type { Route } from "../http.ts";
import { generateSlug } from "../slug.ts";
import {
  aMomentAgo,
  CONFIRM,
  describeSession,
  isEmail,
  isReturnUrl,
  readDraft,
  readStatus,
  SESSION_LIFETIME_MS,
  sessionClosed,
  sessionView,
  START,
  trialKey,
  TURNSTILE_RETRY_SECONDS,
  TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_VERDICTS,
  type CheckoutStatus,
  type Draft,
  type StoredCheckout,
  type TurnstileVerdict,
} from "./anonymous-checkout.ts";
import { addMonths, html, iso, money, MONTHS, normalizeCode, problem, reply } from "./responses.ts";

type Json = Record<string, any>;

const fixture = (name: string): Json =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../packages/client/tests/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  );

/** Where the double is mounted, for the page. The storefront's backend reaches the API without it. */
export const DOUBLE_PATH = "/kaiten-double";

/** An answer a test scripts for a route: a status, a body, and the `Retry-After` it may carry. */
export interface Reply {
  status: number;
  body?: unknown;
  retryAfter?: number;
  /**
   * Only for a checkout: `true` answers a preview (`dryRun`) and nothing else, `false` a checkout
   * that subscribes. A reply that does not fit the call is left for the next one that does.
   */
  dryRun?: boolean;
}

/** What became of the payment of the next activation invoice. */
export type PaymentOutcome = "paid" | "requires_action" | "failed" | "processing";

export interface KaitenDoubleOptions {
  /** The token the minting route accepts, as `Authorization: Bearer`. */
  serverToken: string;
  /** The publishable key the catalogue accepts, as `X-Kaiten-Publishable-Key`. */
  publishableKey: string;
  /**
   * The public catalogue it serves and sells from, in the shape of `GET /public/catalog`: Acme's,
   * as recorded, unless a test gives another.
   */
  catalog?: Json;
}

/** What the double kept of a request, with its credentials cut to what says which kind they are. */
export interface Call {
  method: string;
  /** The path below the API's prefix: `/public/session/portal`. */
  path: string;
  /** `kst_`, `ksc_`, `ksh_`, `pk_`, or `none`: the kind of credential that came with it, never the credential. */
  credential: "kst_" | "ksc_" | "ksh_" | "pk_" | "none" | "other";
  /** The `Origin` header, which a browser sets and a backend does not. */
  origin: string | null;
  status: number;
  /** The body of a request that has one, with a voucher code taken out. */
  body: unknown;
}

/** What the double says Kaiten would have told the vendor, in the order it happened. Nothing is delivered. */
export interface DoubleEvent {
  /** The event's name, without `com.kaiten.` and the version: `instance.billing.started`. */
  type: string;
  at: string;
  /** One line, for a person: what it was about. */
  detail: string;
}

/** What moving to the next boundary did, or why it could not. */
export type BoundaryResult =
  | {
      ok: true;
      /** `trial_converted`, `renewed`, `plan_changed` (renewed on another plan) or `canceled`. */
      applied: "trial_converted" | "renewed" | "plan_changed" | "canceled";
      /** The invoice the boundary issued, when it issued one. */
      invoiceId: string | null;
    }
  | { ok: false; code: string; detail: string };

export interface KaitenDouble {
  /** Routes `/kaiten-double/**` (and `/api/**`, which the storefront's backend calls). */
  route: Route;
  /** Starts again from a customer with nothing: no subscription, no card, no email. */
  reset: (scenario?: Scenario) => void;
  /** Whether the scenario is a visitor who has no account yet (see `Scenario.signUp`). */
  signUp: () => boolean;
  /** Answers the next calls to `METHOD /path` with these, in turn, instead of what it would. */
  script: (key: string, ...replies: Reply[]) => void;
  /** What the next activation invoice's payment comes to. */
  payment: (outcome: PaymentOutcome) => void;
  /** The customer pays an invoice, as on the provider's page. */
  payInvoice: (id: string) => boolean;
  /** An open payment is declined (`failed`), as the provider would tell a few seconds on. */
  declineInvoice: (id: string) => boolean;
  /**
   * Moves the subscription to its next boundary, as Kaiten's close would when the time came: a trial
   * converts (an ACTIVATION invoice), a period renews (a RENEWAL invoice, on the new plan when one was
   * scheduled), a cancellation takes effect. The invoice is paid, declined or left unknown as
   * `payment` says; one that is not paid leaves the subscription PAST_DUE.
   */
  advance: (origin?: string) => BoundaryResult;
  /** Ends a trial now, which is moving a trial to its boundary. Refused for a subscription that is not in one. */
  endTrial: (origin?: string) => BoundaryResult;
  /** Switches the publishable key's anonymous checkout on or off: the catalogue says so, and a start is refused when it is off. */
  anonymousCheckout: (enabled: boolean) => void;
  /**
   * What the security check of the next `times` verifications comes to (all of them when `times` is left
   * out; passing again after them): Cloudflare refuses the token, cannot be reached, or the key has no
   * secret. A real token is never looked at: the stand-in only plays the verdict.
   */
  turnstile: (verdict: TurnstileVerdict, times?: number) => void;
  /**
   * Lets the time pass that closes the newest checkout session still waiting: one that was never
   * confirmed is abandoned after 24 hours, one whose first payment never came expires. Refused when
   * no session is waiting.
   */
  expireCheckout: () => { ok: true; sessionId: string; status: CheckoutStatus } | { ok: false };
  /** What Kaiten would have told the vendor so far. */
  events: () => DoubleEvent[];
  calls: () => Call[];
  /** The state worth asserting on. */
  state: () => DoubleState;
}

export interface DoubleState {
  subscribed: boolean;
  cancelAtPeriodEnd: boolean;
  cardOnFile: boolean;
  billingEmail: string | null;
  invoices: Array<{
    id: string;
    kind: string;
    status: string;
    total: number;
    currency: string;
    providerInvoiceNumber: string;
  }>;
  minted: number;
  revoked: number;
  /** What becomes of the next payment, as `payment` last set it. */
  payment: PaymentOutcome;
  /** The slug of the plan the instance is on, `null` before any subscription. It survives the subscription's end. */
  plan: string | null;
  planName: string | null;
  /** `TRIAL`, `ACTIVE` or `PAST_DUE`; `null` without a live subscription. */
  status: string | null;
  /** The live subscription has no PAID price: a checkout replaces it. */
  free: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** A plan change waiting for the boundary. */
  scheduledChange: { plan: string; priceId: string; effectiveAt: string } | null;
  addOns: Array<{ slug: string; quantity: number }>;
  /** The card on file, for a person: `Visa 4242`. */
  card: string | null;
  /**
   * The customers it holds, in order: the ones a sign-up scenario's visitor made and the ones a
   * completed anonymous checkout made (`createdBy: "system"`, as Kaiten's own identity makes them).
   */
  customers: Array<{
    slug: string;
    name: string;
    billingEmail: string | null;
    createdBy: "service" | "system";
  }>;
  /** The instances it holds, with the licence each started on and what a vendor may have written to them. */
  instances: Array<{
    slug: string;
    customerSlug: string;
    licenseSlug: string;
    name: string;
    description: string;
  }>;
  /** Whether the publishable key starts anonymous checkouts. */
  anonymousCheckout: boolean;
  /** The anonymous checkout sessions it holds, oldest first. */
  checkoutSessions: Array<{
    id: string;
    status: CheckoutStatus;
    email: string;
    clientReferenceId: string | null;
    licenseSlug: string;
    customerSlug: string | null;
    instanceSlug: string | null;
    /** The payment of the first invoice, once there is one. */
    payment: StoredCheckout["payment"];
  }>;
  /** How many Turnstile tokens it was asked to verify. Never what they were. */
  turnstileChecks: number;
  /** How many times a token that had been verified was sent again, and refused for it. */
  turnstileReused: number;
}

/** How the customer starts. */
export interface Scenario {
  /** The customer already has a payment method saved. */
  card?: boolean;
  /** The customer already has a billing email. */
  email?: boolean;
  /** The instance is already subscribed to Pro, monthly, and paid its first invoice: a customer with a card and an email. */
  subscribed?: boolean;
  /**
   * The instance is subscribed to Starter, which is free: a customer with an email and, unless `card`
   * says so, no card. A checkout of a paid plan replaces that subscription.
   */
  free?: boolean;
  /**
   * The visitor has no account: the stand-in holds no customer and no instance until `POST /customers`
   * and `POST /instances` make them, and a session is minted for them only. The other members are
   * ignored with it, and the storefront's backend runs in sign-up mode while it is on.
   */
  signUp?: boolean;
  /**
   * The publishable key starts anonymous checkouts: the catalogue says so, with a Turnstile site key, and a
   * visitor buys with no account. Off by default.
   */
  anonymousCheckout?: boolean;
}

/** What a payment can come to, as `/control/payment` is told. */
const OUTCOMES: PaymentOutcome[] = ["paid", "requires_action", "failed", "processing"];

/** A card brand as a person writes it. */
const cardBrand = (brand: unknown) => String(brand).replace(/^./, (first) => first.toUpperCase());

/** An invoice's status as the provider's page says it. */
const INVOICE_STATUS: Record<string, string> = {
  PAID: "Paid",
  PUSHED: "Processing",
  PAYMENT_FAILED: "Payment failed",
};

/** The one voucher the double knows. */
const VOUCHER_CODE = "WELCOME20";

/** The invoices it discounts: three, as the recorded `voucherPercent` says. */
const VOUCHER_INVOICES = 3;

export function createKaitenDouble(options: KaitenDoubleOptions): KaitenDouble {
  const session = fixture("session.initech.json");
  const catalog = options.catalog ?? fixture("public-catalog.acme.json");

  type Stored = {
    id: string;
    token: string;
    customerSlug: string;
    instanceSlug: string | null;
    expiresAt: number;
    revoked: boolean;
  };

  /** Who made a customer or an instance: the vendor's service account, or Kaiten itself (an anonymous checkout's completion). */
  type Actor = "service" | "system";
  type StoredCustomer = {
    id: string;
    slug: string;
    name: string;
    billingEmail: string | null;
    domain: string | null;
    externalCustomerId: string | null;
    createdBy: Actor;
    createdAt: string;
    updatedAt: string;
  };
  type StoredInstance = {
    id: string;
    slug: string;
    name: string;
    description: string;
    customerId: string;
    customerSlug: string;
    licenseId: string;
    licenseSlug: string;
    startLicenseDate: string;
    endLicenseDate: string;
    metadata: Json;
    createdBy: Actor;
    createdAt: string;
    updatedAt: string;
  };

  /** The cards a customer can save on the provider's page, in turn: changing it changes the card. */
  const CARDS: Array<{ method: Json; number: string }> = [
    { method: session.portal.paymentMethod, number: "4242 4242 4242 4242" },
    {
      method: { status: "ACTIVE", brand: "mastercard", last4: "4444", expMonth: 6, expYear: 2031 },
      number: "5555 5555 5555 4444",
    },
  ];

  let subscription: Json | null;
  /** What the subscription was created with and never changes: the vendor's view of it reads them. */
  let subscriptionMeta: { id: string; anchorAt: string; createdAt: string };
  let planName: string | null;
  let planSlug: string | null;
  let canceling: boolean;
  let pastDueSince: string | null;
  /** A plan change the vendor scheduled: applied at the next boundary. */
  let scheduled: { plan: Json; price: Json; scheduledAt: string } | null;
  let card: Json | null;
  let billingEmail: string | null;
  let invoices: Json[];
  /** The invoices whose failure leaves the subscription PAST_DUE: a renewal's and a trial's conversion. */
  let dunning: Set<string>;
  let addOns: Json[];
  /**
   * The code the instance redeemed, as the portal lists it (`SessionRedemption`): the one voucher the
   * double knows, taken once per instance, at a checkout or from the portal. Its discount is on the
   * invoices composed after it.
   */
  let redeemed: Json | null;
  let setups: Map<
    string,
    {
      returnUrl: string;
      saved: boolean;
      card: (typeof CARDS)[number];
      /** The anonymous checkout session that opened it: its card is that session's, not the instance's. */
      checkout?: string;
    }
  >;
  let sessions: Map<string, Stored>;
  let log: Call[];
  let events: DoubleEvent[];
  let scripts: Map<string, Reply[]>;
  let outcome: PaymentOutcome;
  let minted: number;
  let revoked: number;
  /** A sign-up scenario: the customers and instances below are the ones a visitor made. */
  let signedUp: boolean;
  let customers: StoredCustomer[];
  let instances: StoredInstance[];
  /** The publishable key's anonymous checkout, and what the security check comes to. */
  let anonymousOn: boolean;
  let verdict: { value: TurnstileVerdict; remaining: number };
  let verified: number;
  /** The Turnstile tokens Cloudflare has been asked about: each is good for one verification. */
  let spentTokens: Set<string>;
  /** How many times a token that was spent came back. */
  let tokenReuses: number;
  let checkouts: Map<string, StoredCheckout>;
  /** The trials an address consumed, by family (see `trialKey`). */
  let trialsTaken: Set<string>;

  /** The card the next setup page offers: the one that is not on file, so that a change is seen. */
  const nextCard = () => {
    const at = CARDS.findIndex((each) => each.method.last4 === card?.last4);
    return CARDS[(at + 1) % CARDS.length]!;
  };

  const emit = (type: string, detail: string, at: Date = new Date()) => {
    events.push({ type, at: iso(at.getTime()), detail });
  };

  /**
   * A subscription, as the portal reads it, on a price of the catalogue. A trial's period is the
   * trial: it ends when the trial does, and the first billing period starts then.
   */
  const newSubscription = (price: Json, from: Date, trialEndsAt: string | null): Json => {
    const end = trialEndsAt
      ? new Date(trialEndsAt)
      : addMonths(from, MONTHS[price.billingPeriod] ?? 1);
    subscriptionMeta = {
      id: randomUUID(),
      anchorAt: iso(from.getTime()),
      createdAt: iso(Date.now()),
    };
    return {
      ...structuredClone(session.checkoutSubscribed.subscription),
      status: trialEndsAt ? "TRIAL" : "ACTIVE",
      providerKind: "STRIPE",
      collectionMethod: "CHARGE_AUTOMATICALLY",
      currency: price.currency,
      billingPeriod: price.billingPeriod,
      basePrice: structuredClone(price),
      currentPeriodStart: iso(from.getTime()),
      currentPeriodEnd: iso(end.getTime()),
      trialEndsAt,
      cancelAtPeriodEnd: false,
      scheduledChange: null,
    };
  };

  /** What the customer holds: a subscription, a card, an email, invoices and add-ons, as `scenario` says. */
  const startBilling = (scenario: Scenario) => {
    subscription = null;
    subscriptionMeta = { id: randomUUID(), anchorAt: iso(Date.now()), createdAt: iso(Date.now()) };
    planName = null;
    planSlug = null;
    canceling = false;
    pastDueSince = null;
    scheduled = null;
    card =
      scenario.card || scenario.subscribed ? structuredClone(session.portal.paymentMethod) : null;
    billingEmail =
      scenario.email || scenario.subscribed || scenario.free ? "billing@storefront.test" : null;
    invoices = [];
    dunning = new Set();
    addOns = [];
    redeemed = null;
    if (scenario.subscribed) {
      const now = new Date();
      const end = addMonths(now, 1);
      planName = "Pro";
      planSlug = "pro-v2";
      subscription = {
        ...structuredClone(session.portal.subscription),
        currentPeriodStart: iso(now.getTime()),
        currentPeriodEnd: iso(end.getTime()),
      };
      const paid = structuredClone(session.checkoutSubscribed.activationInvoice);
      invoices = [
        {
          ...paid,
          issuedAt: iso(now.getTime()),
          dueAt: iso(now.getTime()),
          paidAt: iso(now.getTime()),
          serviceFrom: iso(now.getTime()),
          serviceTo: iso(end.getTime()),
        },
      ];
    } else if (scenario.free) {
      const starter = (catalog.plans as Json[]).find((each) => each.pricingType === "FREE")!;
      planName = starter.name;
      planSlug = starter.licenseSlug;
      subscription = newSubscription(starter.prices[0], new Date(), null);
    }
    // The provider's pages a visitor's checkout opened are not this customer's: they outlive it.
    setups = new Map([...(setups ?? [])].filter(([, setup]) => setup.checkout !== undefined));
  };

  const reset = (scenario: Scenario = {}) => {
    signedUp = scenario.signUp === true;
    customers = [];
    instances = [];
    anonymousOn = scenario.anonymousCheckout === true;
    verdict = { value: "pass", remaining: Infinity };
    verified = 0;
    spentTokens = new Set();
    tokenReuses = 0;
    checkouts = new Map();
    trialsTaken = new Set();
    // A visitor with no account has nothing of the billing a scenario describes.
    startBilling(signedUp ? {} : scenario);
    events = [];
    sessions = new Map();
    log = [];
    scripts = new Map();
    outcome = "paid";
    minted = 0;
    revoked = 0;
  };
  reset();

  // ---- What the catalogue sells --------------------------------------------

  const findPrice = (id: string) => {
    for (const plan of catalog.plans as Json[]) {
      const price = (plan.prices as Json[]).find((each) => each.id === id);
      if (price) return { plan, price };
    }
    return undefined;
  };

  const findAddOnPrice = (slug: string, currency: string, period: string) => {
    const addon = (catalog.addOns as Json[]).find((each) => each.addonSlug === slug);
    const price =
      (addon?.prices as Json[] | undefined)?.find(
        (each) =>
          each.billingModel === "FLAT_FEE" &&
          each.currency === currency &&
          each.billingPeriod === period,
      ) ??
      (addon?.prices as Json[] | undefined)?.find(
        (each) => each.billingModel === "FLAT_FEE" && each.currency === currency && each.isDefault,
      );
    return addon && price ? { addon, price } : undefined;
  };

  const planBySlug = (slug: string | null) =>
    (catalog.plans as Json[]).find((each) => each.licenseSlug === slug);

  /** The fee a period bills an add-on at: its default flat fee of that period, in the currency. */
  const billedFee = (prices: Json[], currency: string, period: string): Json | undefined =>
    prices.find(
      (each) =>
        each.billingModel === "FLAT_FEE" &&
        each.isDefault &&
        each.currency === currency &&
        each.billingPeriod === period,
    );

  /**
   * Why Kaiten would not bill an add-on the instance holds beside a base price, as the attachment's
   * own code: priced in another currency, or paid with flat fees and none for the period. `null`
   * when it would. A version the catalogue no longer lists is checked as a paid one.
   */
  const heldRefusal = (held: Json, base: Json): string | null => {
    const prices = held.prices as Json[];
    if (prices.some((each) => each.currency !== base.currency)) {
      return "AttachInstanceAddon.CurrencyMismatch";
    }
    const pricingType =
      (catalog.addOns as Json[]).find((each) => each.addonSlug === held.addonSlug)?.pricingType ??
      "PAID";
    const fees = prices.filter((each) => each.billingModel === "FLAT_FEE");
    if (
      pricingType === "PAID" &&
      fees.length > 0 &&
      !billedFee(prices, base.currency, base.billingPeriod)
    ) {
      return "AttachInstanceAddon.NoPriceForBillingPeriod";
    }
    return null;
  };

  /**
   * The catalogue as a page of `origin` reads it. The recorded one sends a buyer who cannot buy by
   * themselves to an address of someone else's; the stand-in sends every plan that is not free to
   * the storefront's own "Talk to sales" page, which is where the portal's "Change plan" goes too.
   */
  const catalogFor = (origin: string): Json => {
    const shown = structuredClone(catalog);
    shown.capabilities = {
      ...shown.capabilities,
      anonymousCheckout: anonymousOn,
      turnstileSiteKey: anonymousOn ? TURNSTILE_TEST_SITE_KEY : null,
    };
    for (const plan of shown.plans as Json[]) {
      plan.selfServeCtaUrl =
        plan.pricingType === "FREE"
          ? null
          : `${origin}/sales?plan=${encodeURIComponent(plan.licenseSlug)}`;
    }
    return shown;
  };

  /**
   * Whether the live subscription is free: its plan is FREE and no add-on it holds has a
   * price above 0. A subscription that is not is never replaced by a checkout.
   */
  const isFree = (): boolean => {
    if (subscription === null || planBySlug(planSlug)?.pricingType !== "FREE") return false;
    return addOns.every(
      (held) =>
        (findAddOnPrice(held.addonSlug, subscription!.currency, subscription!.billingPeriod)?.price
          .unitAmount ?? 0) === 0,
    );
  };

  // ---- A checkout, priced ---------------------------------------------------

  /**
   * What a checkout bills today: the double's own sums, as a server's are. `operation` names the
   * refusals (a customer's checkout or a visitor's), and `held` is the add-ons the instance already
   * holds, which an activation bills too: a visitor's instance does not exist yet, and holds none.
   */
  function price(
    order: Json,
    operation = "CreateSessionCheckout",
    held: Json[] = addOns,
  ): {
    problem?: Response;
    due?: Json;
    trialEndsAt?: string;
    plan?: Json;
  } {
    const found = findPrice(String(order.licensePriceId));
    if (!found) {
      return {
        problem: problem(
          422,
          `${operation}.PriceNotPublic`,
          "licensePriceId is not an ACTIVE price of a plan in the public catalogue",
        ),
      };
    }
    const { plan, price: base } = found;
    if (base.billingModel !== "FLAT_FEE") {
      return {
        problem: problem(
          422,
          `${operation}.PriceNotFlatFee`,
          "a subscription is bought on a flat-fee price",
        ),
      };
    }
    if (plan.pricingType === "CUSTOM") {
      return {
        problem: problem(422, `${operation}.NotSelfServe`, "this plan is priced on request"),
      };
    }

    const from = new Date();
    const to = addMonths(from, MONTHS[base.billingPeriod] ?? 1);
    const span = { serviceFrom: iso(from.getTime()), serviceTo: iso(to.getTime()) };
    const currency: string = base.currency;
    const lines: Json[] = [];
    let subtotal = 0;

    if (base.unitAmount > 0) {
      lines.push({
        seq: lines.length + 1,
        type: "BASE",
        label: plan.name,
        description: `1 × ${money(base.unitAmount, currency)}`,
        quantity: "1",
        unitAmountDecimal: String(base.unitAmount),
        amount: base.unitAmount,
        ...span,
      });
      subtotal += base.unitAmount;
    }
    // The add-ons the instance already holds are active at the activation, and billed by it at
    // their fee for the new period. One that cannot be billed is refused by the checkout itself.
    for (const kept of held) {
      const fee = billedFee(kept.prices as Json[], currency, base.billingPeriod);
      if (!fee) continue;
      const amount = fee.unitAmount * kept.quantity;
      lines.push({
        seq: lines.length + 1,
        type: "ADDON",
        label: kept.name,
        description: `${kept.quantity} × ${money(fee.unitAmount, currency)}`,
        quantity: String(kept.quantity),
        unitAmountDecimal: String(fee.unitAmount),
        amount,
        ...span,
      });
      subtotal += amount;
    }
    for (const [at, wanted] of ((order.addOns ?? []) as Json[]).entries()) {
      const addon = (catalog.addOns as Json[]).find((each) => each.addonSlug === wanted.addonSlug);
      if (!addon || !(plan.compatibleAddonFamilies as string[]).includes(addon.familySlug)) {
        return {
          problem: problem(
            422,
            `${operation}.AddonNotPublic`,
            `"${wanted.addonSlug}" is not a public add-on that fits this plan`,
          ),
        };
      }
      if (addon.maxQuantity != null && wanted.quantity > addon.maxQuantity) {
        return {
          problem: problem(
            422,
            `${operation}.QuantityExceedsMax`,
            `at most ${addon.maxQuantity} of "${wanted.addonSlug}"`,
          ),
        };
      }
      // One currency per subscription: an add-on priced in another than the plan's cannot be
      // attached to it. One with no price has none to differ.
      const prices = addon.prices as Json[];
      if (prices.some((each) => each.currency !== currency)) {
        return {
          problem: problem(
            422,
            `${operation}.CurrencyMismatch`,
            `"${wanted.addonSlug}" is not priced in ${currency}, the plan's currency`,
          ),
        };
      }
      // A paid add-on with flat fees is billed its default fee of the period, and needs one; any
      // other refusal of the attachment is AddonInvalid, with the attachment's own code inside.
      const fees = prices.filter((each) => each.billingModel === "FLAT_FEE");
      const fee = fees.find((each) => each.isDefault && each.billingPeriod === base.billingPeriod);
      if (addon.pricingType === "PAID" && fees.length > 0 && !fee) {
        return {
          problem: problem(
            422,
            `${operation}.AddonInvalid`,
            `"${wanted.addonSlug}" has no price for the plan's billing period`,
            "",
            {
              errors: [
                {
                  location: `body.addOns[${at}]`,
                  message: "no default price for the billing period",
                  value: { code: "AttachInstanceAddon.NoPriceForBillingPeriod" },
                },
              ],
            },
          ),
        };
      }
      // Billed no flat fee (metered only, free or custom), it adds nothing to what is due today.
      if (wanted.quantity <= 0 || !fee) continue;
      const amount = fee.unitAmount * wanted.quantity;
      lines.push({
        seq: lines.length + 1,
        type: "ADDON",
        label: addon.name,
        description: `${wanted.quantity} × ${money(fee.unitAmount, currency)}`,
        quantity: String(wanted.quantity),
        unitAmountDecimal: String(fee.unitAmount),
        amount,
        ...span,
      });
      subtotal += amount;
    }

    let discountTotal = 0;
    if (order.voucherCode !== undefined) {
      if (normalizeCode(String(order.voucherCode)) !== VOUCHER_CODE) {
        return {
          problem: problem(422, `${operation}.VoucherInvalid`, "this voucher cannot be applied"),
        };
      }
      discountTotal = Math.round((base.unitAmount * 20) / 100);
      if (discountTotal > 0) {
        lines.push({
          seq: lines.length + 1,
          type: "DISCOUNT",
          label: "Welcome 20%",
          description: "20% off the base fee",
          quantity: "1",
          unitAmountDecimal: null,
          amount: -discountTotal,
          ...span,
        });
      }
    }

    const trialDays: number = plan.trialPeriodDays ?? 0;
    if (trialDays > 0 && order.trial !== false) {
      return {
        plan,
        due: { currency, subtotal: 0, discountTotal: 0, total: 0, lines: [] },
        trialEndsAt: iso(from.getTime() + trialDays * 86_400_000),
      };
    }
    return {
      plan,
      due: { currency, subtotal, discountTotal, total: subtotal - discountTotal, lines },
    };
  }

  /**
   * What the subscribe of a checkout refuses of the add-ons once the instance can be subscribed,
   * after the order's own were found in the catalogue and priced: an order's add-on of a family the
   * instance already holds, then each add-on it holds that the base price cannot bill. Kaiten
   * attaches no second add-on of a family, and keeps what the instance holds through a subscribe,
   * billed from its activation, as long as it can be billed. `null` when nothing is refused.
   */
  function addOnRefusal(order: Json, base: Json, path: string): Response | null {
    const families = new Set(addOns.map((held) => held.familySlug as string));
    for (const [at, wanted] of ((order.addOns ?? []) as Json[]).entries()) {
      if (!(wanted.quantity > 0)) continue;
      const addon = (catalog.addOns as Json[]).find((each) => each.addonSlug === wanted.addonSlug)!;
      if (families.has(addon.familySlug)) {
        return problem(
          422,
          "CreateSessionCheckout.AddonInvalid",
          `"${wanted.addonSlug}" is of a family the instance already holds: change its quantity instead`,
          path,
          {
            errors: [
              {
                location: `body.addOns[${at}]`,
                message: "an add-on of this family is already attached",
                value: { code: "AttachInstanceAddon.FamilyAlreadyAttached" },
              },
            ],
          },
        );
      }
      families.add(addon.familySlug);
    }

    // One entry per attachment refused, named by its slug. The checkout answers with the code of
    // the first: CurrencyMismatch for another currency, AddonInvalid for anything else.
    const refused = addOns.flatMap((held) => {
      const code = heldRefusal(held, base);
      return code
        ? [
            {
              location: `addons.${held.addonSlug}`,
              message:
                code === "AttachInstanceAddon.CurrencyMismatch"
                  ? `priced in another currency than ${base.currency}`
                  : "no default price for the billing period",
              value: { code },
            },
          ]
        : [];
    });
    if (refused.length === 0) return null;
    return problem(
      422,
      refused[0]!.value.code === "AttachInstanceAddon.CurrencyMismatch"
        ? "CreateSessionCheckout.CurrencyMismatch"
        : "CreateSessionCheckout.AddonInvalid",
      "an add-on the instance holds cannot be billed with this price",
      path,
      { errors: refused },
    );
  }

  // ---- The portal -----------------------------------------------------------

  /**
   * What the portal lists of the plan the customer is on: the catalogue's entitlements of that plan,
   * drawn as the fixture draws them (its names, its period), with the plan's limit and a usage that
   * is a share of it. The fixture is one customer's, on no plan of this catalogue: its limits and
   * its full seats would show a Starter customer at 8 seats of 8. Nothing here is metered.
   */
  const planEntitlements = (slug: string | null, fixtures: Json[]): Json[] => {
    const plan = (catalog.plans as Json[]).find((each) => each.licenseSlug === slug);
    if (!plan) return [];
    const drawn: Json[] = [];
    for (const wanted of plan.entitlements as Json[]) {
      const base = fixtures.find((each) => each.slug === wanted.slug);
      if (!base) continue;
      const entitlement = structuredClone(base);
      entitlement.source = "license";
      entitlement.provenance = null;
      if (wanted.type === "BOOLEAN") {
        entitlement.limitValue = { type: "boolean", value: wanted.value };
      } else if (wanted.unlimited) {
        Object.assign(entitlement, {
          limitValue: { type: "number", value: -1 },
          unlimited: true,
          maximumAllowedUsage: null,
          percentageUsed: null,
        });
      } else {
        // The fixture's share of use, unless that is a full meter: a customer who has just bought
        // is not at the limit.
        const share = entitlement.percentageUsed >= 100 ? 40 : (entitlement.percentageUsed ?? 0);
        const used = Math.floor((wanted.value * share) / 100);
        const overage =
          wanted.limitCapExceededOveragePercent > 0 ? wanted.limitCapExceededOveragePercent : 0;
        Object.assign(entitlement, {
          limitValue: { type: "number", value: wanted.value },
          unlimited: false,
          currentValue: used,
          limitCapExceededOveragePercent: overage,
          maximumAllowedUsage: Math.floor((wanted.value * (100 + overage)) / 100),
          percentageUsed: wanted.value > 0 ? Math.floor((used * 100) / wanted.value) : 0,
        });
      }
      drawn.push(entitlement);
    }
    return drawn;
  };

  const portalOf = (stored: Stored): Json => {
    const portal = structuredClone(subscription ? session.portal : session.portalNeverSubscribed);
    portal.customer = {
      slug: stored.customerSlug,
      name:
        customers.find((each) => each.slug === stored.customerSlug)?.name ??
        "Acme storefront customer",
      billingEmail,
    };
    if (stored.instanceSlug === null) {
      portal.instance = null;
      portal.subscription = null;
      portal.entitlements = [];
      portal.addOns = [];
      portal.upcomingInvoice = null;
      portal.capabilities = { ...portal.capabilities, unsubscribe: false, checkout: false };
    } else {
      portal.instance = {
        slug: stored.instanceSlug,
        name: stored.instanceSlug,
        // The plan outlives the subscription, as the licence does until a fallback moves it.
        licenseSlug: planSlug ?? portal.instance.licenseSlug,
        licenseName: planName ?? portal.instance.licenseName,
      };
      portal.subscription = subscription
        ? {
            ...subscription,
            cancelAtPeriodEnd: canceling,
            scheduledChange: scheduled
              ? {
                  price: structuredClone(scheduled.price),
                  effectiveAt: subscription.currentPeriodEnd,
                }
              : null,
          }
        : null;
      portal.trial = subscription?.status === "TRIAL" ? trialBlock(subscription) : null;
      portal.addOns = structuredClone(addOns);
      portal.entitlements = planEntitlements(planSlug, portal.entitlements);
      portal.upcomingInvoice = null;
      portal.capabilities = {
        paymentMethods: true,
        invoices: true,
        unsubscribe: subscription !== null && !canceling,
        // An instance with no live subscription, or a free one, can check out.
        checkout: subscription === null || isFree(),
      };
    }
    portal.paymentMethod = card ? structuredClone(card) : null;
    portal.vouchers = redeemed ? [structuredClone(redeemed)] : [];
    portal.updatedAt = new Date().toISOString();
    return portal;
  };

  // ---- The customers and instances a visitor's sign-up makes ---------------

  /** The service account that "created" what a sign-up made: the contract asks who did. */
  const SERVICE = {
    id: "00000000-0000-4000-8000-0000000000f0",
    name: "Storefront service account",
  };
  /**
   * Kaiten's own identity, which makes what a completed anonymous checkout creates. Its id is the one
   * the API pins for it, and it is how a vendor tells a customer made by a checkout from one a person
   * or a service made.
   */
  const SYSTEM = { id: "00000000-0000-0000-0000-000000000001", name: "Kaiten" };
  const actorOf = (actor: Actor) => (actor === "system" ? SYSTEM : SERVICE);
  const SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  const validSlug = (slug: unknown) =>
    typeof slug === "string" && slug.length >= 2 && slug.length <= 100 && SLUG.test(slug);

  const customerBody = (stored: StoredCustomer): Json => ({
    id: stored.id,
    name: stored.name,
    slug: stored.slug,
    ...(stored.billingEmail === null ? {} : { billingEmail: stored.billingEmail }),
    ...(stored.domain === null ? {} : { domain: stored.domain }),
    ...(stored.externalCustomerId === null
      ? {}
      : { externalCustomerId: stored.externalCustomerId }),
    createdAt: stored.createdAt,
    createdBy: actorOf(stored.createdBy),
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedAt === stored.createdAt ? actorOf(stored.createdBy) : SERVICE,
  });

  const instanceBody = (stored: StoredInstance): Json => ({
    id: stored.id,
    name: stored.name,
    description: stored.description,
    slug: stored.slug,
    customerId: stored.customerId,
    customerSlug: stored.customerSlug,
    licenseId: stored.licenseId,
    licenseSlug: stored.licenseSlug,
    startLicenseDate: stored.startLicenseDate,
    endLicenseDate: stored.endLicenseDate,
    status: "HEALTHY",
    metadata: stored.metadata,
    createdAt: stored.createdAt,
    createdBy: actorOf(stored.createdBy),
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedAt === stored.createdAt ? actorOf(stored.createdBy) : SERVICE,
  });

  function createCustomer(body: Json): Response {
    if (typeof body.name !== "string" || body.name.length < 1) {
      return problem(422, "CreateCustomer.InvalidName", "name is required", "/api/customers");
    }
    if (body.slug !== undefined && !validSlug(body.slug)) {
      return problem(
        422,
        "CreateCustomer.InvalidSlug",
        "slug is 2 to 100 lower-case letters, digits and dashes, not starting or ending with a dash",
        "/api/customers",
      );
    }
    if (
      body.billingEmail !== undefined &&
      (typeof body.billingEmail !== "string" ||
        body.billingEmail.length > 254 ||
        !body.billingEmail.includes("@"))
    ) {
      return problem(
        422,
        "CreateCustomer.InvalidBillingEmail",
        "billingEmail is an e-mail address of 254 characters at most",
        "/api/customers",
      );
    }
    const slug: string = body.slug ?? generateSlug(body.name);
    if (customers.some((each) => each.slug === slug)) {
      return problem(
        409,
        "CreateCustomer.SlugConflict",
        `Customer with slug "${slug}" already exists in this organization`,
        "/api/customers",
      );
    }
    return reply(201, customerBody(addCustomer(slug, body.name, body.billingEmail ?? null)));
  }

  /** Makes the customer, which the routes above and an anonymous checkout's completion both do. */
  function addCustomer(
    slug: string,
    name: string,
    billingEmail: string | null,
    createdBy: Actor = "service",
  ): StoredCustomer {
    const now = new Date().toISOString();
    const stored: StoredCustomer = {
      id: randomUUID(),
      slug,
      name,
      billingEmail,
      domain: null,
      externalCustomerId: null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };
    customers.push(stored);
    return stored;
  }

  const billingEmailProblem = (code: string, path: string) =>
    problem(422, code, "billingEmail is an e-mail address of 254 characters at most", path);
  const validBillingEmail = (value: unknown) =>
    typeof value === "string" && value.length <= 254 && value.includes("@");

  /**
   * Kaiten's `Customer` and `Instance` schemas are closed (`additionalProperties: false`): a member
   * they do not list is refused, so a write that sends one fails here as it does there.
   */
  const CUSTOMER_MEMBERS = new Set([
    "billingEmail",
    "createdAt",
    "createdBy",
    "domain",
    "externalCustomerId",
    "id",
    "integrations",
    "name",
    "slug",
    "updatedAt",
    "updatedBy",
  ]);
  const INSTANCE_MEMBERS = new Set([
    "createdAt",
    "createdBy",
    "customerId",
    "customerSlug",
    "deploymentZoneId",
    "deploymentZoneSlug",
    "description",
    "endLicenseDate",
    "id",
    "integrations",
    "licenseId",
    "licenseSlug",
    "lifecycleStage",
    "metadata",
    "name",
    "slug",
    "startLicenseDate",
    "status",
    "updatedAt",
    "updatedBy",
  ]);
  const unknownMember = (body: Json, known: Set<string>) =>
    Object.keys(body).find((member) => !known.has(member));
  const DOMAIN = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

  function getCustomer(slug: string): Response {
    const found = customers.find((each) => each.slug === slug);
    return found
      ? reply(200, customerBody(found))
      : problem(
          404,
          "GetCustomer.NotFound",
          `Customer with slug "${slug}" not found`,
          `/api/customers/${slug}`,
        );
  }

  /**
   * `PUT /customers/{slug}`, which replaces the customer's details the way Kaiten does: the name, the
   * domain and the external id are what is sent (a member left out is cleared), and the billing
   * e-mail is kept when it is left out and removed when it is empty. The slug and the integrations
   * are not settable, and are refused unless they are the ones on record.
   */
  function updateCustomer(slug: string, body: Json): Response {
    const path = `/api/customers/${slug}`;
    const found = customers.find((each) => each.slug === slug);
    if (!found) {
      return problem(
        404,
        "UpdateCustomer.NotFound",
        `Customer with slug "${slug}" not found`,
        path,
      );
    }
    const unknown = unknownMember(body, CUSTOMER_MEMBERS);
    if (unknown !== undefined) {
      return problem(
        422,
        "UpdateCustomer.InvalidBody",
        `${unknown} is not a member of a customer`,
        path,
      );
    }
    if (typeof body.name !== "string" || body.name.length < 1) {
      return problem(422, "UpdateCustomer.InvalidName", "name is required", path);
    }
    if (typeof body.domain === "string" && !DOMAIN.test(body.domain)) {
      return problem(422, "UpdateCustomer.InvalidDomain", "domain is not a domain name", path);
    }
    if (body.slug !== undefined && body.slug !== slug) {
      return problem(
        422,
        "UpdateCustomer.SlugNotRenameable",
        "slug cannot be changed through this endpoint; omit it or send the current slug",
        path,
      );
    }
    if (body.integrations !== undefined && Object.keys(body.integrations).length > 0) {
      return problem(
        422,
        "UpdateCustomer.IntegrationsNotSettable",
        "integrations cannot be set through this endpoint; use the dedicated integration endpoints",
        path,
      );
    }
    if (body.billingEmail !== undefined && body.billingEmail !== "") {
      if (!validBillingEmail(body.billingEmail)) {
        return billingEmailProblem("UpdateCustomer.InvalidBillingEmail", path);
      }
    }
    found.name = body.name;
    found.domain = typeof body.domain === "string" ? body.domain : null;
    found.externalCustomerId =
      typeof body.externalCustomerId === "string" ? body.externalCustomerId : null;
    if (body.billingEmail === "") found.billingEmail = null;
    else if (body.billingEmail !== undefined) found.billingEmail = body.billingEmail;
    found.updatedAt = new Date(Math.max(Date.now(), Date.parse(found.updatedAt) + 1)).toISOString();
    return reply(204, null);
  }

  function getInstance(slug: string): Response {
    const found = instances.find((each) => each.slug === slug);
    return found
      ? reply(200, instanceBody(found))
      : problem(
          404,
          "GetInstance.NotFound",
          `Instance with slug "${slug}" not found`,
          `/api/instances/${slug}`,
        );
  }

  /**
   * `PUT /instances/{slug}`, a full replacement as Kaiten's is: the name, the description, the
   * dates and the metadata are what is sent. The stand-in plays one instance at a time and does not
   * move one between customers or licences, so it refuses a customer or a licence other than the
   * instance's own, and a slug other than its own; Kaiten also refuses them, while the instance
   * has a live subscription.
   */
  function updateInstance(slug: string, body: Json): Response {
    const path = `/api/instances/${slug}`;
    const found = instances.find((each) => each.slug === slug);
    if (!found) {
      return problem(
        404,
        "UpdateInstance.NotFound",
        `Instance with slug "${slug}" not found`,
        path,
      );
    }
    const unknown = unknownMember(body, INSTANCE_MEMBERS);
    if (unknown !== undefined) {
      return problem(
        422,
        "UpdateInstance.InvalidBody",
        `${unknown} is not a member of an instance`,
        path,
      );
    }
    for (const member of [
      "name",
      "description",
      "customerId",
      "licenseId",
      "startLicenseDate",
      "endLicenseDate",
    ]) {
      if (typeof body[member] !== "string" || (member === "name" && body[member] === "")) {
        return problem(422, "UpdateInstance.InvalidBody", `${member} is required`, path);
      }
    }
    if (body.integrations !== undefined && Object.keys(body.integrations).length > 0) {
      return problem(
        422,
        "UpdateInstance.IntegrationsNotSettable",
        "integrations cannot be set through this endpoint; use the dedicated integration endpoints",
        path,
      );
    }
    if (body.slug !== undefined && body.slug !== slug) {
      return problem(
        409,
        "UpdateInstance.SlugNotRenameable",
        "the stand-in does not rename an instance",
        path,
      );
    }
    if (body.customerId !== found.customerId || body.licenseId !== found.licenseId) {
      return problem(
        409,
        "UpdateInstance.BillingFrozen",
        "the stand-in does not move an instance to another customer or licence",
        path,
      );
    }
    found.name = body.name;
    found.description = body.description;
    found.startLicenseDate = body.startLicenseDate;
    found.endLicenseDate = body.endLicenseDate;
    found.metadata = body.metadata ?? {};
    found.updatedAt = new Date(Math.max(Date.now(), Date.parse(found.updatedAt) + 1)).toISOString();
    return reply(204, null);
  }

  function deleteCustomer(slug: string): Response {
    const at = customers.findIndex((each) => each.slug === slug);
    if (at < 0) {
      return problem(
        404,
        "DeleteCustomer.NotFound",
        `Customer with slug "${slug}" not found`,
        `/api/customers/${slug}`,
      );
    }
    const [gone] = customers.splice(at, 1);
    instances = instances.filter((each) => each.customerId !== gone!.id);
    return reply(204, null);
  }

  function createInstance(body: Json): Response {
    for (const member of [
      "name",
      "description",
      "customerId",
      "licenseId",
      "startLicenseDate",
      "endLicenseDate",
    ]) {
      if (typeof body[member] !== "string" || (member === "name" && body[member] === "")) {
        return problem(
          422,
          "CreateInstance.InvalidBody",
          `${member} is required`,
          "/api/instances",
        );
      }
    }
    if (body.slug !== undefined && !validSlug(body.slug)) {
      return problem(
        422,
        "CreateInstance.InvalidSlug",
        "slug is 2 to 100 lower-case letters, digits and dashes, not starting or ending with a dash",
        "/api/instances",
      );
    }
    const customer = customers.find((each) => each.id === body.customerId);
    if (!customer) {
      return problem(
        404,
        "CreateInstance.CustomerNotFound",
        `Customer with ID ${body.customerId} not found`,
        "/api/instances",
      );
    }
    const licence = (catalog.plans as Json[]).find((each) => each.licenseId === body.licenseId);
    if (!licence) {
      return problem(
        404,
        "CreateInstance.LicenseNotFound",
        `License with ID ${body.licenseId} not found`,
        "/api/instances",
      );
    }
    const slug: string = body.slug ?? generateSlug(body.name);
    if (instances.some((each) => each.slug === slug)) {
      return problem(
        409,
        "CreateInstance.SlugConflict",
        `Instance with slug "${slug}" already exists in this organization`,
        "/api/instances",
      );
    }
    return reply(
      201,
      instanceBody(
        addInstance(customer, licence, {
          slug,
          name: body.name,
          description: body.description,
          startLicenseDate: body.startLicenseDate,
          endLicenseDate: body.endLicenseDate,
        }),
      ),
    );
  }

  /** Makes the instance of a customer on a licence, which `POST /instances` and a completed anonymous checkout both do. */
  function addInstance(
    customer: StoredCustomer,
    licence: Json,
    fields: Pick<
      StoredInstance,
      "slug" | "name" | "description" | "startLicenseDate" | "endLicenseDate"
    >,
    createdBy: Actor = "service",
  ): StoredInstance {
    const now = new Date().toISOString();
    const stored: StoredInstance = {
      id: randomUUID(),
      ...fields,
      customerId: customer.id,
      customerSlug: customer.slug,
      licenseId: licence.licenseId,
      licenseSlug: licence.licenseSlug,
      metadata: {},
      createdBy,
      createdAt: now,
      updatedAt: now,
    };
    instances.push(stored);
    // An account that this one replaces keeps nothing: the billing state below is the new instance's, and
    // a session of the earlier customer would show it under the earlier customer's name.
    if (signedUp) {
      for (const each of sessions.values())
        if (each.customerSlug !== customer.slug) each.revoked = true;
    }

    // One instance at a time: the billing state is the new instance's. It holds the licence it was
    // created on and no subscription, and its customer's address as the billing email.
    startBilling({});
    planName = licence.name;
    planSlug = licence.licenseSlug;
    billingEmail = customer.billingEmail;
    return stored;
  }

  // ---- The routes -----------------------------------------------------------

  const credentialOf = (request: Request): Call["credential"] => {
    const authorization = request.headers.get("authorization");
    if (authorization?.startsWith("Bearer kst_")) return "kst_";
    if (authorization?.startsWith("Bearer ksc_")) return "ksc_";
    if (authorization?.startsWith("Bearer ksh_")) return "ksh_";
    if (authorization) return "other";
    if (request.headers.has("x-kaiten-publishable-key")) return "pk_";
    return "none";
  };

  async function api(request: Request, path: string, origin: string): Promise<Response> {
    const method = request.method;
    const key = `${method} ${path}`;
    const text = await request.text();
    const body: Json = text ? JSON.parse(text) : {};

    // A scripted answer comes first, whoever asks.
    const queue =
      scripts.get(key) ??
      scripts.get(
        key
          .replace(/(\/public\/checkout-sessions)\/[^/]+(\/confirm)?$/, "$1/*$2")
          .replace(/\/[^/]+(\/complete)$/, "/*$1"),
      );
    const fits = queue?.findIndex(
      (each) => each.dryRun === undefined || each.dryRun === (body.dryRun === true),
    );
    const scripted = fits !== undefined && fits >= 0 ? queue?.splice(fits, 1)[0] : undefined;
    if (scripted) {
      return reply(
        scripted.status,
        scripted.body ?? {},
        scripted.retryAfter ? { "Retry-After": String(scripted.retryAfter) } : {},
      );
    }

    if (key === "GET /public/catalog") {
      return request.headers.get("x-kaiten-publishable-key") === options.publishableKey
        ? reply(200, catalogFor(origin))
        : problem(
            401,
            "PublicAuth.InvalidCredential",
            "unknown publishable key",
            "/api/public/catalog",
          );
    }

    if (
      path === "/customers" ||
      path.startsWith("/customers/") ||
      path === "/instances" ||
      /^\/instances\/[^/]+$/.test(path)
    ) {
      if (request.headers.get("authorization") !== `Bearer ${options.serverToken}`) {
        return problem(401, "Auth.InvalidCredential", "unknown token", `/api${path}`);
      }
      if (key === "POST /customers") return createCustomer(body);
      if (key === "POST /instances") return createInstance(body);
      const customerPath = /^\/customers\/([^/]+)$/.exec(path);
      if (customerPath) {
        const slug = decodeURIComponent(customerPath[1]!);
        if (method === "DELETE") return deleteCustomer(slug);
        if (method === "GET") return getCustomer(slug);
        if (method === "PUT") return updateCustomer(slug, body);
      }
      const instancePath = /^\/instances\/([^/]+)$/.exec(path);
      if (instancePath) {
        const slug = decodeURIComponent(instancePath[1]!);
        if (method === "GET") return getInstance(slug);
        if (method === "PUT") return updateInstance(slug, body);
      }
      return problem(404, "NotFound", `no ${key}`);
    }

    if (path.startsWith("/customer-sessions")) {
      if (request.headers.get("authorization") !== `Bearer ${options.serverToken}`) {
        return problem(401, "Auth.InvalidCredential", "unknown token", "/api/customer-sessions");
      }
      if (key === "POST /customer-sessions") {
        const ttl = Number(body.ttlSeconds ?? 1800);
        if (!Number.isInteger(ttl) || ttl < 300 || ttl > 3600) {
          return problem(422, "CreateCustomerSession.InvalidTtl", "ttlSeconds is 300 to 3600");
        }
        // A visitor's account is what a sign-up made; a session is for nobody else. The stand-in plays one
        // customer at a time (its billing state is the newest instance's), so an account that a later
        // sign-up replaced is gone, and a cookie that still names it must not read the newer one's billing.
        if (signedUp) {
          const customer = customers.find((each) => each.slug === body.customerSlug);
          if (!customer || customer !== customers.at(-1)) {
            return problem(
              404,
              "CreateCustomerSession.CustomerNotFound",
              `customer "${String(body.customerSlug)}" not found`,
            );
          }
          if (body.instanceSlug) {
            const instance = instances.find((each) => each.slug === body.instanceSlug);
            if (!instance) {
              return problem(
                404,
                "CreateCustomerSession.InstanceNotFound",
                `instance "${String(body.instanceSlug)}" not found`,
              );
            }
            if (instance.customerId !== customer.id) {
              return problem(
                422,
                "CreateCustomerSession.InstanceNotOfCustomer",
                "the instance belongs to another customer",
              );
            }
          }
        }
        const stored: Stored = {
          id: randomUUID(),
          token: `kst_${randomBytes(32).toString("base64url")}`,
          customerSlug: String(body.customerSlug),
          instanceSlug: body.instanceSlug ? String(body.instanceSlug) : null,
          expiresAt: Date.now() + ttl * 1000,
          revoked: false,
        };
        sessions.set(stored.token, stored);
        minted += 1;
        return reply(201, {
          id: stored.id,
          token: stored.token,
          expiresAt: iso(stored.expiresAt),
          customerSlug: stored.customerSlug,
          ...(stored.instanceSlug ? { instanceSlug: stored.instanceSlug } : {}),
        });
      }
      const revoking = /^\/customer-sessions\/([^/]+)\/revoke$/.exec(path);
      if (method === "POST" && revoking) {
        for (const each of sessions.values()) {
          if (each.id === revoking[1] && !each.revoked) {
            each.revoked = true;
            revoked += 1;
          }
        }
        return reply(204, null);
      }
      return problem(404, "NotFound", "no such route");
    }

    const vendorPlanChange = /^\/instances\/([^/]+)\/billing\/scheduled-change$/.exec(path);
    if (vendorPlanChange) {
      if (request.headers.get("authorization") !== `Bearer ${options.serverToken}`) {
        return problem(401, "Auth.InvalidCredential", "unknown token", `/api${path}`);
      }
      if (method === "PUT") return schedulePlanChange(vendorPlanChange[1]!, body, path);
      if (method === "DELETE") return cancelPlanChange(vendorPlanChange[1]!, path);
      return problem(404, "NotFound", `no ${key}`);
    }

    const visitor = /^\/public\/checkout-sessions(?:\/([^/]+)(\/confirm)?)?$/.exec(path);
    if (visitor) {
      const [, sessionId, confirming] = visitor;
      if (sessionId === undefined && method === "POST") return startCheckout(request, body);
      if (sessionId !== undefined && !confirming && method === "GET") {
        return readCheckout(request, sessionId);
      }
      if (sessionId !== undefined && confirming && method === "POST") {
        return confirmCheckout(request, sessionId, origin);
      }
      return problem(404, "NotFound", `no ${key}`);
    }

    if (!path.startsWith("/public/session/")) return problem(404, "NotFound", `no ${key}`);

    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const stored = sessions.get(bearer);
    if (!stored || stored.revoked || stored.expiresAt <= Date.now()) {
      return problem(401, "PublicAuth.InvalidCredential", "the session is not valid", path);
    }
    const route = path.slice("/public/session/".length);

    if (key === "GET /public/session/portal") return reply(200, portalOf(stored));

    if (key === "GET /public/session/invoices") {
      return reply(200, { items: structuredClone(invoices), hasMore: false });
    }

    if (key === "POST /public/session/checkout") return checkout(stored, body, origin, request);

    if (key === "POST /public/session/billing/cancel") {
      if (!subscription || canceling) {
        return problem(
          409,
          "CancelSessionSubscription.NotActive",
          "there is nothing to cancel",
          path,
        );
      }
      canceling = true;
      emit(
        "instance.billing.cancellation_scheduled",
        `cancels at the end of the period, ${subscription.currentPeriodEnd}`,
      );
      return reply(200, { ...subscription, cancelAtPeriodEnd: true });
    }
    if (key === "POST /public/session/billing/reactivate") {
      if (!subscription || !canceling) {
        return problem(
          409,
          "ReactivateSessionSubscription.NotCanceling",
          "nothing is canceled",
          path,
        );
      }
      canceling = false;
      emit("instance.billing.cancellation_reverted", "the cancellation was withdrawn");
      return reply(200, { ...subscription, cancelAtPeriodEnd: false });
    }

    if (key === "POST /public/session/billing/portal-session") {
      return reply(200, { url: `${origin}${DOUBLE_PATH}/provider/portal` });
    }

    if (key === "POST /public/session/billing/payment-method-session") {
      if (!allowedReturn(body.returnUrl, request)) return invalidReturn(path);
      const id = `cs_setup_${randomBytes(6).toString("hex")}`;
      setups.set(id, { returnUrl: String(body.returnUrl), saved: false, card: nextCard() });
      return reply(200, {
        sessionId: id,
        url: `${origin}${DOUBLE_PATH}/provider/setup/${id}`,
        expiresAt: iso(Date.now() + 3_600_000),
      });
    }
    const completing = /^billing\/payment-method-session\/([^/]+)\/complete$/.exec(route);
    if (method === "POST" && completing) {
      const setup = setups.get(completing[1]!);
      if (!setup?.saved) {
        return problem(
          422,
          "CompleteSessionPaymentMethodSession.Incomplete",
          "no payment method was saved on the page",
          path,
        );
      }
      return reply(200, { paymentMethod: { ...card!, attachedAt: new Date().toISOString() } });
    }

    if (key === "POST /public/session/vouchers/validate") {
      return reply(
        200,
        normalizeCode(String(body.code ?? "")) === VOUCHER_CODE
          ? session.voucherPercent
          : session.voucherRefused,
      );
    }

    if (key === "POST /public/session/vouchers/redeem") return redeemVoucher(stored, body, path);

    if (method === "PUT" && route.startsWith("addons/")) {
      return setAddonQuantity(
        stored,
        decodeURIComponent(route.slice("addons/".length)),
        body,
        path,
      );
    }

    return problem(404, "NotFound", `the double knows no ${key}`);
  }

  function allowedReturn(returnUrl: unknown, request: Request): boolean {
    try {
      const target = new URL(String(returnUrl));
      const page = request.headers.get("origin");
      // The origins a publishable key allows are the page's own.
      return (
        (target.protocol === "http:" || target.protocol === "https:") &&
        target.origin === (page ?? target.origin)
      );
    } catch {
      return false;
    }
  }

  const invalidReturn = (instance: string) =>
    problem(
      422,
      "CreateSessionCheckout.InvalidReturnUrl",
      "returnUrl must be an absolute URL on an origin a publishable key allows",
      instance,
    );

  /**
   * Issues an invoice for a period, and says how its payment came out: as `outcome` says, which is
   * how a test makes it paid, declined, waiting for the customer or unknown. It is the one place that
   * writes an invoice, for a checkout, a trial's conversion and a renewal alike.
   */
  function issueInvoice(
    origin: string,
    kind: "ACTIVATION" | "RENEWAL",
    due: Json,
    from: Date,
    to: Date,
    at: Date,
  ): Json {
    const id = randomUUID();
    const hostedInvoiceUrl = `${origin}${DOUBLE_PATH}/provider/invoice/${id}`;
    const status =
      outcome === "paid" ? "PAID" : outcome === "processing" ? "PUSHED" : "PAYMENT_FAILED";
    const invoice: Json = {
      id,
      kind,
      status,
      currency: due.currency,
      subtotal: due.subtotal,
      discountTotal: due.discountTotal,
      total: due.total,
      issuedAt: iso(at.getTime()),
      dueAt: iso(at.getTime()),
      paidAt: status === "PAID" ? iso(at.getTime()) : null,
      serviceFrom: iso(from.getTime()),
      serviceTo: iso(to.getTime()),
      providerInvoiceNumber: `INV-${String(invoices.length + 1).padStart(4, "0")}`,
      externalReference: null,
      hostedInvoiceUrl,
      invoicePdfUrl: `${hostedInvoiceUrl}.pdf`,
      lines: due.lines,
    };
    invoices = [invoice, ...invoices];
    if (due.discountTotal > 0 && redeemed) {
      // The code has discounted one more invoice: it no longer starts "from the next one".
      redeemed = {
        ...redeemed,
        appliesFromInvoice: null,
        applicationsCount: redeemed.applicationsCount + 1,
      };
    }
    emit(
      "instance.invoice.issued",
      `${kind} ${invoice.providerInvoiceNumber}, ${money(due.total, due.currency)}`,
      at,
    );
    if (status === "PAID") {
      emit("instance.invoice.paid", `${invoice.providerInvoiceNumber} was paid`, at);
    } else if (status === "PAYMENT_FAILED") {
      emit(
        "instance.invoice.payment_failed",
        `${invoice.providerInvoiceNumber}: ${outcome === "requires_action" ? "the customer has to confirm the payment" : "the card was declined"}`,
        at,
      );
    }
    return invoice;
  }

  function checkout(stored: Stored, order: Json, origin: string, request: Request): Response {
    const path = "/public/session/checkout";
    if (stored.instanceSlug === null) {
      return problem(
        422,
        "CreateSessionCheckout.InstanceRequired",
        "a checkout subscribes one instance: mint the session with an instanceSlug",
        path,
      );
    }
    if (order.returnUrl !== undefined && !allowedReturn(order.returnUrl, request)) {
      return invalidReturn(path);
    }
    const priced = price(order);
    if (priced.problem) return priced.problem;
    // A free subscription is replaced; any other live one is refused.
    const replacing = subscription !== null && isFree();
    if (subscription && !replacing) {
      return problem(
        409,
        "CreateSessionCheckout.AlreadySubscribed",
        "this instance already has a live subscription; a plan change is made by the vendor",
        path,
      );
    }
    const refusal = addOnRefusal(order, findPrice(String(order.licensePriceId))!.price, path);
    if (refusal) return refusal;
    if (typeof order.billingEmail === "string") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(order.billingEmail)) {
        return problem(
          422,
          "CreateSessionCheckout.InvalidBillingEmail",
          "billingEmail is not an address",
          path,
        );
      }
    }
    const { plan, due } = priced as { plan: Json; due: Json };

    // As in Kaiten, a preview is priced without an address: what is due does not depend on it.
    if (order.dryRun) {
      return reply(200, {
        status: "preview",
        dueToday: due,
        ...(priced.trialEndsAt ? { trialEndsAt: priced.trialEndsAt } : {}),
      });
    }

    // The checkout itself needs one, the customer's own or the one sent with it.
    const email = (order.billingEmail as string | undefined) ?? billingEmail;
    if (!email) {
      return problem(
        422,
        "CreateSessionCheckout.BillingEmailRequired",
        "the customer has no billing e-mail: send billingEmail",
        path,
      );
    }

    const needsCard = due.total > 0 || plan.requiresPaymentMethod === true;
    if (typeof order.setupSessionId === "string") {
      const setup = setups.get(order.setupSessionId);
      if (!setup?.saved) {
        return problem(
          409,
          "CreateSessionCheckout.SetupSessionIncomplete",
          "no payment method was saved on the page",
          path,
        );
      }
    } else if (needsCard && !card) {
      if (order.returnUrl === undefined) return invalidReturn(path);
      const id = `cs_setup_${randomBytes(6).toString("hex")}`;
      setups.set(id, { returnUrl: String(order.returnUrl), saved: false, card: nextCard() });
      return reply(200, {
        status: "requires_payment_method",
        setupUrl: `${origin}${DOUBLE_PATH}/provider/setup/${id}`,
        setupSessionId: id,
        expiresAt: iso(Date.now() + 3_600_000),
      });
    }

    // The subscribe.
    billingEmail = email;
    const now = new Date();
    const found = findPrice(String(order.licensePriceId))!;
    const base = found.price;
    const periodEnd = addMonths(now, MONTHS[base.billingPeriod] ?? 1);
    if (replacing) {
      // In the checkout's one transaction: the free subscription ends at once, with no invoice and
      // no fallback, and the new one is created.
      emit(
        "instance.billing.canceled",
        `${planName} (free) replaced by a checkout: IMMEDIATE, no final invoice`,
        now,
      );
    }
    planName = plan.name;
    planSlug = plan.licenseSlug;
    // What the instance holds stays, beside what the checkout attaches.
    addOns = [
      ...addOns,
      ...((order.addOns ?? []) as Json[])
        .filter((wanted) => wanted.quantity > 0)
        .map((wanted) => {
          const addon = (catalog.addOns as Json[]).find(
            (each) => each.addonSlug === wanted.addonSlug,
          )!;
          return {
            addonSlug: addon.addonSlug,
            familySlug: addon.familySlug,
            name: addon.name,
            quantity: wanted.quantity,
            maxQuantity: addon.maxQuantity ?? null,
            pendingQuantity: null,
            prices: structuredClone(addon.prices),
          };
        }),
    ];
    const trialing = priced.trialEndsAt !== undefined;
    // The voucher the checkout carries is redeemed with it; a trial discounts the invoice it ends with.
    if (order.voucherCode !== undefined) redeemed = redemptionOf(now);
    subscription = newSubscription(base, now, priced.trialEndsAt ?? null);
    canceling = false;
    pastDueSince = null;
    scheduled = null;
    emit(
      "instance.billing.started",
      `${plan.name}${trialing ? `, trial until ${priced.trialEndsAt}` : ""}${replacing ? ", resubscribed" : ""}`,
      now,
    );

    if (due.total <= 0) {
      return reply(201, {
        status: "subscribed",
        subscription,
        payment: { status: "not_required" },
      });
    }

    const invoice = issueInvoice(origin, "ACTIVATION", due, now, periodEnd, now);
    return reply(201, {
      status: "subscribed",
      subscription,
      activationInvoice: structuredClone(invoice),
      payment: { status: outcome, hostedInvoiceUrl: invoice.hostedInvoiceUrl },
    });
  }

  // ---- Vouchers -----------------------------------------------------------------

  /** The redemption of the double's one voucher, as `POST /public/session/vouchers/redeem` answers it. */
  const redemptionOf = (at: Date): Json => ({
    name: "Welcome 20%",
    voucherType: "PRICE",
    status: "ACTIVE",
    appliesFromInvoice: "next",
    applicationsCount: 0,
    applicationsMax: VOUCHER_INVOICES,
    effectiveStartsAt: iso(at.getTime()),
    effectiveExpiresAt: null,
  });

  /**
   * `POST /public/session/vouchers/redeem`: a code on the session's instance while its subscription
   * is live. The refusals come in Kaiten's order: the instance, the subscription, then the code, and
   * every refusal of the code is one answer, whatever its reason. A `dryRun` answers 200 with what it
   * would make and writes nothing; a redemption is 201. There is no rate limit here.
   */
  function redeemVoucher(stored: Stored, body: Json, path: string): Response {
    const code = body.code;
    if (typeof code !== "string" || code.length < 1 || code.length > 64) {
      return problem(
        422,
        "RedeemSessionVoucher.InvalidBody",
        "code is a string of 1 to 64 characters",
        path,
      );
    }
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      return problem(422, "RedeemSessionVoucher.InvalidBody", "dryRun is true or false", path);
    }
    if (stored.instanceSlug === null) {
      return problem(
        422,
        "RedeemSessionVoucher.InstanceRequired",
        "this session is bound to the customer only: a code is redeemed on an instance",
        path,
      );
    }
    if (subscription?.status === "INCOMPLETE") {
      return problem(
        409,
        "RedeemSessionVoucher.SubscriptionIncomplete",
        "a checkout waits for its payment: its own selection, voucher included, applies once paid",
        path,
      );
    }
    if (!subscription) {
      return problem(
        409,
        "RedeemSessionVoucher.NoLiveSubscription",
        "the instance has no live subscription: a checkout starts one",
        path,
      );
    }
    if (normalizeCode(code) !== VOUCHER_CODE || redeemed) {
      return problem(
        422,
        "RedeemSessionVoucher.VoucherInvalid",
        "this code cannot be redeemed",
        path,
      );
    }
    const made = redemptionOf(new Date());
    if (body.dryRun === true) return reply(200, made);
    redeemed = made;
    emit("instance.voucher.redeemed", `${made.name}, from the portal`);
    return reply(201, structuredClone(made));
  }

  // ---- Add-ons ----------------------------------------------------------------

  /**
   * `PUT /public/session/addons/{slug}`: the quantity takes effect at once, and the next renewal of a
   * live subscription bills it. Without one there is nothing to bill, and nothing is checked but the
   * plan and the most units the add-on allows.
   */
  function setAddonQuantity(stored: Stored, slug: string, body: Json, path: string): Response {
    if (stored.instanceSlug === null) {
      return problem(
        422,
        "SetSessionAddonQuantity.InstanceRequired",
        "mint the session with an instanceSlug",
        path,
      );
    }
    const quantity = body.quantity;
    const addon = (catalog.addOns as Json[]).find((each) => each.addonSlug === slug);
    if (!addon) {
      return problem(
        422,
        "SetSessionAddonQuantity.AddonNotPublic",
        `"${slug}" is not a public add-on`,
        path,
      );
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      return problem(
        422,
        "SetSessionAddonQuantity.QuantityExceedsMax",
        "quantity is a whole number, 0 or more",
        path,
      );
    }
    // The plan the instance is on, which outlives its subscription: Starter before any.
    const licenseSlug = planSlug ?? session.portalNeverSubscribed.instance.licenseSlug;
    if (!planBySlug(licenseSlug)?.compatibleAddonFamilies.includes(addon.familySlug)) {
      return problem(
        422,
        "SetSessionAddonQuantity.Incompatible",
        `"${slug}" does not fit the plan`,
        path,
      );
    }
    const current = subscription;
    if (current) {
      // One currency per subscription: an add-on priced in another cannot be attached to it. One
      // with no price has none to differ.
      const prices = addon.prices as Json[];
      if (prices.some((each) => each.currency !== current.currency)) {
        return problem(
          422,
          "SetSessionAddonQuantity.CurrencyMismatch",
          `"${slug}" is not priced in ${current.currency}, the subscription's currency`,
          path,
        );
      }
      // A paid add-on with flat fees is billed its default fee of the period, and needs one. One
      // that is metered only, free or custom is not checked for a period.
      const fees = prices.filter((each) => each.billingModel === "FLAT_FEE");
      if (
        addon.pricingType === "PAID" &&
        fees.length > 0 &&
        !fees.some((each) => each.isDefault && each.billingPeriod === current.billingPeriod)
      ) {
        return problem(
          422,
          "SetSessionAddonQuantity.Incompatible",
          `"${slug}" has no price for the subscription's billing period`,
          path,
        );
      }
    }
    if (addon.maxQuantity != null && quantity > addon.maxQuantity) {
      return problem(
        422,
        "SetSessionAddonQuantity.QuantityExceedsMax",
        `at most ${addon.maxQuantity} of "${slug}"`,
        path,
      );
    }

    const before = addOns.find((each) => each.addonSlug === slug)?.quantity ?? 0;
    if (quantity !== before) {
      addOns = addOns.filter((each) => each.addonSlug !== slug);
      if (quantity > 0) {
        addOns.push({
          addonSlug: addon.addonSlug,
          familySlug: addon.familySlug,
          name: addon.name,
          quantity,
          maxQuantity: addon.maxQuantity ?? null,
          pendingQuantity: null,
          prices: structuredClone(addon.prices),
        });
      }
      emit(
        before === 0
          ? "instance.addon.added"
          : quantity === 0
            ? "instance.addon.removed"
            : "instance.addon.quantity_changed",
        `${addon.name}: ${before} → ${quantity}, in force now, ${current ? "billed from the next renewal" : "with no subscription to bill it"}`,
      );
    }
    return reply(200, {
      addonSlug: addon.addonSlug,
      familySlug: addon.familySlug,
      name: addon.name,
      quantity,
      maxQuantity: addon.maxQuantity ?? null,
      pendingQuantity: null,
      prices: structuredClone(addon.prices),
    });
  }

  // ---- The anonymous checkout -------------------------------------------------

  const wrongKind = (instance: string) =>
    problem(
      403,
      "Auth.WrongCredentialKind",
      "this credential is not the kind this route takes",
      instance,
    );
  const invalidCredential = (instance: string) =>
    problem(401, "PublicAuth.InvalidCredential", "invalid credential", instance);

  /** The plan a visitor's instance starts on while it owes: the catalogue's free one. */
  const fallbackPlan = (): Json | undefined =>
    (catalog.plans as Json[]).find((each) => each.pricingType === "FREE");

  const needsPaymentMethod = (plan: Json, due: Json) =>
    plan.pricingType !== "FREE" && (due.total > 0 || plan.requiresPaymentMethod === true);

  /** What the next verification of the security check comes to. */
  function scriptVerdict(value: TurnstileVerdict, times = Infinity) {
    verdict = { value, remaining: times };
  }

  /**
   * What Kaiten answers a Turnstile token. A token is single-use, a `dryRun` included: Cloudflare
   * refuses one it has seen (`timeout-or-duplicate`), and Kaiten answers that as it answers a token that
   * does not pass. A token Cloudflare could not be asked about, or that the key has no secret for, is
   * not spent.
   */
  function verifyTurnstile(instance: string, token: string): Response | null {
    verified += 1;
    const current = verdict.value;
    if (verdict.remaining !== Infinity) {
      verdict.remaining -= 1;
      if (verdict.remaining <= 0) verdict = { value: "pass", remaining: Infinity };
    }
    switch (current) {
      case "unconfigured":
        return problem(
          422,
          `${START}.TurnstileNotConfigured`,
          "this publishable key has no usable Turnstile site key and secret",
          instance,
        );
      case "unavailable":
        return problem(
          503,
          `${START}.TurnstileUnavailable`,
          "the challenge could not be verified: try again",
          instance,
          {},
          { "Retry-After": String(TURNSTILE_RETRY_SECONDS) },
        );
      case "fail":
        spentTokens.add(token);
        return problem(
          422,
          `${START}.TurnstileFailed`,
          "the challenge was not passed: solve it again",
          instance,
        );
      default:
        if (spentTokens.has(token)) {
          tokenReuses += 1;
          return problem(
            422,
            `${START}.TurnstileFailed`,
            "the challenge was not passed: solve it again",
            instance,
          );
        }
        spentTokens.add(token);
        return null;
    }
  }

  /**
   * `POST /public/checkout-sessions`: the start of a visitor's checkout. It writes the session and
   * nothing else, and as in Kaiten the security check is verified before the price is looked at.
   */
  function startCheckout(request: Request, body: unknown): Response {
    const path = "/api/public/checkout-sessions";
    if (request.headers.has("authorization")) return wrongKind(path);
    if (request.headers.get("x-kaiten-publishable-key") !== options.publishableKey) {
      return invalidCredential(path);
    }
    const read = readDraft(body);
    if ("refusal" in read) return read.refusal;
    const draft: Draft = read.draft;
    if (!anonymousOn) {
      return problem(
        403,
        `${START}.AnonymousCheckoutDisabled`,
        "this publishable key does not start anonymous checkouts",
        path,
      );
    }
    const refused = verifyTurnstile(path, draft.turnstileToken);
    if (refused) return refused;

    // The price: by its id, or by a plan's version and a billing period, one of the two.
    const byPrice = draft.priceId !== undefined;
    const byPlan = draft.licenseSlug !== undefined || draft.billingPeriod !== undefined;
    if (
      byPrice === byPlan ||
      draft.priceId === "" ||
      (byPlan && (!draft.licenseSlug || !draft.billingPeriod))
    ) {
      return problem(
        422,
        `${START}.InvalidPriceSelection`,
        "name the price by priceId, or by licenseSlug with billingPeriod: one of the two",
        path,
      );
    }
    const found = byPrice
      ? findPrice(draft.priceId!)
      : (catalog.plans as Json[])
          .filter((each) => each.licenseSlug === draft.licenseSlug)
          .flatMap((plan) =>
            (plan.prices as Json[])
              .filter(
                (price) =>
                  price.isDefault &&
                  price.billingModel === "FLAT_FEE" &&
                  price.billingPeriod === draft.billingPeriod,
              )
              .map((price) => ({ plan, price })),
          )[0];
    if (!found) {
      return problem(
        422,
        `${START}.PriceNotPublic`,
        "this is not an ACTIVE price of a plan in the public catalogue",
        path,
      );
    }
    const { plan, price: base } = found;

    // What a plan has to be to be bought here, before anything of the visitor's is looked at.
    const order = { licensePriceId: base.id, addOns: draft.addOns };
    const plain = price({ ...order, trial: false }, START, []);
    if (plain.problem) return plain.problem;
    if (plan.pricingType === "FREE") {
      for (const wanted of draft.addOns) {
        const fee = findAddOnPrice(wanted.addonSlug, base.currency, base.billingPeriod)?.price;
        if ((fee?.unitAmount ?? 0) > 0) {
          return problem(
            422,
            `${START}.AddonNotPublic`,
            `"${wanted.addonSlug}" is not free, and this plan charges nothing`,
            path,
          );
        }
      }
    }
    if (plan.pricingType === "PAID" && catalog.capabilities.paymentMethods !== true) {
      return problem(
        422,
        `${START}.ProviderCannotCapturePayment`,
        "no billing provider that captures payment methods is connected: a paid plan cannot be checked out",
        path,
      );
    }
    if (draft.email !== undefined && !isEmail(draft.email)) {
      return problem(
        422,
        `${START}.InvalidEmail`,
        "email must be an e-mail address of at most 254 characters",
        path,
      );
    }
    const page = request.headers.get("origin");
    if (draft.returnUrl !== undefined && !isReturnUrl(draft.returnUrl, page)) {
      return problem(
        422,
        `${START}.InvalidReturnUrl`,
        "returnUrl is https (http on localhost only), at most 2048 characters, on an origin the publishable key allows",
        path,
      );
    }
    if (!draft.dryRun) {
      if (draft.email === undefined) {
        return problem(422, `${START}.InvalidEmail`, "email is required to start a checkout", path);
      }
      if (draft.returnUrl === undefined) {
        return problem(
          422,
          `${START}.InvalidReturnUrl`,
          "returnUrl is required to start a checkout",
          path,
        );
      }
    }
    // Kaiten has no restriction to check a voucher against before a customer exists: it refuses
    // every code, and says no more than that.
    if (draft.voucherCode !== undefined) {
      return problem(422, `${START}.VoucherInvalid`, "this voucher cannot be applied", path);
    }

    // The plan's trial, unless declined, and one per address and family. A preview without an
    // address shows it unchecked.
    let trial = draft.trial !== false;
    let trialRefusedReason: string | null = null;
    if (
      trial &&
      (plan.trialPeriodDays ?? 0) > 0 &&
      draft.email !== undefined &&
      trialsTaken.has(trialKey(draft.email, plan.familySlug))
    ) {
      trial = false;
      trialRefusedReason = "ALREADY_CONSUMED";
    }
    const priced = trial ? price(order, START, []) : plain;
    if (priced.problem) return priced.problem;
    const due = priced.due!;
    // A visitor's instance never holds a paid plan before it is paid: it starts on a free one.
    if (due.total > 0 && !fallbackPlan()) {
      return problem(
        422,
        `${START}.FallbackRequired`,
        "this plan has an amount due today, so its family needs a free fallback plan",
        path,
      );
    }
    const requiresPaymentMethod = needsPaymentMethod(plan, due);
    const trialEndsAt = priced.trialEndsAt ?? null;
    if (draft.dryRun) {
      return reply(200, {
        status: "preview",
        dueToday: due,
        trialEndsAt,
        trialRefusedReason,
        requiresPaymentMethod,
      });
    }

    const now = Date.now();
    const stored: StoredCheckout = {
      id: randomUUID(),
      token: `ksc_${randomBytes(32).toString("base64url")}`,
      status: "OPEN",
      email: draft.email!,
      clientReferenceId: draft.clientReferenceId ?? null,
      plan,
      price: base,
      addOns: draft.addOns,
      due,
      trialEndsAt,
      trialRefusedReason,
      requiresPaymentMethod,
      returnUrl: draft.returnUrl!,
      createdAt: iso(now),
      expiresAt: iso(now + SESSION_LIFETIME_MS),
      completedAt: null,
      customerSlug: null,
      instanceSlug: null,
      setupId: null,
      invoice: null,
      payment: null,
    };
    checkouts.set(stored.id, stored);
    emit("checkout_session.started", describeSession(stored));
    return reply(201, {
      status: "open",
      sessionId: stored.id,
      token: stored.token,
      expiresAt: stored.expiresAt,
      dueToday: due,
      trialEndsAt,
      trialRefusedReason,
      requiresPaymentMethod,
    });
  }

  /** The session a request's `ksc_` is for: another session's id answers as an unknown token does. */
  function checkoutOf(request: Request, sessionId: string): StoredCheckout | Response {
    const path = `/api/public/checkout-sessions/${sessionId}`;
    if (request.headers.has("x-kaiten-publishable-key")) return wrongKind(path);
    const header = request.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return invalidCredential(path);
    const bearer = header.slice("Bearer ".length).trim();
    if (!bearer.startsWith("ksc_")) return wrongKind(path);
    const stored = [...checkouts.values()].find((each) => each.token === bearer);
    return stored && stored.id === sessionId ? stored : invalidCredential(path);
  }

  /** `GET /public/checkout-sessions/{sessionId}`. */
  function readCheckout(request: Request, sessionId: string): Response {
    const stored = checkoutOf(request, sessionId);
    return stored instanceof Response ? stored : reply(200, sessionView(stored));
  }

  /** The answer of a confirm: the session as it now reads, and the provider's page when one is to be visited. */
  function confirmation(
    stored: StoredCheckout,
    page?: { url: string; expiresAt: string },
  ): Response {
    const session = sessionView(stored);
    if (page) {
      return reply(200, {
        status: "requires_payment_method",
        setupUrl: page.url,
        setupExpiresAt: page.expiresAt,
        session,
      });
    }
    return reply(200, {
      status: stored.status === "AWAITING_PAYMENT" ? "awaiting_payment" : "completed",
      session,
    });
  }

  /**
   * `POST /public/checkout-sessions/{sessionId}/confirm`. It completes the session when nothing stands in
   * the way (a free plan, a trial that needs no payment method, nothing due); otherwise it sends the
   * visitor to the provider's page to save a payment method, and the confirm after it completes. With an
   * amount due the session then waits for the payment of its first invoice.
   */
  function confirmCheckout(request: Request, sessionId: string, origin: string): Response {
    const path = `/api/public/checkout-sessions/${sessionId}/confirm`;
    const found = checkoutOf(request, sessionId);
    if (found instanceof Response) return found;
    const stored = found;
    // Completed already and waiting for its payment: answered as it now is.
    if (stored.status === "AWAITING_PAYMENT") return confirmation(stored);
    const status = readStatus(stored, Date.now());
    if (status !== "OPEN") return sessionClosed(status, path);
    if (!anonymousOn) {
      return problem(
        403,
        `${CONFIRM}.AnonymousCheckoutDisabled`,
        "this publishable key no longer starts anonymous checkouts",
        path,
      );
    }

    const setup = stored.setupId === null ? undefined : setups.get(stored.setupId);
    // A trial that another checkout consumed since the start: dropped and the session priced again,
    // unless a payment method was captured for the amount that was shown.
    if (
      stored.trialEndsAt !== null &&
      trialsTaken.has(trialKey(stored.email, stored.plan.familySlug))
    ) {
      if (setup?.saved) {
        return problem(
          409,
          `${CONFIRM}.DueTodayChanged`,
          "what is due today changed since the start: start again to see the new amount",
          path,
        );
      }
      const again = price(
        { licensePriceId: stored.price.id, addOns: stored.addOns, trial: false },
        CONFIRM,
        [],
      );
      if (again.problem) return again.problem;
      stored.due = again.due!;
      stored.trialEndsAt = null;
      stored.trialRefusedReason = "ALREADY_CONSUMED";
      stored.requiresPaymentMethod = needsPaymentMethod(stored.plan, stored.due);
    }
    if (stored.due.total > 0 && !fallbackPlan()) {
      return problem(
        422,
        `${CONFIRM}.FallbackRequired`,
        "this plan names no free fallback plan to start on until the payment",
        path,
      );
    }

    if (stored.requiresPaymentMethod && !setup?.saved) {
      let id = stored.setupId;
      if (id === null || !setups.has(id)) {
        id = `cs_setup_${randomBytes(6).toString("hex")}`;
        const back = new URL(stored.returnUrl);
        back.searchParams.set("kaiten_checkout_session", stored.id);
        setups.set(id, {
          returnUrl: back.toString(),
          saved: false,
          card: nextCard(),
          checkout: stored.id,
        });
        stored.setupId = id;
      }
      return confirmation(stored, {
        url: `${origin}${DOUBLE_PATH}/provider/setup/${id}`,
        expiresAt: iso(Date.now() + 3_600_000),
      });
    }
    return complete(stored, setup, origin);
  }

  /**
   * Makes what the session sold: in one step the customer (named by the address, with a slug of the
   * address and a random suffix) and its instance, and what the plan asks of them. An amount due
   * leaves the instance on the free plan until the first invoice is paid; anything else subscribes it
   * to the plan at once.
   */
  function complete(
    stored: StoredCheckout,
    setup: { card: (typeof CARDS)[number] } | undefined,
    origin: string,
  ): Response {
    const now = new Date();
    const owing = stored.due.total > 0;
    const startedOn = owing ? fallbackPlan()! : stored.plan;
    // What Kaiten makes on its own behalf, as itself: no person and no service account made it.
    const customer = addCustomer(generateSlug(stored.email), stored.email, stored.email, "system");
    const instance = addInstance(
      customer,
      startedOn,
      {
        slug: generateSlug(stored.email),
        name: stored.email,
        description: "",
        startLicenseDate: iso(now.getTime()),
        endLicenseDate: iso(now.getTime() + 100 * 365 * 86_400_000),
      },
      "system",
    );
    stored.customerSlug = customer.slug;
    stored.instanceSlug = instance.slug;
    // The new instance starts the billing state over: the card the visitor saved is its customer's.
    if (setup) {
      card = structuredClone(setup.card.method);
      emit("customer.payment_method.attached", `${card.brand} ${card.last4}`, now);
    }

    if (owing) {
      const end = addMonths(now, MONTHS[stored.price.billingPeriod] ?? 1);
      const invoice = issueInvoice(origin, "ACTIVATION", stored.due, now, end, now);
      stored.invoice = invoice;
      stored.payment = outcome;
      stored.status = "AWAITING_PAYMENT";
      if (invoice.status === "PAID") activate(stored, now);
      return confirmation(stored);
    }

    subscription = newSubscription(stored.price, now, stored.trialEndsAt);
    // A free plan is on no provider at all.
    if (stored.plan.pricingType === "FREE") {
      subscription = { ...subscription, providerKind: "NOOP", collectionMethod: "SEND_INVOICE" };
    }
    emit(
      "instance.billing.started",
      `${stored.plan.name}${stored.trialEndsAt ? `, trial until ${stored.trialEndsAt}` : ""}`,
      now,
    );
    if (stored.trialEndsAt !== null) {
      trialsTaken.add(trialKey(stored.email, stored.plan.familySlug));
    }
    close(stored, now);
    return confirmation(stored);
  }

  /** The session is done: the customer and the instance are the vendor's to link, through the event. */
  function close(stored: StoredCheckout, at: Date) {
    stored.status = "COMPLETED";
    stored.completedAt = iso(at.getTime());
    emit("checkout_session.completed", `${describeSession(stored)} → ${stored.customerSlug}`, at);
  }

  /** The first invoice of a session is paid: the instance moves to the plan it bought and is subscribed to it. */
  function activate(stored: StoredCheckout, at = new Date()) {
    stored.payment = "paid";
    const instance = instances.find((each) => each.slug === stored.instanceSlug);
    if (instance) {
      instance.licenseSlug = stored.plan.licenseSlug;
      instance.licenseId = stored.plan.licenseId;
    }
    // The stand-in plays one instance at a time: the billing state is the newest instance's.
    if (instances.at(-1)?.slug === stored.instanceSlug) {
      planName = stored.plan.name;
      planSlug = stored.plan.licenseSlug;
      subscription = newSubscription(stored.price, at, null);
      emit("instance.billing.started", stored.plan.name, at);
    }
    close(stored, at);
  }

  /** Lets the time pass that closes the newest session still waiting. */
  function expireCheckout():
    | { ok: true; sessionId: string; status: CheckoutStatus }
    | { ok: false } {
    const waiting = [...checkouts.values()]
      .reverse()
      .find((each) => each.status === "OPEN" || each.status === "AWAITING_PAYMENT");
    if (!waiting) return { ok: false };
    if (waiting.status === "OPEN") {
      waiting.status = "ABANDONED";
      waiting.expiresAt = aMomentAgo();
    } else {
      // Its subscription never left INCOMPLETE: the customer and the instance stay, on the free plan.
      waiting.status = "EXPIRED";
    }
    emit("checkout_session.abandoned", `${describeSession(waiting)}, ${waiting.status}`);
    return { ok: true, sessionId: waiting.id, status: waiting.status };
  }

  // ---- The vendor's plan change -----------------------------------------------

  /** A price as the vendor's API shows it. */
  const vendorPrice = (pub: Json): Json => ({
    metered: null,
    status: "ACTIVE",
    deprecatedAt: null,
    createdAt: subscriptionMeta.createdAt,
    updatedAt: subscriptionMeta.createdAt,
    billingPeriod: null,
    unitAmount: null,
    displayLabel: null,
    ...structuredClone(pub),
  });

  /** The subscription as the vendor's API (`InstanceBilling`) shows it. */
  function instanceBilling(slug: string): Json {
    const sub = subscription!;
    return {
      id: subscriptionMeta.id,
      instanceSlug: slug,
      instanceName: slug,
      customerSlug: session.portal.customer.slug,
      customerName: "Acme storefront customer",
      status: sub.status,
      providerKind: sub.providerKind,
      collectionMethod: sub.collectionMethod,
      collectionMethodOverride: null,
      daysUntilDue: 0,
      daysUntilDueOverride: null,
      basePrice: vendorPrice(sub.basePrice),
      billingPeriod: sub.billingPeriod,
      currency: sub.currency,
      anchorAt: subscriptionMeta.anchorAt,
      startedAt: subscriptionMeta.anchorAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      trialEndsAt: sub.trialEndsAt,
      reminderAt: sub.trialEndsAt ? reminderAt(sub) : null,
      pendingLicenseSlug: null,
      incompleteExpiresAt: null,
      scheduledChange: scheduled
        ? {
            price: vendorPrice(scheduled.price),
            licenseSlug: scheduled.plan.licenseSlug,
            scheduledAt: scheduled.scheduledAt,
            effectiveAt: sub.currentPeriodEnd,
          }
        : null,
      cancelAtPeriodEnd: canceling,
      cancelRequestedAt: null,
      canceledAt: null,
      cancellationReason: null,
      pastDueSince,
      createdAt: subscriptionMeta.createdAt,
      updatedAt: new Date().toISOString(),
    };
  }

  /** `PUT /instances/{slug}/billing/scheduled-change`: a move to another price at the next boundary. */
  function schedulePlanChange(slug: string, body: Json, path: string): Response {
    const code = (name: string) => `SchedulePlanChange.${name}`;
    if (!subscription) {
      return planSlug === null
        ? problem(404, code("NotFound"), "this instance was never subscribed", `/api${path}`)
        : problem(409, code("NotActive"), "the subscription is canceled", `/api${path}`);
    }
    if (subscription.status === "TRIAL") {
      return problem(
        409,
        code("TrialInProgress"),
        "a trial has no plan change: cancel it and subscribe again",
        `/api${path}`,
      );
    }
    if (canceling) {
      return problem(
        409,
        code("CancellationScheduled"),
        "the subscription is canceled at the end of its period",
        `/api${path}`,
      );
    }
    const target = findPrice(String(body.licensePriceId));
    if (!target) {
      return problem(404, code("PriceNotFound"), "licensePriceId is unknown", `/api${path}`);
    }
    if (target.price.billingModel !== "FLAT_FEE") {
      return problem(
        422,
        code("PriceNotFlatFee"),
        "a plan change moves to a flat fee",
        `/api${path}`,
      );
    }
    if (target.plan.lifecycleState !== "PUBLISHED") {
      return problem(
        422,
        code("LicenseNotPublished"),
        "the target is not published",
        `/api${path}`,
      );
    }
    if (target.price.id === subscription.basePrice.id) {
      return problem(
        422,
        code("SamePrice"),
        "the subscription is on that price already",
        `/api${path}`,
      );
    }
    if (target.price.currency !== subscription.currency) {
      return problem(
        422,
        code("CurrencyMismatch"),
        "the target is in another currency",
        `/api${path}`,
      );
    }
    const unfit = addOns.filter(
      (held) =>
        !(target.plan.compatibleAddonFamilies as string[]).includes(held.familySlug) ||
        !findAddOnPrice(held.addonSlug, target.price.currency, target.price.billingPeriod),
    );
    if (unfit.length > 0) {
      return problem(
        422,
        code("AddonIncompatible"),
        `these add-ons do not fit the target: ${unfit.map((each) => each.addonSlug).join(", ")}`,
        `/api${path}`,
      );
    }
    if (scheduled?.price.id !== target.price.id) {
      scheduled = {
        plan: target.plan,
        price: structuredClone(target.price),
        scheduledAt: new Date().toISOString(),
      };
      emit(
        "instance.billing.plan_change_scheduled",
        `${planName} → ${target.plan.name} at ${subscription.currentPeriodEnd}`,
      );
    }
    return reply(200, instanceBilling(slug));
  }

  /** `DELETE /instances/{slug}/billing/scheduled-change`. */
  function cancelPlanChange(slug: string, path: string): Response {
    if (!subscription) {
      return problem(
        404,
        "CancelPlanChange.NotFound",
        "this instance was never subscribed",
        `/api${path}`,
      );
    }
    if (!scheduled) {
      return problem(
        409,
        "CancelPlanChange.NoPlanChangeScheduled",
        "no plan change is scheduled",
        `/api${path}`,
      );
    }
    scheduled = null;
    emit("instance.billing.plan_change_canceled", "the scheduled plan change was dropped");
    return reply(200, instanceBilling(slug));
  }

  // ---- The next boundary -------------------------------------------------------

  /** The days before a trial's end that its reminder is due, the family's default (`trialReminderDays`). */
  const REMINDER_DAYS = 3;

  /** When the reminder of a subscription in its trial is due: never before the subscription began. */
  function reminderAt(sub: Json): string {
    const ends = new Date(sub.trialEndsAt);
    return iso(
      Math.max(ends.getTime() - REMINDER_DAYS * 86_400_000, Date.parse(subscriptionMeta.anchorAt)),
    );
  }

  /**
   * The portal's trial block of a subscription in its trial: when it ends, when the reminder is
   * due, what the conversion would charge and the card it goes to. The charge is what the
   * conversion's invoice would total, so that it never disagrees with it.
   */
  function trialBlock(sub: Json): Json {
    const ends = new Date(sub.trialEndsAt);
    const due = advanceLines(
      sub.basePrice,
      sub.currency,
      ends,
      addMonths(ends, MONTHS[sub.basePrice.billingPeriod] ?? 1),
    );
    return {
      endsAt: sub.trialEndsAt,
      reminderAt: reminderAt(sub),
      charge:
        due.total > 0
          ? { amount: due.total, currency: sub.currency, billingPeriod: sub.billingPeriod }
          : null,
      paymentMethod: card ? { brand: card.brand, last4: card.last4 } : null,
    };
  }

  /** What a period of the subscription bills in advance: the base fee and the add-ons it holds. */
  function advanceLines(price: Json, currency: string, from: Date, to: Date): Json {
    const span = { serviceFrom: iso(from.getTime()), serviceTo: iso(to.getTime()) };
    const lines: Json[] = [];
    let subtotal = 0;
    const plan = findPrice(price.id)?.plan;
    if (price.unitAmount > 0) {
      lines.push({
        seq: lines.length + 1,
        type: "BASE",
        label: plan?.name ?? "Plan",
        description: `1 × ${money(price.unitAmount, currency)}`,
        quantity: "1",
        unitAmountDecimal: String(price.unitAmount),
        amount: price.unitAmount,
        ...span,
      });
      subtotal += price.unitAmount;
    }
    for (const held of addOns) {
      const sold = findAddOnPrice(held.addonSlug, currency, price.billingPeriod);
      if (!sold) continue;
      const amount = sold.price.unitAmount * held.quantity;
      lines.push({
        seq: lines.length + 1,
        type: "ADDON",
        label: held.name,
        description: `${held.quantity} × ${money(sold.price.unitAmount, currency)}`,
        quantity: String(held.quantity),
        unitAmountDecimal: String(sold.price.unitAmount),
        amount,
        ...span,
      });
      subtotal += amount;
    }
    // A redeemed code discounts the base fee of the invoices composed after it, up to its count.
    const discountTotal = redemptionDiscount(price);
    if (discountTotal > 0) {
      lines.push({
        seq: lines.length + 1,
        type: "DISCOUNT",
        label: String(redeemed!.name),
        description: "20% off the base fee",
        quantity: "1",
        unitAmountDecimal: null,
        amount: -discountTotal,
        ...span,
      });
    }
    return { currency, subtotal, discountTotal, total: subtotal - discountTotal, lines };
  }

  /** What the redeemed code takes off a base fee on the next invoice; 0 when none is left. */
  function redemptionDiscount(price: Json): number {
    if (!redeemed || redeemed.voucherType !== "PRICE") return 0;
    if (redeemed.applicationsCount >= (redeemed.applicationsMax ?? Infinity)) return 0;
    return Math.round((price.unitAmount * 20) / 100);
  }

  const refuse = (code: string, detail: string): BoundaryResult => ({ ok: false, code, detail });

  /** The invoice of a boundary is not paid: the subscription is PAST_DUE until it is. */
  function pastDue(invoice: Json, at: Date) {
    if (invoice.status === "PAID" || invoice.status === "PUSHED") return;
    if (subscription!.status !== "PAST_DUE") {
      subscription = { ...subscription!, status: "PAST_DUE" };
      pastDueSince = iso(at.getTime());
      emit("instance.billing.status_changed", "ACTIVE → PAST_DUE, the payment failed", at);
    }
  }

  function moveToBoundary(origin: string, only?: "trial"): BoundaryResult {
    if (!subscription) return refuse("no_subscription", "there is no subscription to move");
    const trialing = subscription.status === "TRIAL";
    if (only === "trial" && !trialing) {
      return refuse("not_in_trial", "the subscription is not in a trial");
    }

    if (trialing) {
      const plan = planBySlug(planSlug);
      const at = new Date(subscription.trialEndsAt);
      const price = subscription.basePrice;
      const to = addMonths(at, MONTHS[price.billingPeriod] ?? 1);
      const due = advanceLines(price, subscription.currency, at, to);
      // Kaiten's own rule for a trial that ends with no card is the vendor's to choose (CANCEL or
      // CONVERT), and that choice is not in the contract this stand-in follows yet.
      if (due.total > 0 && !card) {
        return refuse(
          "trial_without_payment_method",
          `the trial of ${plan?.name ?? "the plan"} ends with no payment method on file; what Kaiten does then (CANCEL or CONVERT) comes with the v3.1 contract`,
        );
      }
      subscription = {
        ...subscription,
        status: "ACTIVE",
        currentPeriodStart: iso(at.getTime()),
        currentPeriodEnd: iso(to.getTime()),
      };
      emit("instance.billing.status_changed", "TRIAL → ACTIVE, the trial ended", at);
      if (due.total <= 0) return { ok: true, applied: "trial_converted", invoiceId: null };
      const invoice = issueInvoice(origin, "ACTIVATION", due, at, to, at);
      dunning.add(invoice.id);
      pastDue(invoice, at);
      return { ok: true, applied: "trial_converted", invoiceId: invoice.id as string };
    }

    const end = new Date(subscription.currentPeriodEnd);
    if (canceling) {
      subscription = null;
      canceling = false;
      scheduled = null;
      pastDueSince = null;
      emit(
        "instance.billing.canceled",
        "the cancellation took effect at the end of the period",
        end,
      );
      return { ok: true, applied: "canceled", invoiceId: null };
    }

    const changing = scheduled;
    const price = changing ? changing.price : subscription.basePrice;
    const to = addMonths(end, MONTHS[price.billingPeriod] ?? 1);
    if (changing) {
      planName = changing.plan.name;
      planSlug = changing.plan.licenseSlug;
      subscription = {
        ...subscription,
        basePrice: structuredClone(price),
        billingPeriod: price.billingPeriod,
      };
      scheduled = null;
      emit("instance.billing.plan_changed", `now on ${planName}`, end);
    }
    subscription = {
      ...subscription,
      currentPeriodStart: iso(end.getTime()),
      currentPeriodEnd: iso(to.getTime()),
    };
    const due = advanceLines(price, subscription.currency, end, to);
    if (due.total <= 0) {
      return { ok: true, applied: changing ? "plan_changed" : "renewed", invoiceId: null };
    }
    const invoice = issueInvoice(origin, "RENEWAL", due, end, to, end);
    dunning.add(invoice.id);
    pastDue(invoice, end);
    return {
      ok: true,
      applied: changing ? "plan_changed" : "renewed",
      invoiceId: invoice.id as string,
    };
  }

  // ---- The provider's pages -------------------------------------------------

  function provider(request: Request, path: string): Response {
    const url = new URL(request.url);
    const setup = /^\/provider\/setup\/([^/]+)(\/save)?$/.exec(path);
    if (setup) {
      const id = setup[1]!;
      const pending = setups.get(id);
      if (!pending) return html("Payment provider", "<h1>This page has expired.</h1>");
      if (setup[2]) {
        if (request.method !== "POST") return reply(405, {}, { Allow: "POST" });
        pending.saved = true;
        const back = new URL(pending.returnUrl);
        // A visitor's checkout has no customer to keep the card on until it completes: the session
        // takes it then, and its return address already names the session.
        if (pending.checkout === undefined) {
          card = structuredClone(pending.card.method);
          emit(
            "customer.payment_method.attached",
            `${pending.card.method.brand} ${pending.card.method.last4}`,
          );
          back.searchParams.set("kaiten_setup_session", id);
        }
        return new Response(null, { status: 303, headers: { Location: back.toString() } });
      }
      return html(
        "Payment provider",
        `<h1>Payment provider</h1><p>Save a card for Acme storefront.</p>` +
          `<form method="post" action="${DOUBLE_PATH}/provider/setup/${id}/save">` +
          `<button type="submit">Save card ${pending.card.number}</button></form>`,
      );
    }

    const invoice = /^\/provider\/invoice\/([^/.]+)(\/pay)?$/.exec(path);
    if (invoice) {
      const found = invoices.find((each) => each.id === invoice[1]);
      if (!found) return html("Payment provider", "<h1>No such invoice.</h1>");
      if (invoice[2]) {
        if (request.method !== "POST") return reply(405, {}, { Allow: "POST" });
        payInvoice(found.id);
        return new Response(null, {
          status: 303,
          headers: { Location: `${DOUBLE_PATH}/provider/invoice/${found.id}` },
        });
      }
      return html(
        "Payment provider",
        `<h1>Invoice ${found.providerInvoiceNumber}</h1><p>Status: <strong>${INVOICE_STATUS[found.status] ?? found.status}</strong></p>` +
          (found.status === "PAID"
            ? "<p>Paid. You can close this window.</p>"
            : `<form method="post" action="${DOUBLE_PATH}/provider/invoice/${found.id}/pay"><button type="submit">Confirm payment</button></form>`),
      );
    }

    if (path === "/provider/portal") {
      return html("Payment provider", `<h1>Billing portal</h1><p>${url.origin}</p>`);
    }
    return html("Payment provider", "<h1>Not found.</h1>");
  }

  function payInvoice(id: string): boolean {
    const found = invoices.find((each) => each.id === id);
    if (!found) return false;
    if (found.status !== "PAID") {
      found.status = "PAID";
      found.paidAt = new Date().toISOString();
      emit("instance.invoice.paid", `${found.providerInvoiceNumber} was paid`);
      // A visitor's checkout that waited for this payment completes with it.
      for (const waiting of checkouts.values()) {
        if (waiting.invoice === found && waiting.status === "AWAITING_PAYMENT") activate(waiting);
      }
      // The last overdue invoice paid, the subscription is whole again.
      if (
        subscription?.status === "PAST_DUE" &&
        !invoices.some((each) => dunning.has(each.id) && each.status === "PAYMENT_FAILED")
      ) {
        subscription = { ...subscription, status: "ACTIVE" };
        pastDueSince = null;
        emit("instance.billing.status_changed", "PAST_DUE → ACTIVE, the overdue invoice was paid");
      }
    }
    return true;
  }

  function declineInvoice(id: string): boolean {
    const found = invoices.find((each) => each.id === id);
    if (!found) return false;
    if (found.status !== "PAYMENT_FAILED") {
      found.status = "PAYMENT_FAILED";
      emit("instance.invoice.payment_failed", `${found.providerInvoiceNumber}: the payment failed`);
      for (const waiting of checkouts.values()) {
        if (waiting.invoice === found && waiting.status === "AWAITING_PAYMENT") {
          waiting.payment = "failed";
        }
      }
      // A renewal that cannot be collected makes the subscription overdue.
      if (dunning.has(found.id) && subscription?.status === "ACTIVE") {
        subscription = { ...subscription, status: "PAST_DUE" };
        pastDueSince = new Date().toISOString();
        emit("instance.billing.status_changed", "ACTIVE → PAST_DUE, the payment failed");
      }
    }
    return true;
  }

  // ---- The control surface --------------------------------------------------

  async function control(request: Request, path: string): Promise<Response> {
    // A test calls this from its own process, which sends no `Origin`. A page of another origin that a
    // developer happens to have open must not be able to start the stand-in over.
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== new URL(request.url).origin) {
      return reply(403, { error: "cross_origin" });
    }
    const body: Json =
      request.method === "POST" && request.headers.get("content-length") !== "0"
        ? await request.json().catch(() => ({}))
        : {};
    if (request.method === "POST" && path === "/control/reset") {
      reset(body as Scenario);
      return reply(200, { ok: true });
    }
    if (request.method === "POST" && path === "/control/script") {
      script(String(body.key), ...((body.replies ?? []) as Reply[]));
      return reply(200, { ok: true });
    }
    if (request.method === "POST" && path === "/control/payment") {
      if (!OUTCOMES.includes(body.outcome as PaymentOutcome)) {
        return reply(400, { error: `outcome is one of ${OUTCOMES.join(", ")}` });
      }
      outcome = body.outcome as PaymentOutcome;
      return reply(200, { ok: true });
    }
    if (request.method === "POST" && path === "/control/anonymous-checkout") {
      if (typeof body.enabled !== "boolean")
        return reply(400, { error: "enabled is true or false" });
      anonymousOn = body.enabled;
      return reply(200, { ok: true });
    }
    if (request.method === "POST" && path === "/control/turnstile") {
      if (!TURNSTILE_VERDICTS.includes(body.verdict as TurnstileVerdict)) {
        return reply(400, { error: `verdict is one of ${TURNSTILE_VERDICTS.join(", ")}` });
      }
      if (body.times !== undefined && !(Number.isInteger(body.times) && body.times > 0)) {
        return reply(400, { error: "times is a whole number, 1 or more" });
      }
      scriptVerdict(body.verdict as TurnstileVerdict, body.times);
      return reply(200, { ok: true });
    }
    if (request.method === "POST" && path === "/control/checkout-sessions/expire") {
      const expired = expireCheckout();
      return expired.ok
        ? reply(200, expired)
        : reply(409, {
            ...expired,
            detail: "No checkout is waiting: open a plan's checkout first.",
          });
    }
    const boundary = /^\/control\/(advance|trial\/end)$/.exec(path);
    if (request.method === "POST" && boundary) {
      const result =
        boundary[1] === "advance"
          ? moveToBoundary(origin ?? new URL(request.url).origin)
          : moveToBoundary(origin ?? new URL(request.url).origin, "trial");
      return reply(result.ok ? 200 : 409, result);
    }
    const act = /^\/control\/invoices\/([^/]+)\/(pay|decline)$/.exec(path);
    if (request.method === "POST" && act) {
      const done = act[2] === "pay" ? payInvoice(act[1]!) : declineInvoice(act[1]!);
      return done ? reply(200, { ok: true }) : reply(404, { ok: false });
    }
    if (request.method === "GET" && path === "/control/calls") return reply(200, log);
    if (request.method === "GET" && path === "/control/state") return reply(200, state());
    if (request.method === "GET" && path === "/control/events") return reply(200, events);
    return reply(404, { error: "no such control" });
  }

  // ---- The double -----------------------------------------------------------

  function script(key: string, ...replies: Reply[]) {
    scripts.set(key, [...replies]);
  }

  const state = (): DoubleState => ({
    subscribed: subscription !== null,
    cancelAtPeriodEnd: canceling,
    cardOnFile: card !== null,
    billingEmail,
    invoices: invoices.map((each) => ({
      id: each.id as string,
      kind: each.kind as string,
      status: each.status as string,
      total: each.total as number,
      currency: each.currency as string,
      providerInvoiceNumber: each.providerInvoiceNumber as string,
    })),
    minted,
    revoked,
    payment: outcome,
    plan: planSlug,
    planName,
    status: subscription ? (subscription.status as string) : null,
    free: isFree(),
    trialEndsAt: subscription?.status === "TRIAL" ? (subscription.trialEndsAt as string) : null,
    currentPeriodEnd: subscription ? (subscription.currentPeriodEnd as string) : null,
    scheduledChange:
      subscription && scheduled
        ? {
            plan: scheduled.plan.licenseSlug as string,
            priceId: scheduled.price.id as string,
            effectiveAt: subscription.currentPeriodEnd as string,
          }
        : null,
    addOns: addOns.map((each) => ({
      slug: each.addonSlug as string,
      quantity: each.quantity as number,
    })),
    card: card ? `${cardBrand(card.brand)} ${card.last4}` : null,
    customers: customers.map((each) => ({
      slug: each.slug,
      name: each.name,
      billingEmail: each.billingEmail,
      createdBy: each.createdBy,
    })),
    instances: instances.map((each) => ({
      name: each.name,
      description: each.description,
      slug: each.slug,
      customerSlug: each.customerSlug,
      licenseSlug: each.licenseSlug,
    })),
    anonymousCheckout: anonymousOn,
    checkoutSessions: [...checkouts.values()].map((each) => ({
      id: each.id,
      status: readStatus(each, Date.now()),
      email: each.email,
      clientReferenceId: each.clientReferenceId,
      licenseSlug: each.plan.licenseSlug as string,
      customerSlug: each.customerSlug,
      instanceSlug: each.instanceSlug,
      payment: each.payment,
    })),
    turnstileChecks: verified,
    turnstileReused: tokenReuses,
  });

  const route: Route = async (request) => {
    const url = new URL(request.url);
    const mounted = url.pathname.startsWith(`${DOUBLE_PATH}/`);
    const path = mounted ? url.pathname.slice(DOUBLE_PATH.length) : url.pathname;

    if (path.startsWith("/control/")) return mounted ? control(request, path) : undefined;
    if (path.startsWith("/provider/")) return mounted ? provider(request, path) : undefined;
    if (!path.startsWith("/api/")) return undefined;

    // The page reaches the API under the mount point, the storefront's backend without it.
    const apiPath = path.slice("/api".length);
    const response = await api(
      request.clone(),
      apiPath,
      request.headers.get("origin") ?? url.origin,
    );
    let sent: unknown;
    try {
      const text = await request.clone().text();
      sent = text ? JSON.parse(text) : undefined;
      if (sent && typeof sent === "object" && "voucherCode" in sent) {
        sent = { ...sent, voucherCode: "…" };
      }
      // A Turnstile token is a credential for one start: the log says it was sent, not what it was.
      if (sent && typeof sent === "object" && "turnstileToken" in sent) {
        sent = { ...sent, turnstileToken: "…" };
      }
    } catch {
      sent = undefined;
    }
    log.push({
      method: request.method,
      path: apiPath,
      credential: credentialOf(request),
      origin: request.headers.get("origin"),
      status: response.status,
      body: sent,
    });
    return response;
  };

  return {
    route,
    reset,
    signUp: () => signedUp,
    script,
    payment: (next) => {
      outcome = next;
    },
    payInvoice,
    declineInvoice,
    anonymousCheckout: (enabled) => {
      anonymousOn = enabled;
    },
    turnstile: scriptVerdict,
    expireCheckout,
    advance: (origin = "http://stand-in.invalid") => moveToBoundary(origin),
    endTrial: (origin = "http://stand-in.invalid") => moveToBoundary(origin, "trial"),
    events: () => structuredClone(events),
    calls: () => structuredClone(log),
    state,
  };
}
