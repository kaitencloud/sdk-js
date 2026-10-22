// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import {
  CheckoutSessionClosedError,
  CheckoutTokenMissingError,
  KaitenError,
} from "../core/index.ts";
import type { KaitenAnonymousCheckoutClientLike } from "../client/anonymous-checkout-client.ts";
import type {
  CheckoutBillingPeriod,
  CheckoutConfirmation,
  CheckoutDueToday,
  CheckoutSession,
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

export interface MockKaitenAnonymousCheckoutClientOptions {
  /** The plans it sells. Defaults to `demoAnonymousCheckoutPlans()`. */
  plans?: MockCheckoutPlan[];
  /** Delay every call by this many milliseconds, so loading states are observable. */
  delayMs?: number;
  /** Reject every call with this error, to drive failure states. */
  error?: Error;
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
 * the test plays with `completeSetup` and `settlePayment`. A call the real API
 * would refuse is refused with the same status and code, a `KaitenError`. It does
 * not check the Turnstile token, and it does not model add-ons or vouchers.
 */
export function createMockKaitenAnonymousCheckoutClient(
  options: MockKaitenAnonymousCheckoutClientOptions = {},
): MockKaitenAnonymousCheckoutClient {
  const plans = structuredClone(options.plans ?? demoAnonymousCheckoutPlans());
  const calls: MockAnonymousCheckoutCall[] = [];
  const sessions = new Map<string, CheckoutSession>();
  /** The sessions the client holds a token for: those it started that have not closed. */
  const held = new Set<string>();
  const setups = new Map<string, "opened" | "done">();
  /** The e-mails that already had a trial of a plan's family, which here is its licence slug. */
  const trialled = new Set<string>();
  let opened = 0;

  async function enter(method: MockAnonymousCheckoutCall["method"], args: unknown[]) {
    calls.push({ method, args });
    if (options.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (options.error) throw options.error;
  }

  const closed = (status: string) => status !== "OPEN" && status !== "AWAITING_PAYMENT";

  function close(session: CheckoutSession, status: string) {
    session.status = status;
    held.delete(session.sessionId);
  }

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

  function quote(plan: MockCheckoutPlan, input: StartCheckoutInput) {
    const key = `${input.email?.trim().toLowerCase()}|${plan.licenseSlug}`;
    const wantsTrial = plan.trialDays !== undefined && input.trial !== false;
    const refused = wantsTrial && input.email !== undefined && trialled.has(key);
    const trialing = wantsTrial && !refused;
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
                description: "",
                quantity: "1",
                unitAmountDecimal: `${total}`,
                amount: total,
                serviceFrom: DEMO_SESSION_NOW,
                serviceTo: DEMO_SESSION_NOW,
              },
            ],
    };
    return {
      key,
      dueToday,
      trialEndsAt: trialing
        ? new Date(Date.parse(DEMO_SESSION_NOW) + (plan.trialDays ?? 0) * DAY_MS).toISOString()
        : null,
      trialRefusedReason: refused ? "ALREADY_CONSUMED" : null,
      requiresPaymentMethod:
        plan.amount === 0 ? false : total > 0 || plan.requiresPaymentMethod === true,
    };
  }

  function session(sessionId: string): CheckoutSession {
    const found = sessions.get(sessionId);
    if (!found || !held.has(sessionId)) {
      if (found && closed(found.status)) return found;
      throw new CheckoutTokenMissingError(sessionId);
    }
    return found;
  }

  function complete(found: CheckoutSession, key: string) {
    found.customerSlug = `customer-${found.sessionId}`;
    found.instanceSlug = `instance-${found.sessionId}`;
    found.completedAt = DEMO_SESSION_NOW;
    if (found.trialEndsAt) trialled.add(key);
    close(found, "COMPLETED");
  }

  /** The key of the trial each session consumes, by session. */
  const keys = new Map<string, string>();

  return {
    get calls() {
      return calls;
    },

    async startCheckout(input: StartCheckoutInput): Promise<CheckoutSessionStart> {
      await enter("startCheckout", [input]);
      if (input.addOns?.length) {
        throw new Error(
          "The anonymous checkout double does not model add-ons: script the outcome with your own double.",
        );
      }
      if (input.voucherCode !== undefined) {
        throw refusal(
          422,
          "CreateCheckoutSession.VoucherInvalid",
          "this voucher cannot be applied",
        );
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
      keys.set(sessionId, key);
      held.add(sessionId);
      return structuredClone({ status: "open", sessionId, expiresAt, ...priced });
    },

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
      const key = keys.get(sessionId) ?? "";

      if (!found.requiresPaymentMethod) {
        complete(found, key);
        return { status: "completed", session: structuredClone(found) };
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
      const found = sessions.get(sessionId);
      if (found?.status !== "AWAITING_PAYMENT") {
        throw new Error(`${sessionId} is not waiting for a payment.`);
      }
      found.payment = { status: "paid", hostedInvoiceUrl: null };
      complete(found, keys.get(sessionId) ?? "");
    },

    abandon(sessionId: string) {
      const found = sessions.get(sessionId);
      if (found?.status !== "OPEN") throw new Error(`${sessionId} is not open.`);
      close(found, "ABANDONED");
    },
  };
}
