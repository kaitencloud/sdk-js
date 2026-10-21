// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A stand-in for Kaiten, to run the storefront and its end-to-end tests without one.
//
// It answers the routes the storefront calls: the public catalogue, the minting of a customer
// session, and the ten routes of `/public/session/*`. The answers are the ones recorded from
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
  /** `kst_`, `ksh_`, `pk_`, or `none`: the kind of credential that came with it, never the credential. */
  credential: "kst_" | "ksh_" | "pk_" | "none" | "other";
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
  /** The customers the stand-in was asked to create, in order. Only a sign-up scenario has any. */
  customers: Array<{ slug: string; name: string; billingEmail: string | null }>;
  /** The instances it was asked to create, with the licence each started on. */
  instances: Array<{ slug: string; customerSlug: string; licenseSlug: string }>;
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
}

/** `Retry-After` in the answers it is attached to. */
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": status < 400 ? "application/json" : "application/problem+json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });

const problem = (status: number, code: string, detail: string, instance = "", more: Json = {}) =>
  reply(status, {
    type: "https://tools.ietf.org/html/rfc7231",
    title: status === 401 ? "Unauthorized" : status === 429 ? "Too Many Requests" : "Refused",
    status,
    detail,
    instance,
    code,
    ...more,
  });

const html = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
      `<meta name="color-scheme" content="light dark">` +
      `<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem}` +
      `button{font:inherit;padding:.5rem 1rem;margin:.25rem .25rem .25rem 0}` +
      `footer{margin-top:2.5rem;font-size:.8125rem;opacity:.7}</style>` +
      `</head><body>${body}<footer>Stand-in for Kaiten: no payment is real.</footer></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

const MONTHS: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

const iso = (time: number) => new Date(time).toISOString();

function addMonths(from: Date, months: number): Date {
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/** The label of an amount in minor units, for the description of a line: `49.00 EUR`. */
function money(amount: number, currency: string): string {
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return `${(amount / 10 ** digits).toFixed(digits)} ${currency}`;
}

/** A code as the API reads it: case and separators do not matter. */
const normalizeCode = (code: string) => code.replace(/[^a-z0-9]/gi, "").toUpperCase();

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

  type StoredCustomer = {
    id: string;
    slug: string;
    name: string;
    billingEmail: string | null;
    createdAt: string;
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
    createdAt: string;
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
  let setups: Map<string, { returnUrl: string; saved: boolean; card: (typeof CARDS)[number] }>;
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
    setups = new Map();
  };

  const reset = (scenario: Scenario = {}) => {
    signedUp = scenario.signUp === true;
    customers = [];
    instances = [];
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

  /** What a checkout bills today: the double's own sums, as a server's are. */
  function price(order: Json): {
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
          "CreateSessionCheckout.PriceNotPublic",
          "licensePriceId is not an ACTIVE price of a plan in the public catalogue",
        ),
      };
    }
    const { plan, price: base } = found;
    if (base.billingModel !== "FLAT_FEE") {
      return {
        problem: problem(
          422,
          "CreateSessionCheckout.PriceNotFlatFee",
          "a subscription is bought on a flat-fee price",
        ),
      };
    }
    if (plan.pricingType === "CUSTOM") {
      return {
        problem: problem(
          422,
          "CreateSessionCheckout.NotSelfServe",
          "this plan is priced on request",
        ),
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
    for (const held of addOns) {
      const fee = billedFee(held.prices as Json[], currency, base.billingPeriod);
      if (!fee) continue;
      const amount = fee.unitAmount * held.quantity;
      lines.push({
        seq: lines.length + 1,
        type: "ADDON",
        label: held.name,
        description: `${held.quantity} × ${money(fee.unitAmount, currency)}`,
        quantity: String(held.quantity),
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
            "CreateSessionCheckout.AddonNotPublic",
            `"${wanted.addonSlug}" is not a public add-on that fits this plan`,
          ),
        };
      }
      if (addon.maxQuantity != null && wanted.quantity > addon.maxQuantity) {
        return {
          problem: problem(
            422,
            "CreateSessionCheckout.QuantityExceedsMax",
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
            "CreateSessionCheckout.CurrencyMismatch",
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
            "CreateSessionCheckout.AddonInvalid",
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
          problem: problem(
            422,
            "CreateSessionCheckout.VoucherInvalid",
            "this voucher cannot be applied",
          ),
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
    portal.vouchers = [];
    portal.updatedAt = new Date().toISOString();
    return portal;
  };

  // ---- The customers and instances a visitor's sign-up makes ---------------

  /** The service account that "created" what a sign-up made: the contract asks who did. */
  const SERVICE = {
    id: "00000000-0000-4000-8000-0000000000f0",
    name: "Storefront service account",
  };
  const SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  const validSlug = (slug: unknown) =>
    typeof slug === "string" && slug.length >= 2 && slug.length <= 100 && SLUG.test(slug);

  const customerBody = (stored: StoredCustomer): Json => ({
    id: stored.id,
    name: stored.name,
    slug: stored.slug,
    ...(stored.billingEmail === null ? {} : { billingEmail: stored.billingEmail }),
    createdAt: stored.createdAt,
    createdBy: SERVICE,
    updatedAt: stored.createdAt,
    updatedBy: SERVICE,
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
    createdAt: stored.createdAt,
    createdBy: SERVICE,
    updatedAt: stored.createdAt,
    updatedBy: SERVICE,
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
    const stored: StoredCustomer = {
      id: randomUUID(),
      slug,
      name: body.name,
      billingEmail: body.billingEmail ?? null,
      createdAt: new Date().toISOString(),
    };
    customers.push(stored);
    return reply(201, customerBody(stored));
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
    const stored: StoredInstance = {
      id: randomUUID(),
      slug,
      name: body.name,
      description: body.description,
      customerId: customer.id,
      customerSlug: customer.slug,
      licenseId: licence.licenseId,
      licenseSlug: licence.licenseSlug,
      startLicenseDate: body.startLicenseDate,
      endLicenseDate: body.endLicenseDate,
      createdAt: new Date().toISOString(),
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
    return reply(201, instanceBody(stored));
  }

  // ---- The routes -----------------------------------------------------------

  const credentialOf = (request: Request): Call["credential"] => {
    const authorization = request.headers.get("authorization");
    if (authorization?.startsWith("Bearer kst_")) return "kst_";
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
    const queue = scripts.get(key) ?? scripts.get(key.replace(/\/[^/]+(\/complete)$/, "/*$1"));
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

    if (path === "/customers" || path.startsWith("/customers/") || path === "/instances") {
      if (request.headers.get("authorization") !== `Bearer ${options.serverToken}`) {
        return problem(401, "Auth.InvalidCredential", "unknown token", `/api${path}`);
      }
      if (key === "POST /customers") return createCustomer(body);
      if (key === "POST /instances") return createInstance(body);
      const deleting = /^\/customers\/([^/]+)$/.exec(path);
      if (method === "DELETE" && deleting) return deleteCustomer(decodeURIComponent(deleting[1]!));
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
            prices: structuredClone(addon.prices),
          };
        }),
    ];
    const trialing = priced.trialEndsAt !== undefined;
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
      prices: structuredClone(addon.prices),
    });
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
      scheduledChange: scheduled
        ? {
            price: vendorPrice(scheduled.price),
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
    return { currency, subtotal, discountTotal: 0, total: subtotal, lines };
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
        card = structuredClone(pending.card.method);
        emit(
          "customer.payment_method.attached",
          `${pending.card.method.brand} ${pending.card.method.last4}`,
        );
        const back = new URL(pending.returnUrl);
        back.searchParams.set("kaiten_setup_session", id);
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
    })),
    instances: instances.map((each) => ({
      slug: each.slug,
      customerSlug: each.customerSlug,
      licenseSlug: each.licenseSlug,
    })),
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
    advance: (origin = "http://stand-in.invalid") => moveToBoundary(origin),
    endTrial: (origin = "http://stand-in.invalid") => moveToBoundary(origin, "trial"),
    events: () => structuredClone(events),
    calls: () => structuredClone(log),
    state,
  };
}
