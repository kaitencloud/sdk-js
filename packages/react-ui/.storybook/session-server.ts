// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A Kaiten for the tests and the stories of the billing components: the real customer-session client, whose `fetch`
// answers the way Kaiten does. The answers are the ones recorded from Kaiten for Initech
// (`packages/client/tests/fixtures/session.initech.json`), and a call that changes the customer's
// billing changes what the next read of the portal says, so that a component is held to what it
// shows after the change and not to the call it made.
//
// Its checkout replays the recorded answers: a preview, a request for a payment method, and the
// subscription with the payment as it went (`checkout` in the options says which).
//
// A test scripts a refusal for one call (`script`), and reads the calls it received (`calls`).

import { KaitenSessionClient } from "@kaitencloud/client";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

export const API = "https://kaiten.test/api";

export type PortalName =
  | "portal"
  | "portalCanceling"
  | "portalScheduledChange"
  | "portalPastDue"
  | "portalCustomerWide"
  | "portalNeverSubscribed";

export type ErrorName = keyof typeof answers.errors;

/**
 * The portal of an instance in its trial, with the trial block as the contract writes it
 * (`PortalTrial`). Kaiten's recorded portal is the base: only the subscription's status and the
 * block change. Pass `trial` for another figure, `null` for a trial that charges nothing (`charge`)
 * or has no card yet (`paymentMethod`).
 */
export function trialPortal(
  trial: Partial<{
    endsAt: string;
    reminderAt: string | null;
    charge: {
      amount: number;
      currency: string;
      billingPeriod: "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL";
    } | null;
    paymentMethod: { brand: string | null; last4: string | null } | null;
  }> = {},
  change: (portal: Record<string, any>) => void = () => {},
): Record<string, any> {
  const portal: Record<string, any> = structuredClone(answers.portal);
  const endsAt = trial.endsAt ?? "2026-10-30T09:00:00Z";
  portal.subscription = { ...portal.subscription, status: "TRIAL", trialEndsAt: endsAt };
  portal.upcomingInvoice = null;
  portal.paymentMethod = null;
  portal.trial = {
    endsAt,
    reminderAt: trial.reminderAt === undefined ? "2026-10-27T09:00:00Z" : trial.reminderAt,
    charge:
      trial.charge === undefined
        ? { amount: 4900, currency: "EUR", billingPeriod: "MONTHLY" }
        : trial.charge,
    paymentMethod: trial.paymentMethod === undefined ? null : trial.paymentMethod,
  };
  change(portal);
  return portal;
}

/** An answer, as a status, a body and the `Retry-After` it may carry. */
export interface Reply {
  status: number;
  body?: unknown;
  retryAfter?: number;
}

/** A refusal Kaiten gave, as recorded. */
export const refusal = (name: ErrorName): Reply => {
  const recorded = answers.errors[name] as { status: number; body: unknown; retryAfter?: number };
  return { status: recorded.status, body: recorded.body, retryAfter: recorded.retryAfter };
};

export interface Call {
  method: string;
  /** The whole address requested: nothing of a customer's secrets belongs in it. */
  url: string;
  /** The route under `/public/session/`. */
  route: string;
  body: unknown;
}

export interface SessionServer {
  client: KaitenSessionClient;
  /** Every request it received, oldest first. */
  calls: Call[];
  /** The calls to one route: `calls.filter(…)`. */
  to: (method: string, route: string) => Call[];
  /** The portal as it stands now. */
  portal: () => Record<string, any>;
  /** The invoices as they stand now. */
  setInvoices: (items: unknown[], hasMore?: boolean) => void;
  /**
   * Answers the next calls to `METHOD route` with these, in turn, instead of what it would, and goes
   * back to what it would once they are spent. A route
   * with an id in it is matched with a `*`: `POST billing/payment-method-session/*\/complete`.
   */
  script: (key: string, ...replies: Reply[]) => void;
}

const json = (reply: Reply) =>
  new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
    status: reply.status,
    headers: {
      "Content-Type": "application/json",
      ...(reply.retryAfter ? { "Retry-After": `${reply.retryAfter}` } : {}),
    },
  });

/** The voucher codes it knows: anything else is refused, with the same answer whatever the reason. */
const CODES: Record<string, unknown> = {
  WELCOME20: answers.voucherPercent,
  LAUNCHBOOST: answers.voucherBoost,
  FIVEOFF: answers.voucherFixed,
};

/** How a recorded checkout goes: the payment it ends in, and whether the plan starts with a trial. */
export interface CheckoutScript {
  /** `paid` by default. `trial` is a subscription that starts as one, with nothing due today. */
  payment?: "paid" | "action" | "trial";
}

export function sessionServer(
  options: {
    portal?: PortalName | Record<string, any>;
    delayMs?: number;
    checkout?: CheckoutScript;
  } = {},
): SessionServer {
  const initial = options.portal ?? "portal";
  let portal: Record<string, any> = structuredClone(
    typeof initial === "string" ? answers[initial] : initial,
  );
  // Every add-on the portal ever held: one set to none leaves the portal, and can be attached again.
  const attachable = new Map<string, Record<string, any>>(
    (portal.addOns as Array<Record<string, any>>).map((addon) => [addon.addonSlug, addon]),
  );
  let invoices: unknown[] = structuredClone(answers.invoicesFirstPage.items);
  let more = true;
  const calls: Call[] = [];
  const scripts = new Map<string, Reply[]>();

  const change = (patch: Record<string, any>) => {
    portal = { ...portal, ...patch };
  };

  const handle = (method: string, route: string, body: any, cursor: string | null): Reply => {
    if (method === "GET" && route === "portal") return { status: 200, body: portal };
    if (method === "GET" && route === "invoices") {
      return cursor
        ? { status: 200, body: answers.invoicesLastPage }
        : {
            status: 200,
            body: more
              ? { ...answers.invoicesFirstPage, items: invoices }
              : { items: invoices, hasMore: false },
          };
    }
    if (method === "POST" && route === "billing/cancel") {
      // A trial, and a checkout that waits for its payment, end at once with nothing charged;
      // any other subscription runs to the end of its period.
      const atOnce = ["TRIAL", "INCOMPLETE"].includes(portal.subscription?.status);
      change(
        atOnce
          ? {
              subscription: {
                ...portal.subscription,
                status: "CANCELED",
                cancelAtPeriodEnd: false,
              },
              upcomingInvoice: null,
              ...("trial" in portal ? { trial: null } : {}),
              capabilities: { ...portal.capabilities, unsubscribe: false, checkout: true },
            }
          : {
              subscription: { ...portal.subscription, cancelAtPeriodEnd: true },
              capabilities: { ...portal.capabilities, unsubscribe: false },
            },
      );
      return { status: 200, body: portal.subscription };
    }
    if (method === "POST" && route === "billing/reactivate") {
      change({
        subscription: { ...portal.subscription, cancelAtPeriodEnd: false },
        capabilities: { ...portal.capabilities, unsubscribe: true },
      });
      return { status: 200, body: portal.subscription };
    }
    if (method === "PUT" && route.startsWith("addons/")) {
      const slug = route.slice("addons/".length);
      const held = (portal.addOns as Array<Record<string, any>>).find((a) => a.addonSlug === slug);
      const known = held ?? attachable.get(slug);
      if (!known) return refusal("addonIncompatible");
      const next = { ...known, quantity: body.quantity };
      change({
        addOns:
          body.quantity === 0
            ? (portal.addOns as Array<Record<string, any>>).filter((a) => a.addonSlug !== slug)
            : held
              ? (portal.addOns as Array<Record<string, any>>).map((a) =>
                  a.addonSlug === slug ? next : a,
                )
              : [...portal.addOns, next],
      });
      return { status: 200, body: next };
    }
    if (method === "POST" && route === "vouchers/validate") {
      const code = String(body.code)
        .replace(/[^a-z0-9]/gi, "")
        .toUpperCase();
      return { status: 200, body: CODES[code] ?? answers.voucherRefused };
    }
    if (method === "POST" && route === "vouchers/redeem") {
      // The refusals in the order the API makes them: the session's instance, then its subscription.
      const status = portal.subscription?.status;
      if (!portal.instance) return refusal("redeemInstanceRequired");
      if (status === "INCOMPLETE") return refusal("redeemSubscriptionIncomplete");
      if (!portal.subscription || status === "CANCELED") return refusal("redeemNoLiveSubscription");
      const code = String(body.code)
        .replace(/[^a-z0-9]/gi, "")
        .toUpperCase();
      const given = CODES[code] as { valid?: boolean; voucher?: Record<string, any> } | undefined;
      const voucher = given?.valid ? given.voucher : undefined;
      const held = (portal.vouchers as Array<Record<string, any>>).some(
        (each) => each.name === voucher?.name,
      );
      if (!voucher || held) return refusal("redeemVoucherInvalid");
      const prices = voucher.voucherType === "PRICE";
      const redemption = {
        name: voucher.name,
        voucherType: voucher.voucherType,
        status: "ACTIVE",
        appliesFromInvoice: prices ? "next" : null,
        applicationsCount: 0,
        applicationsMax: !prices
          ? null
          : voucher.duration === "ONE_TIME"
            ? 1
            : voucher.duration === "REPEATING"
              ? voucher.durationInPeriods
              : null,
        effectiveStartsAt: "2026-10-23T09:00:00Z",
        effectiveExpiresAt: null,
      };
      if (!body.dryRun) change({ vouchers: [redemption, ...portal.vouchers] });
      return { status: body.dryRun ? 200 : 201, body: redemption };
    }
    if (method === "POST" && route === "checkout") {
      const payment = options.checkout?.payment ?? "paid";
      if (body.dryRun) {
        return {
          status: 200,
          body: payment === "trial" ? answers.checkoutPreviewTrial : answers.checkoutPreview,
        };
      }
      // A customer with no payment method is sent to save one first, and comes back with the session.
      if (!portal.paymentMethod && !body.setupSessionId) {
        return {
          status: 200,
          body: {
            ...answers.checkoutRequiresMethod,
            expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          },
        };
      }
      const done =
        payment === "action"
          ? answers.checkoutSubscribedAction
          : payment === "trial"
            ? answers.checkoutSubscribedTrial
            : answers.checkoutSubscribed;
      change({ subscription: done.subscription });
      return { status: 200, body: done };
    }
    if (method === "POST" && route === "billing/portal-session") {
      return { status: 200, body: answers.portalSession };
    }
    if (method === "POST" && route === "billing/payment-method-session") {
      // The recorded page expired when it was recorded: the one a test or a story gets is open for an hour.
      return {
        status: 200,
        body: {
          ...answers.paymentMethodSession,
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        },
      };
    }
    if (method === "POST" && /^billing\/payment-method-session\/[^/]+\/complete$/.test(route)) {
      const saved = answers.paymentMethodCompleted.paymentMethod;
      change({
        paymentMethod: saved,
        // A trial's card is the one the customer now pays with.
        ...(portal.trial
          ? {
              trial: { ...portal.trial, paymentMethod: { brand: saved.brand, last4: saved.last4 } },
            }
          : {}),
      });
      return { status: 200, body: answers.paymentMethodCompleted };
    }
    return { status: 404, body: { title: "Not Found", status: 404, detail: `${method} ${route}` } };
  };

  const fetchImpl = async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const route = url.pathname.slice(
      url.pathname.indexOf("/public/session/") + "/public/session/".length,
    );
    const text = await request.text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: request.method, url: request.url, route, body });

    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    for (const key of [
      `${request.method} ${route}`,
      `${request.method} ${route.replace(/\/[^/]+\/complete$/, "/*/complete")}`,
    ]) {
      const queue = scripts.get(key);
      if (queue?.length) return json(queue.shift()!);
    }
    return json(handle(request.method, route, body, url.searchParams.get("cursor")));
  };

  return {
    client: new KaitenSessionClient({
      apiUrl: API,
      fetch: fetchImpl,
      getCustomerSession: () => ({
        token: `kst_${"s".repeat(43)}`,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
    }),
    calls,
    to: (method, route) => calls.filter((call) => call.method === method && call.route === route),
    portal: () => portal,
    setInvoices: (items, hasMore = false) => {
      invoices = items;
      more = hasMore;
    },
    script: (key, ...replies) => {
      scripts.set(key, replies);
    },
  };
}
