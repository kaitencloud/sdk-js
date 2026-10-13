// A stand-in for Kaiten, to run the storefront and its end-to-end tests without one.
//
// It answers the routes the storefront calls: the public catalogue, the minting of a customer
// session, and the ten routes of `/public/session/*`. The answers are the ones recorded from
// Kaiten's own code in the client's fixtures, which `fixtures-contract.test.ts` holds to the
// API contract; what it adds to them is a customer who moves. A checkout subscribes the
// instance, after a card has been saved on a provider's page if there is none; a cancellation
// ends the subscription with its period; a payment can be declined, wait for the customer's
// confirmation, or be unknown for a while.
//
// It is not a Kaiten. The sums are its own (a plan's price, an add-on's, a voucher's
// percentage), the entitlements are Initech's whatever the plan, and it accepts every origin
// and never limits a rate. What it proves is that the storefront asks for the right routes with
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

export interface KaitenDouble {
  /** Routes `/kaiten-double/**` (and `/api/**`, which the storefront's backend calls). */
  route: Route;
  /** Starts again from a customer with nothing: no subscription, no card, no email. */
  reset: (scenario?: Scenario) => void;
  /** Answers the next calls to `METHOD /path` with these, in turn, instead of what it would. */
  script: (key: string, ...replies: Reply[]) => void;
  /** What the next activation invoice's payment comes to. */
  payment: (outcome: PaymentOutcome) => void;
  /** The customer pays an invoice, as on the provider's page. */
  payInvoice: (id: string) => boolean;
  /** An open payment is declined (`failed`), as the provider would tell a few seconds on. */
  declineInvoice: (id: string) => boolean;
  calls: () => Call[];
  /** The state worth asserting on. */
  state: () => {
    subscribed: boolean;
    cancelAtPeriodEnd: boolean;
    cardOnFile: boolean;
    billingEmail: string | null;
    invoices: Array<{ id: string; status: string; total: number }>;
    minted: number;
    revoked: number;
  };
}

/** How the customer starts. */
export interface Scenario {
  /** The customer already has a payment method saved. */
  card?: boolean;
  /** The customer already has a billing email. */
  email?: boolean;
  /** The instance is already subscribed to Pro, monthly, and paid its first invoice: a customer with a card and an email. */
  subscribed?: boolean;
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

const problem = (status: number, code: string, detail: string, instance = "") =>
  reply(status, {
    type: "https://tools.ietf.org/html/rfc7231",
    title: status === 401 ? "Unauthorized" : status === 429 ? "Too Many Requests" : "Refused",
    status,
    detail,
    instance,
    code,
  });

const html = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
      `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem;margin:.25rem .25rem .25rem 0}</style>` +
      `</head><body>${body}</body></html>`,
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

/** The one voucher the double knows. */
const VOUCHER_CODE = "WELCOME20";

export function createKaitenDouble(options: KaitenDoubleOptions): KaitenDouble {
  const session = fixture("session.initech.json");
  const catalog = fixture("public-catalog.acme.json");

  type Stored = {
    id: string;
    token: string;
    customerSlug: string;
    instanceSlug: string | null;
    expiresAt: number;
    revoked: boolean;
  };

  let subscription: Json | null;
  let planName: string | null;
  let planSlug: string | null;
  let canceling: boolean;
  let card: Json | null;
  let billingEmail: string | null;
  let invoices: Json[];
  let addOns: Json[];
  let setups: Map<string, { returnUrl: string; saved: boolean }>;
  let sessions: Map<string, Stored>;
  let log: Call[];
  let scripts: Map<string, Reply[]>;
  let outcome: PaymentOutcome;
  let minted: number;
  let revoked: number;

  const reset = (scenario: Scenario = {}) => {
    subscription = null;
    planName = null;
    planSlug = null;
    canceling = false;
    card =
      scenario.card || scenario.subscribed ? structuredClone(session.portal.paymentMethod) : null;
    billingEmail = scenario.email || scenario.subscribed ? "billing@storefront.test" : null;
    invoices = [];
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
    }
    setups = new Map();
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
    for (const wanted of (order.addOns ?? []) as Json[]) {
      const sold = findAddOnPrice(wanted.addonSlug, currency, base.billingPeriod);
      if (!sold || !(plan.compatibleAddonFamilies as string[]).includes(sold.addon.familySlug)) {
        return {
          problem: problem(
            422,
            "CreateSessionCheckout.AddonNotPublic",
            `"${wanted.addonSlug}" is not a public add-on that fits this plan`,
          ),
        };
      }
      if (sold.addon.maxQuantity != null && wanted.quantity > sold.addon.maxQuantity) {
        return {
          problem: problem(
            422,
            "CreateSessionCheckout.QuantityExceedsMax",
            `at most ${sold.addon.maxQuantity} of "${wanted.addonSlug}"`,
          ),
        };
      }
      if (wanted.quantity <= 0) continue;
      const amount = sold.price.unitAmount * wanted.quantity;
      lines.push({
        seq: lines.length + 1,
        type: "ADDON",
        label: sold.addon.name,
        description: `${wanted.quantity} × ${money(sold.price.unitAmount, currency)}`,
        quantity: String(wanted.quantity),
        unitAmountDecimal: String(sold.price.unitAmount),
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

  // ---- The portal -----------------------------------------------------------

  const portalOf = (stored: Stored): Json => {
    const portal = structuredClone(subscription ? session.portal : session.portalNeverSubscribed);
    portal.customer = { slug: stored.customerSlug, name: "Acme storefront customer", billingEmail };
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
        licenseSlug: subscription ? planSlug : portal.instance.licenseSlug,
        licenseName: subscription ? planName : portal.instance.licenseName,
      };
      portal.subscription = subscription ? { ...subscription, cancelAtPeriodEnd: canceling } : null;
      portal.addOns = structuredClone(addOns);
      portal.upcomingInvoice = null;
      portal.capabilities = {
        paymentMethods: true,
        invoices: true,
        unsubscribe: subscription !== null && !canceling,
        checkout: subscription === null,
      };
    }
    portal.paymentMethod = card ? structuredClone(card) : null;
    portal.vouchers = [];
    portal.updatedAt = new Date().toISOString();
    return portal;
  };

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
        ? reply(200, catalog)
        : problem(
            401,
            "PublicAuth.InvalidCredential",
            "unknown publishable key",
            "/api/public/catalog",
          );
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
      return reply(200, { ...subscription, cancelAtPeriodEnd: false });
    }

    if (key === "POST /public/session/billing/portal-session") {
      return reply(200, { url: `${origin}${DOUBLE_PATH}/provider/portal` });
    }

    if (key === "POST /public/session/billing/payment-method-session") {
      if (!allowedReturn(body.returnUrl, request)) return invalidReturn(path);
      const id = `cs_setup_${randomBytes(6).toString("hex")}`;
      setups.set(id, { returnUrl: String(body.returnUrl), saved: false });
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
      return problem(
        422,
        "SetSessionAddonQuantity.Incompatible",
        "the storefront does not change add-ons after the checkout",
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
    if (subscription) {
      return problem(
        409,
        "CreateSessionCheckout.AlreadySubscribed",
        "this instance already has a live subscription; a plan change is made by the vendor",
        path,
      );
    }
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
    const email = (order.billingEmail as string | undefined) ?? billingEmail;
    if (!email) {
      return problem(
        422,
        "CreateSessionCheckout.BillingEmailRequired",
        "the customer has no billing e-mail: send billingEmail",
        path,
      );
    }
    const { plan, due } = priced as { plan: Json; due: Json };

    if (order.dryRun) {
      return reply(200, {
        status: "preview",
        dueToday: due,
        ...(priced.trialEndsAt ? { trialEndsAt: priced.trialEndsAt } : {}),
      });
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
      setups.set(id, { returnUrl: String(order.returnUrl), saved: false });
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
    planName = plan.name;
    planSlug = plan.licenseSlug;
    addOns = ((order.addOns ?? []) as Json[])
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
      });
    const trialing = priced.trialEndsAt !== undefined;
    subscription = {
      ...structuredClone(session.checkoutSubscribed.subscription),
      status: trialing ? "TRIAL" : "ACTIVE",
      providerKind: "STRIPE",
      collectionMethod: "CHARGE_AUTOMATICALLY",
      currency: base.currency,
      billingPeriod: base.billingPeriod,
      basePrice: structuredClone(base),
      currentPeriodStart: iso(now.getTime()),
      currentPeriodEnd: iso(periodEnd.getTime()),
      trialEndsAt: priced.trialEndsAt ?? null,
      cancelAtPeriodEnd: false,
      scheduledChange: null,
    };
    canceling = false;
    if (!card) card = structuredClone(session.portal.paymentMethod);

    if (due.total <= 0) {
      return reply(201, {
        status: "subscribed",
        subscription,
        payment: { status: "not_required" },
      });
    }

    const id = randomUUID();
    const hostedInvoiceUrl = `${origin}${DOUBLE_PATH}/provider/invoice/${id}`;
    const status =
      outcome === "paid" ? "PAID" : outcome === "processing" ? "PUSHED" : "PAYMENT_FAILED";
    const invoice: Json = {
      id,
      kind: "ACTIVATION",
      status,
      currency: due.currency,
      subtotal: due.subtotal,
      discountTotal: due.discountTotal,
      total: due.total,
      issuedAt: iso(now.getTime()),
      dueAt: iso(now.getTime()),
      paidAt: status === "PAID" ? iso(now.getTime()) : null,
      serviceFrom: iso(now.getTime()),
      serviceTo: iso(periodEnd.getTime()),
      providerInvoiceNumber: `INV-${String(invoices.length + 1).padStart(4, "0")}`,
      externalReference: null,
      hostedInvoiceUrl,
      invoicePdfUrl: `${hostedInvoiceUrl}.pdf`,
      lines: due.lines,
    };
    invoices = [invoice, ...invoices];
    return reply(201, {
      status: "subscribed",
      subscription,
      activationInvoice: structuredClone(invoice),
      payment: { status: outcome, hostedInvoiceUrl },
    });
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
        card = structuredClone(session.portal.paymentMethod);
        const back = new URL(pending.returnUrl);
        back.searchParams.set("kaiten_setup_session", id);
        return new Response(null, { status: 303, headers: { Location: back.toString() } });
      }
      return html(
        "Payment provider",
        `<h1>Payment provider</h1><p>Save a card for Acme storefront.</p>` +
          `<form method="post" action="${DOUBLE_PATH}/provider/setup/${id}/save">` +
          `<button type="submit">Save card 4242 4242 4242 4242</button></form>`,
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
        `<h1>Invoice ${found.providerInvoiceNumber}</h1><p>Status: <strong>${found.status}</strong></p>` +
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
    found.status = "PAID";
    found.paidAt = new Date().toISOString();
    return true;
  }

  function declineInvoice(id: string): boolean {
    const found = invoices.find((each) => each.id === id);
    if (!found) return false;
    found.status = "PAYMENT_FAILED";
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
      outcome = body.outcome as PaymentOutcome;
      return reply(200, { ok: true });
    }
    const act = /^\/control\/invoices\/([^/]+)\/(pay|decline)$/.exec(path);
    if (request.method === "POST" && act) {
      const done = act[2] === "pay" ? payInvoice(act[1]!) : declineInvoice(act[1]!);
      return done ? reply(200, { ok: true }) : reply(404, { ok: false });
    }
    if (request.method === "GET" && path === "/control/calls") return reply(200, log);
    if (request.method === "GET" && path === "/control/state") return reply(200, state());
    return reply(404, { error: "no such control" });
  }

  // ---- The double -----------------------------------------------------------

  function script(key: string, ...replies: Reply[]) {
    scripts.set(key, [...replies]);
  }

  const state = () => ({
    subscribed: subscription !== null,
    cancelAtPeriodEnd: canceling,
    cardOnFile: card !== null,
    billingEmail,
    invoices: invoices.map((each) => ({
      id: each.id as string,
      status: each.status as string,
      total: each.total as number,
    })),
    minted,
    revoked,
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
    script,
    payment: (next) => {
      outcome = next;
    },
    payInvoice,
    declineInvoice,
    calls: () => structuredClone(log),
    state,
  };
}
