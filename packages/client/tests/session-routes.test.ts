import { describe, expect, test } from "vite-plus/test";

import { KaitenError } from "../src/index.ts";
import { answer, refused } from "./support/session-answers.ts";
import { json, open, sent, useSessionClock } from "./support/session-harness.ts";

// Each route of the session client, on the answer Kaiten serves for it
// (fixtures/README.md): what is sent, and what the host reads back.
useSessionClock();

describe("cancel and reactivate", () => {
  test("cancel asks for the period's end and reads the subscription it leaves", async () => {
    const { client, requests } = open(() => json(answer("cancel")));

    const subscription = await client.cancelSubscription({ reason: "too expensive" });

    expect(await sent(requests)).toEqual([
      ["POST", "/public/session/billing/cancel", '{"reason":"too expensive"}'],
    ]);
    expect(subscription).toEqual({
      status: "ACTIVE",
      providerKind: "STRIPE",
      collectionMethod: "CHARGE_AUTOMATICALLY",
      currencyCode: "EUR",
      billingInterval: "month",
      basePrice: {
        id: "00000000-0000-4000-8000-000000000201",
        amount: 4900,
        unitAmountDecimal: "4900",
        currencyCode: "EUR",
        billingModel: "FLAT_FEE",
        isDefault: true,
        interval: "month",
        label: "Monthly",
      },
      currentPeriodStart: "2026-10-01T00:00:00Z",
      currentPeriodEnd: "2026-11-01T00:00:00Z",
      trialEndsAt: null,
      cancelAtPeriodEnd: true,
      scheduledChange: null,
    });
  });

  test("cancel without a reason sends an empty object, the body the route requires", async () => {
    const { client, requests } = open(() => json(answer("cancel")));

    await client.cancelSubscription();

    expect(await sent(requests)).toEqual([["POST", "/public/session/billing/cancel", "{}"]]);
  });

  test("reactivate sends no body, and reads the subscription it keeps", async () => {
    const { client, requests } = open(() => json(answer("reactivate")));

    const subscription = await client.reactivateSubscription();

    expect(await sent(requests)).toEqual([
      ["POST", "/public/session/billing/reactivate", undefined],
    ]);
    expect(requests[0]!.headers.get("Content-Type")).toBeNull();
    expect(subscription).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: false });
  });

  test("a plan change scheduled for the period's end carries the price it moves to", async () => {
    const wire = answer("reactivate");
    wire.scheduledChange = {
      effectiveAt: "2026-11-01T00:00:00Z",
      price: {
        id: "00000000-0000-4000-8000-000000000204",
        billingModel: "FLAT_FEE",
        billingTiming: "ADVANCE",
        billingPeriod: "ANNUAL",
        currency: "EUR",
        unitAmount: 49000,
        unitAmountDecimal: "49000",
        displayLabel: "Annual",
        displayOrder: 0,
        isDefault: true,
      },
    };
    const { client } = open(() => json(wire));

    const subscription = await client.reactivateSubscription();

    expect(subscription.scheduledChange).toMatchObject({
      effectiveAt: "2026-11-01T00:00:00Z",
      price: { amount: 49000, interval: "year", label: "Annual" },
    });
  });

  test("a quarterly period is three months, and a trial has an end", async () => {
    const wire = answer("reactivate");
    wire.status = "TRIAL";
    wire.billingPeriod = "QUARTERLY";
    wire.trialEndsAt = "2026-11-01T00:00:00Z";
    const { client } = open(() => json(wire));

    const subscription = await client.reactivateSubscription();

    expect(subscription).toMatchObject({
      status: "TRIAL",
      billingInterval: "month",
      intervalCount: 3,
      trialEndsAt: "2026-11-01T00:00:00Z",
    });
  });

  test("a refusal keeps its code and how long to wait, and the write is not replayed", async () => {
    const { client, requests } = open(() => refused("cancelBoundaryPending"));

    const error = await client.cancelSubscription().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({
      status: 409,
      code: "CancelSessionSubscription.BoundaryPending",
      retryAfterSeconds: 60,
    });
    expect(requests).toHaveLength(1);
  });
});
