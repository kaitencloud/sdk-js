// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import {
  CheckoutSessionClosedError,
  CheckoutTokenMissingError,
  KaitenAnonymousCheckoutClient,
  KaitenError,
} from "../src/index.ts";
import type { KaitenAnonymousCheckoutClientLike, StartCheckoutInput } from "../src/index.ts";
import { createMockKaitenAnonymousCheckoutClient } from "../src/testing/index.ts";

// The double of the anonymous checkout client: the same methods as the client,
// and the same journeys as the API gives them, played without a server.

const input = (
  licenseSlug: string,
  extra: Partial<StartCheckoutInput> = {},
): StartCheckoutInput => ({
  turnstileToken: "any",
  licenseSlug,
  billingPeriod: "MONTHLY",
  email: "ada@example.test",
  returnUrl: "https://shop.example.test/welcome",
  ...extra,
});

const opened = async (
  checkout: KaitenAnonymousCheckoutClientLike,
  start: StartCheckoutInput,
): Promise<string> => {
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
      .filter((key) => !["completeSetup", "settlePayment", "abandon"].includes(key))
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
    expect(checkout.holdsCheckoutSession(sessionId)).toBe(false);
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
});
