// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import {
  CheckoutSessionClosedError,
  CheckoutTokenMissingError,
  DueTodayChangedError,
  KaitenError,
} from "../core/index.ts";
import type { KaitenAnonymousCheckoutClientLike } from "../client/anonymous-checkout-client.ts";
import { startCheckoutBody } from "../client/anonymous-checkout-input.ts";
import type {
  CheckoutBillingPeriod,
  CheckoutConfirmation,
  CheckoutDueToday,
  CheckoutSession,
  CheckoutSessionOpened,
  CheckoutSessionPreview,
  CheckoutSessionStart,
  StartCheckoutInput,
} from "../client/anonymous-checkout-types.ts";
import { DEMO_SESSION_NOW, DEMO_SETUP_EXPIRES_AT } from "./session-fixtures.ts";

/** A plan the anonymous checkout double can sell, by one price. */
export interface MockCheckoutPlan {
  /** The version of the plan, as `StartCheckoutInput.licenseSlug` names it. */
  licenseSlug: string;
  /** The price, as `StartCheckoutInput.priceId` names it. */
  priceId: string;
  billingPeriod: CheckoutBillingPeriod;
  currencyCode: string;
  /** The flat fee, in minor units. `0` is a free plan, onboarded with no payment method. */
  amount: number;
  /** Days of free trial, if the plan has one. */
  trialDays?: number;
  /** Whether a trial needs a payment method first. Defaults to false. */
  requiresPaymentMethod?: boolean;
}

/**
 * What a method of the double does on its nth call (1 for the first): an error to
 * reject with, or nothing to let the call through. A function lets one call fail and
 * the next succeed, such as a Turnstile token refused once.
 */
export type MockCheckoutScript = Error | ((call: number) => Error | void);

export interface MockKaitenAnonymousCheckoutClientOptions {
  /** The plans it sells. Defaults to `demoAnonymousCheckoutPlans()`. */
  plans?: MockCheckoutPlan[];
  /** Delay every call by this many milliseconds, so loading states are observable. */
  delayMs?: number;
  /** Reject every call with this error, to drive failure states. */
  error?: Error;
  /**
   * Fail one method, or one call of it, and let the others through: `start succeeds,
   * then confirm answers DueTodayChanged`. Runs after the input checks and `error`.
   */
  fail?: {
    startCheckout?: MockCheckoutScript;
    getCheckoutSession?: MockCheckoutScript;
    confirmCheckout?: MockCheckoutScript;
  };
}

/** A call the double received: the method and its arguments. */
export interface MockAnonymousCheckoutCall {
  method: keyof KaitenAnonymousCheckoutClientLike;
  args: unknown[];
}

export interface MockKaitenAnonymousCheckoutClient extends KaitenAnonymousCheckoutClientLike {
  /** Every call, oldest first. */
  readonly calls: MockAnonymousCheckoutCall[];
  /** Plays the visitor saving a payment method on the hosted page. The next confirm moves on. */
  completeSetup: (sessionId: string) => void;
  /** Plays the first invoice being paid: the session reads `COMPLETED`. */
  settlePayment: (sessionId: string) => void;
  /** Plays the session staying open for 24 hours: it reads `ABANDONED`. */
  abandon: (sessionId: string) => void;
  /**
   * Plays the first invoice failing: the session stays `AWAITING_PAYMENT`, with
   * `payment.status: "failed"` and a `hostedInvoiceUrl` to pay on.
   */
  failPayment: (sessionId: string) => void;
  /**
   * Plays the payment needing the visitor (3-D Secure): `payment.status:
   * "requires_action"` and a `hostedInvoiceUrl` to go to.
   */
  requireAction: (sessionId: string) => void;
  /** Plays the payment never coming: the session reads `EXPIRED`. */
  expire: (sessionId: string) => void;
  /**
   * Plays another checkout using up the trial of the session's e-mail meanwhile. At
   * the next confirm before the payment method is saved, the session loses its trial,
   * its `dueToday` is recomposed and the confirm asks for a payment method with the new
   * amount; after it was saved, the confirm is refused with a `DueTodayChangedError`.
   */
  consumeTrial: (sessionId: string) => void;
}

/** The plans of the double: a free one, a paid one in two periods, and a trial with no card. */
export function demoAnonymousCheckoutPlans(): MockCheckoutPlan[] {
  return [
    {
      licenseSlug: "starter-v1",
      priceId: "price_starter_monthly",
      billingPeriod: "MONTHLY",
      currencyCode: "USD",
      amount: 0,
    },
    {
      licenseSlug: "growth-v1",
      priceId: "price_growth_monthly",
      billingPeriod: "MONTHLY",
      currencyCode: "USD",
      amount: 7900,
    },
    {
      licenseSlug: "growth-v1",
      priceId: "price_growth_annual",
      billingPeriod: "ANNUAL",
      currencyCode: "USD",
      amount: 79000,
    },
    {
      licenseSlug: "lite-v1",
      priceId: "price_lite_monthly",
      billingPeriod: "MONTHLY",
      currencyCode: "USD",
      amount: 1900,
      trialDays: 14,
    },
  ];
}

const refusal = (status: number, code: string, detail: string) =>
  new KaitenError({ title: detail, status, code, detail });

const DAY_MS = 86_400_000;

/** How many calendar months a billing period of the API lasts. */
const MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, ANNUAL: 12 };

/** The end of the first period a plan bills, `months` after the demo instant, UTC. */
function periodEnd(months: number): string {
  const end = new Date(DEMO_SESSION_NOW);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end.toISOString();
}

/**
 * A `KaitenAnonymousCheckoutClient` backed by in-memory state instead of an API: a
 * checkout for a visitor with no account to build against, with no Kaiten account
 * and no Turnstile. Anything typed `KaitenAnonymousCheckoutClientLike` takes it.
 *
 * ```ts
 * import { createMockKaitenAnonymousCheckoutClient } from "@kaitencloud/client/testing";
 *
 * const checkout = createMockKaitenAnonymousCheckoutClient();
 * const started = await checkout.startCheckout({
 *   turnstileToken: "any",
 *   licenseSlug: "starter-v1",
 *   billingPeriod: "MONTHLY",
 *   email: "ada@example.com",
 *   returnUrl: "https://shop.example.com/welcome",
 * });
 * const done = await checkout.confirmCheckout(started.sessionId);
 * ```
 *
 * It is a fake, not a stub: a free plan or a trial with no card completes at the
 * first confirm; any other asks for a payment method, then for a payment, which
 * the test plays with `completeSetup` and `settlePayment`, or ends otherwise with
 * `failPayment`, `requireAction`, `expire` and `abandon`. `consumeTrial` plays the trial
 * being used up meanwhile, and `options.fail` makes one method, or one call of it, fail.
 *
 * The input is checked as the client checks it, with the same `TypeError`s, and a call
 * the real API would refuse is refused with the same status and code, a `KaitenError`.
 * Like the client, it keeps a session's token after the session closes, so a closed
 * session can be read, until `forgetCheckoutSession`, after which every call on it
 * rejects with `CheckoutTokenMissingError`. It does not check the Turnstile token's
 * value, and it does not model add-ons or vouchers.
 */
export function createMockKaitenAnonymousCheckoutClient(
  options: MockKaitenAnonymousCheckoutClientOptions = {},
): MockKaitenAnonymousCheckoutClient {
  const plans = structuredClone(options.plans ?? demoAnonymousCheckoutPlans());
  const calls: MockAnonymousCheckoutCall[] = [];
  const sessions = new Map<string, CheckoutSession>();
  /** The sessions the client holds a token for: those it started, until they are forgotten. */
  const held = new Set<string>();
  const setups = new Map<string, "opened" | "done">();
  /** The e-mails that already had a trial of a plan's family, which here is its licence slug. */
  const trialled = new Set<string>();
  /** The plan and the trial's key of each session. */
  const origins = new Map<string, { plan: MockCheckoutPlan; key: string }>();
  const counts = new Map<string, number>();
  let opened = 0;

  async function enter(
    method: MockAnonymousCheckoutCall["method"],
    args: unknown[],
    check?: () => void,
  ) {
    calls.push({ method, args });
    check?.();
    if (options.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (options.error) throw options.error;
    const script = options.fail?.[method as keyof NonNullable<typeof options.fail>];
    if (script) {
      const count = (counts.get(method) ?? 0) + 1;
      counts.set(method, count);
      const failure = typeof script === "function" ? script(count) : script;
      if (failure) throw failure;
    }
  }

  const closed = (status: string) => status !== "OPEN" && status !== "AWAITING_PAYMENT";

  function find(input: StartCheckoutInput): MockCheckoutPlan {
    const plan = plans.find((candidate) =>
      input.priceId !== undefined
        ? candidate.priceId === input.priceId
        : candidate.licenseSlug === input.licenseSlug &&
          candidate.billingPeriod === input.billingPeriod,
    );
    if (!plan) {
      throw refusal(
        422,
        "CreateCheckoutSession.PriceNotPublic",
        "the price is not an ACTIVE flat-fee price of a plan in the public catalogue",
      );
    }
    return plan;
  }

  /** What a plan bills today, with or without its trial. */
  function price(plan: MockCheckoutPlan, trialing: boolean) {
    const total = trialing ? 0 : plan.amount;
    const dueToday: CheckoutDueToday = {
      currencyCode: plan.currencyCode,
      subtotal: total,
      discountTotal: 0,
      total,
      lines:
        total === 0
          ? []
          : [
              {
                seq: 1,
                type: "BASE",
                label: plan.licenseSlug,
                // The server's own arithmetic, in its own format: "1 × 79.00 USD".
                description: `1 × ${(total / 100).toFixed(2)} ${plan.currencyCode}`,
                quantity: "1",
                unitAmountDecimal: `${total}`,
                amount: total,
                serviceFrom: DEMO_SESSION_NOW,
                serviceTo: periodEnd(MONTHS[plan.billingPeriod] ?? 1),
              },
            ],
    };
    return {
      dueToday,
      requiresPaymentMethod:
        plan.amount === 0 ? false : total > 0 || plan.requiresPaymentMethod === true,
    };
  }

  function quote(plan: MockCheckoutPlan, input: StartCheckoutInput) {
    const key = `${input.email?.trim().toLowerCase()}|${plan.licenseSlug}`;
    const wantsTrial = plan.trialDays !== undefined && input.trial !== false;
    const refused = wantsTrial && input.email !== undefined && trialled.has(key);
    const trialing = wantsTrial && !refused;
    return {
      key,
      ...price(plan, trialing),
      trialEndsAt: trialing
        ? new Date(Date.parse(DEMO_SESSION_NOW) + (plan.trialDays ?? 0) * DAY_MS).toISOString()
        : null,
      trialRefusedReason: refused ? "ALREADY_CONSUMED" : null,
    };
  }

  /** The session of a token the client holds, closed or not. */
  function session(sessionId: string): CheckoutSession {
    const found = sessions.get(sessionId);
    if (!found || !held.has(sessionId)) throw new CheckoutTokenMissingError(sessionId);
    return found;
  }

  function close(found: CheckoutSession, status: string) {
    found.status = status;
  }

  function complete(found: CheckoutSession, key: string) {
    found.customerSlug = `customer-${found.sessionId}`;
    found.instanceSlug = `instance-${found.sessionId}`;
    found.completedAt = DEMO_SESSION_NOW;
    if (found.trialEndsAt) trialled.add(key);
    close(found, "COMPLETED");
  }

  function awaiting(sessionId: string): CheckoutSession {
    const found = sessions.get(sessionId);
    if (found?.status !== "AWAITING_PAYMENT") {
      throw new Error(`${sessionId} is not waiting for a payment.`);
    }
    return found;
  }

  const invoiceUrl = (sessionId: string) => `https://pay.example.test/invoice/${sessionId}`;

  // Typed by what it asks for, as the client's is: a page tested against the double compiles
  // where it compiles against the client.
  function startCheckout(
    input: StartCheckoutInput & { dryRun: true },
  ): Promise<CheckoutSessionPreview>;
  function startCheckout(
    input: StartCheckoutInput & { dryRun?: false },
  ): Promise<CheckoutSessionOpened>;
  function startCheckout(input: StartCheckoutInput): Promise<CheckoutSessionStart>;
  async function startCheckout(input: StartCheckoutInput): Promise<CheckoutSessionStart> {
    await enter("startCheckout", [input], () => void startCheckoutBody(input));
    if (input.addOns?.length) {
      throw refusal(
        422,
        "CreateCheckoutSession.AddonNotPublic",
        "the anonymous checkout double models no add-ons: script the outcome with options.fail",
      );
    }
    if (input.voucherCode !== undefined) {
      throw refusal(422, "CreateCheckoutSession.VoucherInvalid", "this voucher cannot be applied");
    }
    const plan = find(input);
    const { key, ...priced } = quote(plan, input);
    if (input.dryRun === true) return structuredClone({ status: "preview", ...priced });

    const sessionId = `chk_mock_${++opened}`;
    const expiresAt = new Date(Date.parse(DEMO_SESSION_NOW) + DAY_MS).toISOString();
    sessions.set(sessionId, {
      sessionId,
      status: "OPEN",
      email: input.email ?? "",
      clientReferenceId: input.clientReferenceId ?? null,
      licenseSlug: plan.licenseSlug,
      billingPeriod: plan.billingPeriod,
      priceId: plan.priceId,
      addOns: [],
      ...structuredClone(priced),
      expiresAt,
      customerSlug: null,
      instanceSlug: null,
      activationInvoice: null,
      payment: null,
      createdAt: DEMO_SESSION_NOW,
      completedAt: null,
    });
    origins.set(sessionId, { plan, key });
    held.add(sessionId);
    return structuredClone({
      status: "open",
      sessionId,
      token: `ksc_mock_${sessionId}`,
      expiresAt,
      ...priced,
    });
  }

  /** Another checkout used up the trial: the session loses it, or the confirm is refused. */
  function recheckTrial(found: CheckoutSession, sessionId: string) {
    const origin = origins.get(sessionId);
    if (!origin || !found.trialEndsAt || !trialled.has(origin.key)) return;
    if (setups.get(sessionId) === "done") {
      throw new DueTodayChangedError({
        title: "The amount due changed",
        status: 409,
        code: "ConfirmCheckoutSession.DueTodayChanged",
        detail: "the trial was used up since the visitor was shown the amount",
      });
    }
    Object.assign(found, price(origin.plan, false), {
      trialEndsAt: null,
      trialRefusedReason: "ALREADY_CONSUMED",
    });
  }

  return {
    get calls() {
      return calls;
    },

    startCheckout,

    async getCheckoutSession(sessionId: string): Promise<CheckoutSession> {
      await enter("getCheckoutSession", [sessionId]);
      return structuredClone(session(sessionId));
    },

    async confirmCheckout(sessionId: string): Promise<CheckoutConfirmation> {
      await enter("confirmCheckout", [sessionId]);
      const found = session(sessionId);
      if (closed(found.status)) {
        throw new CheckoutSessionClosedError({
          title: "Checkout session closed",
          status: 409,
          code: "ConfirmCheckoutSession.SessionClosed",
          errors: [{ location: "session", message: "closed", value: { status: found.status } }],
        });
      }
      const key = origins.get(sessionId)?.key ?? "";
      if (found.status === "OPEN") recheckTrial(found, sessionId);

      if (!found.requiresPaymentMethod) {
        complete(found, key);
        return { status: "completed", session: structuredClone(found) };
      }
      if (found.status === "AWAITING_PAYMENT") {
        return { status: "awaiting_payment", session: structuredClone(found) };
      }
      if (setups.get(sessionId) !== "done") {
        setups.set(sessionId, "opened");
        return {
          status: "requires_payment_method",
          setupUrl: `https://pay.example.test/setup/${sessionId}`,
          setupExpiresAt: DEMO_SETUP_EXPIRES_AT,
          session: structuredClone(found),
        };
      }
      if (found.trialEndsAt) {
        complete(found, key);
        return { status: "completed", session: structuredClone(found) };
      }
      found.status = "AWAITING_PAYMENT";
      found.customerSlug = `customer-${sessionId}`;
      found.instanceSlug = `instance-${sessionId}`;
      found.payment = { status: "processing", hostedInvoiceUrl: null };
      return { status: "awaiting_payment", session: structuredClone(found) };
    },

    holdsCheckoutSession(sessionId: string): boolean {
      return held.has(sessionId);
    },

    forgetCheckoutSession(sessionId: string): void {
      held.delete(sessionId);
    },

    completeSetup(sessionId: string) {
      if (setups.get(sessionId) !== "opened") {
        throw new Error(`No payment method setup is open for ${sessionId}: confirm it first.`);
      }
      setups.set(sessionId, "done");
    },

    settlePayment(sessionId: string) {
      const found = awaiting(sessionId);
      found.payment = { status: "paid", hostedInvoiceUrl: null };
      complete(found, origins.get(sessionId)?.key ?? "");
    },

    failPayment(sessionId: string) {
      awaiting(sessionId).payment = { status: "failed", hostedInvoiceUrl: invoiceUrl(sessionId) };
    },

    requireAction(sessionId: string) {
      awaiting(sessionId).payment = {
        status: "requires_action",
        hostedInvoiceUrl: invoiceUrl(sessionId),
      };
    },

    expire(sessionId: string) {
      close(awaiting(sessionId), "EXPIRED");
    },

    abandon(sessionId: string) {
      const found = sessions.get(sessionId);
      if (found?.status !== "OPEN") throw new Error(`${sessionId} is not open.`);
      close(found, "ABANDONED");
    },

    consumeTrial(sessionId: string) {
      const origin = origins.get(sessionId);
      const found = sessions.get(sessionId);
      if (!origin || found?.status !== "OPEN" || !found.trialEndsAt) {
        throw new Error(`${sessionId} is not an open session with a trial.`);
      }
      trialled.add(origin.key);
    },
  };
}
