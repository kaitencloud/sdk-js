// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { KaitenError, RateLimitedError } from "../src/index.ts";
import type { WireTrial } from "../src/client/session-spec-shapes.ts";
import {
  createMockKaitenSessionClient,
  demoPortal,
  demoTrialPortal,
} from "../src/testing/index.ts";
import { answer } from "./support/session-answers.ts";
import { json, open, sent, useSessionClock } from "./support/session-harness.ts";

// The trial block of the portal and the redemption of a code, on the shapes the specification
// gives (`src/client/session-spec-shapes.ts`): the contract snapshot does not carry them yet, so
// these answers are doubles, built here from the portal Kaiten serves.
useSessionClock();

/** The portal of the contract, in a trial, with the block the specification adds. */
function trialPortal(trial: WireTrial | null | undefined) {
  const portal = answer("portal");
  return {
    ...portal,
    subscription: { ...portal.subscription!, status: "TRIAL" as const },
    ...(trial === undefined ? {} : { trial }),
  };
}

const BLOCK: WireTrial = {
  endsAt: "2026-10-30T09:00:00Z",
  reminderAt: "2026-10-27T09:00:00Z",
  charge: { amount: 4900, currency: "EUR", billingPeriod: "MONTHLY" },
  paymentMethod: { brand: "visa", last4: "4242" },
};

const read = async (body: unknown) => open(() => json(body)).client.getPortal();

describe("the trial block of the portal", () => {
  test("is read as the specification writes it: the charge, its period and the card", async () => {
    const portal = await read(trialPortal(BLOCK));

    expect(portal.trial).toEqual({
      endsAt: "2026-10-30T09:00:00Z",
      reminderAt: "2026-10-27T09:00:00Z",
      charge: { amount: 4900, currencyCode: "EUR", billingInterval: "month" },
      paymentMethod: { brand: "visa", last4: "4242" },
    });
  });

  test("keeps a quarter as months and a count", async () => {
    const portal = await read(
      trialPortal({
        ...BLOCK,
        charge: { amount: 12000, currency: "EUR", billingPeriod: "QUARTERLY" },
      }),
    );

    expect(portal.trial?.charge).toEqual({
      amount: 12000,
      currencyCode: "EUR",
      billingInterval: "month",
      intervalCount: 3,
    });
  });

  test("takes the other name the same release gives the charge, with the subscription's period", async () => {
    const { charge, ...rest } = BLOCK;
    const portal = await read(
      trialPortal({ ...rest, chargeAmount: { amount: charge!.amount, currency: "EUR" } }),
    );

    expect(portal.trial?.charge).toEqual({
      amount: 4900,
      currencyCode: "EUR",
      billingInterval: "month",
    });
  });

  test("has no charge and no card when the API says there are none", async () => {
    const portal = await read(trialPortal({ ...BLOCK, charge: null, paymentMethod: null }));

    expect(portal.trial).toMatchObject({ charge: null, paymentMethod: null });
  });

  test("is null outside a trial, and absent from a server that does not serve it", async () => {
    expect((await read(trialPortal(null))).trial).toBeNull();
    expect(await read(answer("portal"))).not.toHaveProperty("trial");
  });
});

describe("the redemptions the portal lists", () => {
  test("carry where the discount starts and how many invoices it covers, when the server says", async () => {
    const portal = await read({
      ...answer("portal"),
      vouchers: [
        {
          name: "Welcome 20%",
          voucherType: "PRICE",
          status: "ACTIVE",
          appliesFromInvoice: "next",
          applicationsCount: 0,
          applicationsMax: 3,
          effectiveStartsAt: "2026-10-01T00:00:00Z",
          effectiveExpiresAt: null,
        },
        {
          name: "Flag",
          voucherType: "FLAG_GRANT",
          status: "ACTIVE",
          appliesFromInvoice: null,
          applicationsCount: 0,
          applicationsMax: null,
          effectiveStartsAt: "2026-10-01T00:00:00Z",
          effectiveExpiresAt: "2027-01-01T00:00:00Z",
        },
      ],
    });

    expect(portal.vouchers).toEqual([
      {
        name: "Welcome 20%",
        voucherType: "PRICE",
        status: "ACTIVE",
        appliesFromInvoice: "next",
        applicationsCount: 0,
        applicationsMax: 3,
        effectiveStartsAt: "2026-10-01T00:00:00Z",
        effectiveExpiresAt: null,
      },
      {
        name: "Flag",
        voucherType: "FLAG_GRANT",
        status: "ACTIVE",
        appliesFromInvoice: null,
        applicationsCount: 0,
        applicationsMax: null,
        effectiveStartsAt: "2026-10-01T00:00:00Z",
        effectiveExpiresAt: "2027-01-01T00:00:00Z",
      },
    ]);
  });
});

describe("redeemVoucher", () => {
  const redemption = {
    name: "Welcome 20%",
    voucherType: "PRICE",
    status: "ACTIVE",
    appliesFromInvoice: "next",
    applicationsCount: 0,
    applicationsMax: 3,
    effectiveStartsAt: "2026-10-06T10:00:00Z",
    effectiveExpiresAt: null,
  };

  test("posts the code in the body and reads the redemption", async () => {
    const { client, requests } = open(() => json(redemption, 201));

    const result = await client.redeemVoucher({ code: "WELCOME20" });

    expect(await sent(requests)).toEqual([
      ["POST", "/public/session/vouchers/redeem", JSON.stringify({ code: "WELCOME20" })],
    ]);
    expect(result).toEqual(redemption);
  });

  test("asks what a code would give, and changes nothing, with dryRun", async () => {
    const { client, requests } = open(() => json(redemption));

    await client.redeemVoucher({ code: "WELCOME20", dryRun: true });

    expect(await sent(requests)).toEqual([
      [
        "POST",
        "/public/session/vouchers/redeem",
        JSON.stringify({ code: "WELCOME20", dryRun: true }),
      ],
    ]);
  });

  test("never puts the code in the address", async () => {
    const { client, requests } = open(() => json(redemption));

    await client.redeemVoucher({ code: "SECRET-CODE" });

    expect(requests[0]!.url).not.toContain("SECRET");
  });

  test("is not sent again after a failure: a write is never replayed", async () => {
    const { client, requests } = open(() => json({ title: "down", status: 503 }, 503));

    await expect(client.redeemVoucher({ code: "WELCOME20" })).rejects.toBeInstanceOf(KaitenError);

    expect(requests).toHaveLength(1);
  });

  test("refuses an empty code before any request", async () => {
    const { client, requests } = open(() => json(redemption));

    await expect(client.redeemVoucher({ code: "  " })).rejects.toThrow(TypeError);

    expect(requests).toHaveLength(0);
  });

  test.each([
    [409, "RedeemSessionVoucher.SubscriptionIncomplete"],
    [409, "RedeemSessionVoucher.NoLiveSubscription"],
    [422, "RedeemSessionVoucher.VoucherInvalid"],
    [422, "RedeemSessionVoucher.InstanceRequired"],
  ])("a %i %s refusal reaches the host with its code", async (status, code) => {
    const { client } = open(() => json({ title: "refused", status, code }, status));

    const error = await client.redeemVoucher({ code: "X" }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).status).toBe(status);
    expect((error as KaitenError).code).toBe(code);
  });

  test("a refusal for coming too often is a RateLimitedError with the wait", async () => {
    const { client } = open(() =>
      json(
        { title: "Too Many Requests", status: 429, code: "RedeemSessionVoucher.RateLimited" },
        429,
        { "Retry-After": "90" },
      ),
    );

    const error = await client.redeemVoucher({ code: "X" }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(90);
  });
});

describe("the double", () => {
  const refusedWith = async (call: Promise<unknown>) => {
    const error = await call.catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(KaitenError);
    return error as KaitenError;
  };

  test("redeems a code on a live subscription: the portal lists it, and the next invoice carries it", async () => {
    const session = createMockKaitenSessionClient();

    const redemption = await session.redeemVoucher({ code: "welcome-20" });

    expect(redemption).toMatchObject({
      name: "Welcome 20%",
      voucherType: "PRICE",
      appliesFromInvoice: "next",
      applicationsMax: 3,
    });
    expect((await session.getPortal()).vouchers.map((voucher) => voucher.name)).toEqual([
      "Welcome 20%",
    ]);
  });

  test("answers a dry run without changing the portal", async () => {
    const session = createMockKaitenSessionClient();

    await session.redeemVoucher({ code: "WELCOME20", dryRun: true });

    expect((await session.getPortal()).vouchers).toEqual([]);
    expect(session.calls.map((call) => call.method)).toEqual(["redeemVoucher", "getPortal"]);
  });

  test("applies a price code to the charge a trial ends with", async () => {
    const session = createMockKaitenSessionClient({ portal: demoTrialPortal() });

    await session.redeemVoucher({ code: "WELCOME20" });

    expect((await session.getPortal()).trial?.charge?.amount).toBe(6320);
  });

  test("refuses a code twice, with the one answer it gives for every reason", async () => {
    const session = createMockKaitenSessionClient();
    await session.redeemVoucher({ code: "WELCOME20" });

    const again = await refusedWith(session.redeemVoucher({ code: "WELCOME20" }));
    const unknown = await refusedWith(session.redeemVoucher({ code: "NOPE" }));

    expect(again).toMatchObject({ status: 422, code: "RedeemSessionVoucher.VoucherInvalid" });
    expect(unknown.message).toBe(again.message);
  });

  test("refuses a subscription that waits for its first payment, and one that is not live", async () => {
    const waiting = demoPortal();
    const incomplete = createMockKaitenSessionClient({
      portal: { ...waiting, subscription: { ...waiting.subscription!, status: "INCOMPLETE" } },
    });
    const none = createMockKaitenSessionClient({
      portal: { ...waiting, subscription: null },
    });

    expect(await refusedWith(incomplete.redeemVoucher({ code: "WELCOME20" }))).toMatchObject({
      status: 409,
      code: "RedeemSessionVoucher.SubscriptionIncomplete",
    });
    expect(await refusedWith(none.redeemVoucher({ code: "WELCOME20" }))).toMatchObject({
      status: 409,
      code: "RedeemSessionVoucher.NoLiveSubscription",
    });
  });

  test("has the trial portal the client builds from the API, member for member", async () => {
    const { client } = open(() => json(trialPortal(BLOCK)));
    const real = await client.getPortal();
    const demo = demoTrialPortal();

    expect(Object.keys(demo.trial ?? {}).sort()).toEqual(Object.keys(real.trial ?? {}).sort());
    expect(Object.keys(demo.trial?.charge ?? {}).sort()).toEqual(
      Object.keys(real.trial?.charge ?? {}).sort(),
    );
  });
});
