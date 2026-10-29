// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { KaitenError, RateLimitedError, type KaitenApi } from "../src/index.ts";
import {
  createMockKaitenSessionClient,
  demoPortal,
  demoTrialPortal,
} from "../src/testing/index.ts";
import { requestProblems, responseProblems } from "./support/contract-schema.ts";
import { answer, refused } from "./support/session-answers.ts";
import { json, open, sent, useSessionClock } from "./support/session-harness.ts";

// The trial block of the portal and the redemption of a code, both on the shapes of the contract.
useSessionClock();

/** The portal of the contract, in a trial, with the given trial block; none leaves the member out. */
function trialPortal(trial: KaitenApi.PortalTrial | null | undefined) {
  const { trial: _, ...portal } = answer("portal");
  return {
    ...portal,
    subscription: { ...portal.subscription!, status: "TRIAL" as const },
    ...(trial === undefined ? {} : { trial }),
  };
}

const BLOCK: KaitenApi.PortalTrial = {
  endsAt: "2026-10-30T09:00:00Z",
  reminderAt: "2026-10-27T09:00:00Z",
  charge: { amount: 4900, currency: "EUR", billingPeriod: "MONTHLY" },
  paymentMethod: { brand: "visa", last4: "4242" },
};

const read = async (body: unknown) => open(() => json(body)).client.getPortal();

describe("the trial block of the portal", () => {
  test("is read as the contract writes it: the charge, its period and the card", async () => {
    const portal = await read(trialPortal(BLOCK));

    expect(portal.trial).toEqual({
      endsAt: "2026-10-30T09:00:00Z",
      reminderAt: "2026-10-27T09:00:00Z",
      charge: { amount: 4900, currencyCode: "EUR", billingInterval: "month" },
      paymentMethod: { brand: "visa", last4: "4242" },
    });
  });

  test.each([
    ["QUARTERLY", "month", 3],
    ["SEMI_ANNUAL", "month", 6],
    ["ANNUAL", "year", undefined],
  ] as const)("keeps %s as its interval and a count", async (billingPeriod, interval, count) => {
    const portal = await read(
      trialPortal({ ...BLOCK, charge: { amount: 12000, currency: "EUR", billingPeriod } }),
    );

    expect(portal.trial?.charge).toEqual({
      amount: 12000,
      currencyCode: "EUR",
      billingInterval: interval,
      ...(count ? { intervalCount: count } : {}),
    });
  });

  test("takes the period of the charge, not the subscription's", async () => {
    const portal = await read(
      trialPortal({
        ...BLOCK,
        charge: { amount: 49000, currency: "EUR", billingPeriod: "ANNUAL" },
      }),
    );

    // The portal's own subscription is monthly.
    expect(portal.subscription?.billingInterval).toBe("month");
    expect(portal.trial?.charge?.billingInterval).toBe("year");
  });

  test("has no charge and no card when the API says there are none", async () => {
    const portal = await read(trialPortal({ ...BLOCK, charge: null, paymentMethod: null }));

    expect(portal.trial).toMatchObject({ charge: null, paymentMethod: null });
  });

  test("has no reminder when none is due, and a card the provider gave no labels for", async () => {
    const portal = await read(
      trialPortal({ ...BLOCK, reminderAt: null, paymentMethod: { brand: null, last4: null } }),
    );

    expect(portal.trial).toMatchObject({
      reminderAt: null,
      paymentMethod: { brand: null, last4: null },
    });
  });

  test("is null outside a trial, and absent from a server that predates it", async () => {
    expect((await read(trialPortal(null))).trial).toBeNull();
    expect(await read(trialPortal(undefined))).not.toHaveProperty("trial");
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
  const redemption = answer("redemption");

  test("posts the code in the body and reads the redemption", async () => {
    const { client, requests } = open(() => json(redemption, 201));

    const result = await client.redeemVoucher({ code: "WELCOME20" });

    expect(await sent(requests)).toEqual([
      ["POST", "/public/session/vouchers/redeem", JSON.stringify({ code: "WELCOME20" })],
    ]);
    expect(result).toEqual(redemption);
  });

  test("sends a body the contract allows, and reads an answer it allows", async () => {
    const { client, requests } = open(() => json(redemption, 201));

    await client.redeemVoucher({ code: "WELCOME20", dryRun: true });
    await client.redeemVoucher({ code: "WELCOME20" });

    for (const request of requests) {
      expect(
        requestProblems("POST", "/public/session/vouchers/redeem", await request.clone().json()),
      ).toEqual([]);
    }
    expect(responseProblems("POST", "/public/session/vouchers/redeem", 201, redemption)).toEqual(
      [],
    );
  });

  test("reads a redemption that gives no discount: a boost, with an end and no invoices", async () => {
    const boost = answer("redemptionBoost");
    const { client } = open(() => json(boost, 201));

    expect(await client.redeemVoucher({ code: "DOUBLE" })).toEqual(boost);
  });

  test("asks what a code would give, and changes nothing, with dryRun", async () => {
    const { client, requests } = open(() => json(redemption));

    const result = await client.redeemVoucher({ code: "WELCOME20", dryRun: true });

    expect(await sent(requests)).toEqual([
      [
        "POST",
        "/public/session/vouchers/redeem",
        JSON.stringify({ code: "WELCOME20", dryRun: true }),
      ],
    ]);
    // The route answers a dry run with 200 and a made redemption with 201: the same body.
    expect(result).toEqual(redemption);
  });

  test("does not send dryRun when it is false", async () => {
    const { client, requests } = open(() => json(redemption, 201));

    await client.redeemVoucher({ code: "WELCOME20", dryRun: false });

    expect(await sent(requests)).toEqual([
      ["POST", "/public/session/vouchers/redeem", JSON.stringify({ code: "WELCOME20" })],
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
    ["redeemSubscriptionIncomplete", 409, "RedeemSessionVoucher.SubscriptionIncomplete"],
    ["redeemNoLiveSubscription", 409, "RedeemSessionVoucher.NoLiveSubscription"],
    ["redeemVoucherInvalid", 422, "RedeemSessionVoucher.VoucherInvalid"],
    ["redeemInstanceRequired", 422, "RedeemSessionVoucher.InstanceRequired"],
  ] as const)(
    "the refusal %s reaches the host as a KaitenError with its code",
    async (key, status, code) => {
      const { client, requests } = open(() => refused(key));

      const error = await client.redeemVoucher({ code: "X" }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(KaitenError);
      expect(error).not.toBeInstanceOf(RateLimitedError);
      expect(error).toMatchObject({ status, code });
      expect(requests).toHaveLength(1);
    },
  );

  test("a refusal of the code says nothing of why, whatever the reason", async () => {
    const { client } = open(() => refused("redeemVoucherInvalid"));

    const error = await client.redeemVoucher({ code: "X" }).catch((thrown: unknown) => thrown);

    expect((error as KaitenError).detail).toBe("this code cannot be redeemed");
    expect((error as KaitenError).errors).toBeUndefined();
  });

  test("a refusal for coming too often is a RateLimitedError with the wait, shared with validate", async () => {
    const { client, requests } = open(() => refused("redeemRateLimited"));

    const error = await client.redeemVoucher({ code: "X" }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({
      status: 429,
      code: "RedeemSessionVoucher.RateLimited",
      retryAfterSeconds: 90,
    });
    // A write, and a rate limit: not sent again, however short the wait.
    expect(requests).toHaveLength(1);
  });

  test("a bare 429 from a gateway is a plain KaitenError that says so by its status", async () => {
    const { client } = open(() => json({ title: "Too Many Requests", status: 429 }, 429));

    const error = await client.redeemVoucher({ code: "X" }).catch((thrown: unknown) => thrown);

    expect(error).not.toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({ status: 429 });
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

  test("refuses a session bound to the customer alone, before it looks at any subscription", async () => {
    const session = createMockKaitenSessionClient({
      portal: { ...demoPortal(), instance: null, subscription: null },
    });

    expect(await refusedWith(session.redeemVoucher({ code: "WELCOME20" }))).toMatchObject({
      status: 422,
      code: "RedeemSessionVoucher.InstanceRequired",
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
