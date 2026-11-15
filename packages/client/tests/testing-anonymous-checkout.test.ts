// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, expectTypeOf, test } from "vite-plus/test";

import {
  CheckoutSessionClosedError,
  CheckoutTokenMissingError,
  DueTodayChangedError,
  KaitenAnonymousCheckoutClient,
  KaitenError,
} from "../src/index.ts";
import type { KaitenAnonymousCheckoutClientLike, StartCheckoutInput } from "../src/index.ts";
import { createMockKaitenAnonymousCheckoutClient } from "../src/testing/index.ts";

// The double of the anonymous checkout client: the same methods as the client,
// and the same journeys as the API gives them, played without a server.

/** The controls a test drives the double with: the client has none of them. */
const SCRIPTS = [
  "completeSetup",
  "settlePayment",
  "abandon",
  "failPayment",
  "requireAction",
  "expire",
  "consumeTrial",
];

/** A start, with members overridden: the ones a test sets may be ones the compiler refuses. */
const input = (licenseSlug: string, extra: Record<string, unknown> = {}): StartCheckoutInput =>
  ({
    turnstileToken: "any",
    licenseSlug,
    billingPeriod: "MONTHLY",
    email: "ada@example.test",
    returnUrl: "https://shop.example.test/welcome",
    ...extra,
  }) as StartCheckoutInput;

const opened = async (
  checkout: KaitenAnonymousCheckoutClientLike,
  start: StartCheckoutInput,
): Promise<string> => {
  // `start` is typed as an input in general, so the start may be either.
  const started = await checkout.startCheckout(start);
  if (started.status !== "open") throw new Error("expected a session");
  return started.sessionId;
};

describe("the anonymous checkout double", () => {
  test("has a method for each of the client's, and none more", () => {
    const double = createMockKaitenAnonymousCheckoutClient();
    const methods = [
      "confirmCheckout",
      "forgetCheckoutSession",
      "getCheckoutSession",
      "holdsCheckoutSession",
      "startCheckout",
    ];

    for (const method of methods) {
      expect(typeof (KaitenAnonymousCheckoutClient.prototype as never)[method], method).toBe(
        "function",
      );
    }
    const callable = Object.keys(double)
      .filter((key) => typeof (double as never)[key] === "function")
      .filter((key) => !SCRIPTS.includes(key))
      .sort();
    expect(callable).toEqual(methods);
  });

  test("a free plan completes at the first confirm, with no payment method", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();
    const sessionId = await opened(checkout, input("starter-v1"));
    expect(checkout.holdsCheckoutSession(sessionId)).toBe(true);

    const result = await checkout.confirmCheckout(sessionId);

    expect(result).toMatchObject({
      status: "completed",
      session: { status: "COMPLETED", requiresPaymentMethod: false, dueToday: { total: 0 } },
    });
    expect(result.session.customerSlug).toEqual(expect.any(String));
    // As the client does, it keeps the token of a closed session, to read the outcome.
    expect(checkout.holdsCheckoutSession(sessionId)).toBe(true);
    expect((await checkout.getCheckoutSession(sessionId)).status).toBe("COMPLETED");
  });

  test("a paid plan asks for a payment method, then for a payment", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();
    const sessionId = await opened(checkout, input("growth-v1"));

    const first = await checkout.confirmCheckout(sessionId);
    expect(first).toMatchObject({ status: "requires_payment_method" });
    expect(first.status === "requires_payment_method" && first.setupUrl).toContain(sessionId);
    expect((await checkout.confirmCheckout(sessionId)).status).toBe("requires_payment_method");

    checkout.completeSetup(sessionId);
    const second = await checkout.confirmCheckout(sessionId);
    expect(second).toMatchObject({
      status: "awaiting_payment",
      session: { status: "AWAITING_PAYMENT", payment: { status: "processing" } },
    });

    checkout.settlePayment(sessionId);
    const read = await checkout.getCheckoutSession(sessionId);
    expect(read).toMatchObject({ status: "COMPLETED", payment: { status: "paid" } });
    expect(
      await checkout.confirmCheckout(sessionId).catch((error: unknown) => error),
    ).toBeInstanceOf(CheckoutSessionClosedError);
  });

  test("a trial with no card completes at once, and the same e-mail is refused a second one", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();

    const sessionId = await opened(checkout, input("lite-v1"));
    const started = await checkout.getCheckoutSession(sessionId);
    expect(started).toMatchObject({
      trialRefusedReason: null,
      requiresPaymentMethod: false,
      dueToday: { total: 0, lines: [] },
    });
    expect(started.trialEndsAt).toEqual(expect.any(String));
    await checkout.confirmCheckout(sessionId);

    const again = await checkout.startCheckout(input("lite-v1", { dryRun: true }));
    expect(again).toMatchObject({
      status: "preview",
      trialEndsAt: null,
      trialRefusedReason: "ALREADY_CONSUMED",
      requiresPaymentMethod: true,
      dueToday: { total: 1900 },
    });
    const other = await checkout.startCheckout(
      input("lite-v1", { dryRun: true, email: "grace@example.test" }),
    );
    expect(other).toMatchObject({ trialRefusedReason: null });
  });

  test("a dryRun opens nothing", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();

    const preview = await checkout.startCheckout(input("growth-v1", { dryRun: true }));

    expect(preview).toMatchObject({
      status: "preview",
      dueToday: { currencyCode: "USD", total: 7900 },
    });
    expect(preview).not.toHaveProperty("sessionId");
  });

  test("a session left open is abandoned, and a stranger's session is unknown", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();
    const sessionId = await opened(checkout, input("growth-v1"));

    checkout.abandon(sessionId);

    expect((await checkout.getCheckoutSession(sessionId)).status).toBe("ABANDONED");
    expect(
      await checkout.confirmCheckout(sessionId).catch((error: unknown) => error),
    ).toMatchObject({
      status: 409,
      sessionStatus: "ABANDONED",
    });
    expect(
      await checkout.getCheckoutSession("chk_nope").catch((error: unknown) => error),
    ).toBeInstanceOf(CheckoutTokenMissingError);
  });

  test("refuses what the API refuses, with its status and code", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();

    for (const [start, code] of [
      [input("nope-v1"), "CreateCheckoutSession.PriceNotPublic"],
      [input("growth-v1", { voucherCode: "X" }), "CreateCheckoutSession.VoucherInvalid"],
    ] as const) {
      const error = await checkout.startCheckout(start).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(KaitenError);
      expect(error).toMatchObject({ status: 422, code });
    }
  });

  test("records its calls, and fails them all when told to", async () => {
    const failing = createMockKaitenAnonymousCheckoutClient({ error: new Error("down") });
    await expect(failing.startCheckout(input("growth-v1"))).rejects.toThrow("down");
    expect(failing.calls.map((call) => call.method)).toEqual(["startCheckout"]);
  });

  test("checks the input as the client does, with the same TypeErrors", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();

    for (const bad of [
      input("starter-v1", { turnstileToken: "" }),
      input("starter-v1", { email: undefined }),
      input("starter-v1", { returnUrl: undefined }),
      input("starter-v1", { priceId: "price_starter_monthly" }),
      input("starter-v1", { clientReferenceId: "x".repeat(256) }),
      { ...input("starter-v1"), returnURL: "https://x.test" } as never,
    ]) {
      expect(await checkout.startCheckout(bad).catch((error: unknown) => error)).toBeInstanceOf(
        TypeError,
      );
    }
    expect(checkout.calls.map((call) => call.method)).toHaveLength(6);
    // A dryRun needs neither an e-mail nor a return URL.
    await expect(
      checkout.startCheckout({
        turnstileToken: "any",
        priceId: "price_starter_monthly",
        dryRun: true,
      }),
    ).resolves.toMatchObject({ status: "preview" });
  });

  test("an add-on is a KaitenError the API would give, not a bare Error", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();

    const error = await checkout
      .startCheckout(input("growth-v1", { addOns: [{ addonSlug: "seats", quantity: 1 }] }))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 422, code: "CreateCheckoutSession.AddonNotPublic" });
  });

  test("the start is typed as the client's is, and opens a session with its token", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();

    const base = {
      turnstileToken: "any",
      licenseSlug: "growth-v1",
      billingPeriod: "MONTHLY",
      email: "ada@example.test",
      returnUrl: "https://shop.example.test/welcome",
    };
    const started = await checkout.startCheckout(base);
    const preview = await checkout.startCheckout({ ...base, dryRun: true });

    expectTypeOf(started.sessionId).toBeString();
    expectTypeOf(preview.status).toEqualTypeOf<"preview">();
    expect(started.token).toMatch(/^ksc_/);
  });

  test("a closed session is read until the token is forgotten, and then it is unknown", async () => {
    const checkout = createMockKaitenAnonymousCheckoutClient();
    const sessionId = await opened(checkout, input("starter-v1"));
    await checkout.confirmCheckout(sessionId);

    checkout.forgetCheckoutSession(sessionId);

    expect(checkout.holdsCheckoutSession(sessionId)).toBe(false);
    for (const call of [
      () => checkout.getCheckoutSession(sessionId),
      () => checkout.confirmCheckout(sessionId),
    ]) {
      expect(await call().catch((error: unknown) => error)).toBeInstanceOf(
        CheckoutTokenMissingError,
      );
    }
  });

  describe("scripts a failure", () => {
    test("by method, and by call", async () => {
      const refused = new KaitenError({
        title: "Turnstile",
        status: 422,
        code: "CreateCheckoutSession.TurnstileFailed",
      });
      const checkout = createMockKaitenAnonymousCheckoutClient({
        fail: { startCheckout: (call) => (call === 1 ? refused : undefined) },
      });

      expect(
        await checkout.startCheckout(input("growth-v1")).catch((error: unknown) => error),
      ).toBe(refused);
      const sessionId = await opened(checkout, input("growth-v1"));
      expect((await checkout.confirmCheckout(sessionId)).status).toBe("requires_payment_method");
    });

    test("a confirm that answers DueTodayChanged after a start that succeeded", async () => {
      const changed = new DueTodayChangedError({
        title: "changed",
        status: 409,
        code: "ConfirmCheckoutSession.DueTodayChanged",
      });
      const checkout = createMockKaitenAnonymousCheckoutClient({
        fail: { confirmCheckout: changed },
      });
      const sessionId = await opened(checkout, input("growth-v1"));

      expect(await checkout.confirmCheckout(sessionId).catch((error: unknown) => error)).toBe(
        changed,
      );
      expect((await checkout.getCheckoutSession(sessionId)).status).toBe("OPEN");
    });
  });

  describe("plays a payment that does not simply succeed", () => {
    async function awaitingPayment() {
      const checkout = createMockKaitenAnonymousCheckoutClient();
      const sessionId = await opened(checkout, input("growth-v1"));
      await checkout.confirmCheckout(sessionId);
      checkout.completeSetup(sessionId);
      await checkout.confirmCheckout(sessionId);
      return { checkout, sessionId };
    }

    test("an action the visitor must take, then paid", async () => {
      const { checkout, sessionId } = await awaitingPayment();

      checkout.requireAction(sessionId);
      const read = await checkout.getCheckoutSession(sessionId);
      expect(read).toMatchObject({
        status: "AWAITING_PAYMENT",
        payment: {
          status: "requires_action",
          hostedInvoiceUrl: expect.stringContaining("https://"),
        },
      });
      expect((await checkout.confirmCheckout(sessionId)).status).toBe("awaiting_payment");

      checkout.settlePayment(sessionId);
      expect((await checkout.getCheckoutSession(sessionId)).status).toBe("COMPLETED");
    });

    test("a payment that failed, and a session that expires", async () => {
      const { checkout, sessionId } = await awaitingPayment();

      checkout.failPayment(sessionId);
      expect(await checkout.getCheckoutSession(sessionId)).toMatchObject({
        status: "AWAITING_PAYMENT",
        payment: { status: "failed", hostedInvoiceUrl: expect.stringContaining("https://") },
      });

      checkout.expire(sessionId);
      expect((await checkout.getCheckoutSession(sessionId)).status).toBe("EXPIRED");
      expect(
        await checkout.confirmCheckout(sessionId).catch((error: unknown) => error),
      ).toMatchObject({ sessionStatus: "EXPIRED" });
    });

    test("none of it applies to a session that waits for nothing", async () => {
      const checkout = createMockKaitenAnonymousCheckoutClient();
      const sessionId = await opened(checkout, input("growth-v1"));

      expect(() => checkout.failPayment(sessionId)).toThrow("not waiting for a payment");
      expect(() => checkout.expire(sessionId)).toThrow("not waiting for a payment");
    });
  });

  describe("plays the trial being used up meanwhile", () => {
    test("before a payment method is saved, the confirm goes on with the new amount", async () => {
      const checkout = createMockKaitenAnonymousCheckoutClient();
      const sessionId = await opened(checkout, input("lite-v1"));
      const shown = await checkout.getCheckoutSession(sessionId);
      expect(shown).toMatchObject({ requiresPaymentMethod: false, dueToday: { total: 0 } });

      checkout.consumeTrial(sessionId);
      const confirmed = await checkout.confirmCheckout(sessionId);

      expect(confirmed.status).toBe("requires_payment_method");
      expect(confirmed.session).toMatchObject({
        trialEndsAt: null,
        trialRefusedReason: "ALREADY_CONSUMED",
        requiresPaymentMethod: true,
        dueToday: { total: 1900 },
      });
    });

    test("after it was saved, the confirm is refused with DueTodayChanged", async () => {
      const checkout = createMockKaitenAnonymousCheckoutClient({
        plans: [
          {
            licenseSlug: "lite-v1",
            priceId: "price_lite_monthly",
            billingPeriod: "MONTHLY",
            currencyCode: "USD",
            amount: 1900,
            trialDays: 14,
            requiresPaymentMethod: true,
          },
        ],
      });
      const sessionId = await opened(checkout, input("lite-v1"));
      await checkout.confirmCheckout(sessionId);
      checkout.completeSetup(sessionId);

      checkout.consumeTrial(sessionId);

      expect(
        await checkout.confirmCheckout(sessionId).catch((error: unknown) => error),
      ).toBeInstanceOf(DueTodayChangedError);
      expect((await checkout.getCheckoutSession(sessionId)).status).toBe("OPEN");
    });

    test("needs an open session with a trial", async () => {
      const checkout = createMockKaitenAnonymousCheckoutClient();
      const sessionId = await opened(checkout, input("growth-v1"));

      expect(() => checkout.consumeTrial(sessionId)).toThrow("open session with a trial");
    });
  });
});
