// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The stand-in for Kaiten, held to what it stands in for: the conformance suite's journey, which
// takes a customer from the catalogue to a revoked session and holds each answer to the API
// contract, runs against it; and so does every other answer these tests make it give. A stand-in
// that drifted from the contract would pass the storefront's end-to-end tests for a Kaiten that
// does not exist.

import { randomUUID } from "node:crypto";

import {
  KaitenAnonymousCheckoutClient,
  KaitenClient,
  KaitenError,
  KaitenSessionClient,
} from "@kaitencloud/client";
import {
  Billing,
  createKaitenClient,
  CustomerSessions,
  Customers,
  Instances,
} from "@kaitencloud/server";
import { describe, expect, test } from "vite-plus/test";

import type { Configuration } from "../../conformance/src/configuration.ts";
import { Journey } from "../../conformance/src/journey.ts";
import { contractProblemsOf, recordingFetch } from "../../conformance/src/recording.ts";
import { contractProblems as schemaProblems } from "../../../packages/client/tests/support/contract-schema.ts";
import { createKaitenDouble, DOUBLE_PATH, type Call } from "../server/double/kaiten-double.ts";

import acmeCatalog from "../../../packages/client/tests/fixtures/public-catalog.acme.json" with { type: "json" };

const ORIGIN = "https://storefront.test";
const API = `${ORIGIN}${DOUBLE_PATH}/api`;
const PUBLISHABLE_KEY = `pk_${"p".repeat(43)}`;
const SERVER_TOKEN = `ksh_${"s".repeat(43)}`;
const PRO_MONTHLY = "00000000-0000-4000-8000-000000000201";
const PRO_QUARTERLY = "00000000-0000-4000-8000-000000000202";
const PRO_ANNUAL = "00000000-0000-4000-8000-000000000204";
const GROWTH_MONTHLY = "00000000-0000-4000-8000-000000000301";
const LITE_MONTHLY = "00000000-0000-4000-8000-000000000401";
const STARTER_MONTHLY = "00000000-0000-4000-8000-000000000101";
const JAPAN_MONTHLY = "00000000-0000-4000-8000-000000000701";

/** The stand-in, selling from `catalog` when one is given, and the clients that call it. */
function world(catalog?: Record<string, any>) {
  const double = createKaitenDouble({
    serverToken: SERVER_TOKEN,
    publishableKey: PUBLISHABLE_KEY,
    catalog,
  });
  const recorder = recordingFetch(`${DOUBLE_PATH}/api`, async (input, init) => {
    const response = await double.route(new Request(input, init));
    if (!response) throw new Error("the stand-in has no such route");
    return response;
  });
  const server = createKaitenClient({ baseUrl: API, token: SERVER_TOKEN, fetch: recorder.fetch });

  /** A session for the demo customer, bound to its instance, or to the customer alone with `null`. */
  const mint = async (instanceSlug: string | null = "acme-instance") => {
    const { data } = await CustomerSessions.createCustomerSession({
      client: server,
      throwOnError: true,
      body: {
        customerSlug: "acme-customer",
        ...(instanceSlug === null ? {} : { instanceSlug }),
        ttlSeconds: 900,
      },
    });
    return data;
  };
  const customer = async (instanceSlug?: string | null) => {
    const session = await mint(instanceSlug);
    return new KaitenSessionClient({
      apiUrl: API,
      fetch: recorder.fetch,
      getCustomerSession: () => ({ token: session.token, expiresAt: session.expiresAt }),
    });
  };
  const call = (path: string, init?: RequestInit) =>
    double.route(new Request(`${ORIGIN}${DOUBLE_PATH}${path}`, init)) as Promise<Response>;

  return { double, recorder, server, mint, customer, call };
}

/** What the stand-in answered that the contract does not allow, over everything a test made it say. */
const contractProblems = (recorder: ReturnType<typeof recordingFetch>) =>
  contractProblemsOf(recorder.exchanges);

describe("the conformance journey, against the stand-in", () => {
  test("takes a customer from the catalogue to a revoked session, and every answer fits the contract", async () => {
    const { double } = world();
    const configuration: Configuration = {
      apiUrl: API,
      publishableKey: PUBLISHABLE_KEY,
      serverToken: SERVER_TOKEN,
      customerSlug: "acme-customer",
      instanceSlug: "acme-instance",
      returnUrl: `${ORIGIN}/checkout/pro-v2`,
      billingEmail: "billing@acme.test",
      setup: { kind: "stripe", secretKey: "sk_test_stand_in", apiUrl: "https://stripe.test" },
    };
    const journey = new Journey(configuration, {
      fetch: async (input, init) => (await double.route(new Request(input, init)))!,
      // The customer saves a card on the provider's page, which sends them back.
      completeSetup: async ({ setupUrl }) => {
        const saved = await double.route(new Request(`${setupUrl}/save`, { method: "POST" }));
        expect(saved?.status).toBe(303);
      },
    });

    await journey.catalogue();
    await journey.session();
    await journey.dryRun();
    await journey.setup();
    await journey.checkout();
    await journey.invoices();
    await journey.cancel();
    await journey.reactivate();
    await journey.revoke();
  });
});

describe("what the stand-in does besides", () => {
  test("holds every answer it gives to the contract, the refusals too", async () => {
    const { double, recorder, customer } = world();
    const session = await customer();

    // A customer with no email: as in Kaiten, a preview is priced without one, and the checkout
    // itself is refused for want of it.
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, dryRun: true }),
    ).resolves.toMatchObject({ status: "preview" });
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, returnUrl: `${ORIGIN}/checkout/pro-v2` }),
    ).rejects.toMatchObject({
      status: 422,
      code: "CreateSessionCheckout.BillingEmailRequired",
    });
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, billingEmail: "nope", dryRun: true }),
    ).rejects.toMatchObject({ status: 422, code: "CreateSessionCheckout.InvalidBillingEmail" });
    await session.checkout({
      licensePriceId: PRO_MONTHLY,
      billingEmail: "billing@acme.test",
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      voucherCode: "welcome-20",
      dryRun: true,
    });
    await expect(
      session.checkout({ licensePriceId: "00000000-0000-4000-8000-0000000000ff", dryRun: true }),
    ).rejects.toMatchObject({ code: "CreateSessionCheckout.PriceNotPublic" });
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, voucherCode: "NOPE", dryRun: true }),
    ).rejects.toMatchObject({ code: "CreateSessionCheckout.VoucherInvalid" });
    await expect(session.validateVoucher({ code: "welcome-20" })).resolves.toMatchObject({
      valid: true,
    });
    await expect(session.validateVoucher({ code: "nope" })).resolves.toEqual({ valid: false });
    await expect(session.cancelSubscription()).rejects.toMatchObject({
      code: "CancelSessionSubscription.NotActive",
    });

    double.reset({ card: true, email: true });
    const subscribed = await (await customer()).checkout({ licensePriceId: PRO_MONTHLY });
    expect(subscribed).toMatchObject({ status: "subscribed", payment: { status: "paid" } });

    // A plan with a trial subscribes with nothing due and no invoice.
    double.reset({ card: true, email: true });
    const trial = await (await customer()).checkout({ licensePriceId: GROWTH_MONTHLY });
    expect(trial).toMatchObject({
      status: "subscribed",
      subscription: { status: "TRIAL" },
      activationInvoice: null,
      payment: { status: "not_required" },
    });

    expect(contractProblems(recorder)).toEqual([]);
  });

  test("prices a checkout itself: the plan, the add-ons and the voucher, with a trial when the plan has one", async () => {
    const { customer } = world();
    const session = await customer();
    const email = { billingEmail: "billing@acme.test", dryRun: true as const };

    const plain = await session.checkout({ licensePriceId: PRO_MONTHLY, ...email });
    expect(plain).toMatchObject({
      status: "preview",
      dueToday: { currencyCode: "EUR", total: 4900 },
    });

    const full = await session.checkout({
      licensePriceId: PRO_MONTHLY,
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      voucherCode: "WELCOME20",
      ...email,
    });
    // 4,900 and two seats at 1,000, less 20% of the base fee: the server's sums, line by line.
    expect(full).toMatchObject({ dueToday: { subtotal: 6900, discountTotal: 980, total: 5920 } });
    if (full.status !== "preview") throw new Error("a preview was expected");
    expect(full.dueToday.lines.map((line) => line.type)).toEqual(["BASE", "ADDON", "DISCOUNT"]);

    const trial = await session.checkout({ licensePriceId: GROWTH_MONTHLY, ...email });
    expect(trial).toMatchObject({ dueToday: { total: 0, lines: [] } });
    if (trial.status !== "preview") throw new Error("a preview was expected");
    expect(trial.trialEndsAt).not.toBeNull();
    const skipped = await session.checkout({
      licensePriceId: GROWTH_MONTHLY,
      trial: false,
      ...email,
    });
    expect(skipped).toMatchObject({ dueToday: { total: 9900 } });
  });

  test("refuses what Kaiten refuses: a return page of another origin, a second subscription, an add-on that does not fit", async () => {
    const { double, customer } = world();
    double.reset({ card: true, email: true });
    const session = await customer();

    await expect(
      session.checkout({
        licensePriceId: GROWTH_MONTHLY,
        addOns: [{ addonSlug: "gpu-pack", quantity: 1 }],
        dryRun: true,
      }),
    ).rejects.toMatchObject({ code: "CreateSessionCheckout.AddonNotPublic" });
    await expect(
      session.checkout({
        licensePriceId: PRO_MONTHLY,
        addOns: [{ addonSlug: "extra-seats-v1", quantity: 51 }],
        dryRun: true,
      }),
    ).rejects.toMatchObject({ code: "CreateSessionCheckout.QuantityExceedsMax" });

    await session.checkout({ licensePriceId: PRO_MONTHLY });
    await expect(session.checkout({ licensePriceId: PRO_MONTHLY })).rejects.toMatchObject({
      status: 409,
      code: "CreateSessionCheckout.AlreadySubscribed",
    });
    // A preview is refused the same way once the instance is subscribed.
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, dryRun: true }),
    ).rejects.toMatchObject({ status: 409, code: "CreateSessionCheckout.AlreadySubscribed" });

    // A session bound to the customer alone reads the customer, and buys nothing.
    const wide = await customer(null);
    expect(await wide.getPortal()).toMatchObject({
      instance: null,
      subscription: null,
      capabilities: { checkout: false, unsubscribe: false },
    });
    await expect(wide.checkout({ licensePriceId: PRO_MONTHLY })).rejects.toMatchObject({
      code: "CreateSessionCheckout.InstanceRequired",
    });
  });

  test("refuses a checkout's add-on as Kaiten does: one that does not fit, another currency, no fee for the period", async () => {
    const { double, customer, recorder } = world();
    double.reset({ card: true, email: true });
    const session = await customer();

    // The GPU pack is public, and does not fit Growth.
    await expect(
      session.checkout({
        licensePriceId: GROWTH_MONTHLY,
        addOns: [{ addonSlug: "gpu-pack-v1", quantity: 1 }],
        dryRun: true,
      }),
    ).rejects.toMatchObject({ status: 422, code: "CreateSessionCheckout.AddonNotPublic" });
    // It fits Pro, and is priced in dollars beside Pro in euros.
    await expect(
      session.checkout({
        licensePriceId: PRO_MONTHLY,
        addOns: [{ addonSlug: "gpu-pack-v1", quantity: 1 }],
        dryRun: true,
      }),
    ).rejects.toMatchObject({ status: 422, code: "CreateSessionCheckout.CurrencyMismatch" });
    // The seats are sold by the month and by the year, not every quarter: the attachment's own
    // refusal is inside.
    await expect(
      session.checkout({
        licensePriceId: PRO_QUARTERLY,
        addOns: [{ addonSlug: "extra-seats-v1", quantity: 1 }],
        dryRun: true,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "CreateSessionCheckout.AddonInvalid",
      errors: [
        {
          location: "body.addOns[0]",
          value: { code: "AttachInstanceAddon.NoPriceForBillingPeriod" },
        },
      ],
    });
    // By the year, they are sold, at the fee of the year.
    await expect(
      session.checkout({
        licensePriceId: PRO_ANNUAL,
        addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
        dryRun: true,
      }),
    ).resolves.toMatchObject({
      status: "preview",
      dueToday: { lines: expect.arrayContaining([expect.objectContaining({ amount: 20000 })]) },
    });
    expect(double.state().subscribed).toBe(false);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("makes the customer save a card first, on a page it serves, and bills only once they are back", async () => {
    const { double, customer, call } = world();
    const session = await customer();
    const returnUrl = `${ORIGIN}/checkout/pro-v2`;

    const sent = await session.checkout({
      licensePriceId: PRO_MONTHLY,
      billingEmail: "billing@acme.test",
      returnUrl,
    });
    if (sent.status !== "requires_payment_method") throw new Error("a setup page was expected");
    expect(sent.setupUrl).toBe(`${ORIGIN}${DOUBLE_PATH}/provider/setup/${sent.setupSessionId}`);

    // Back without having saved anything: the checkout says so, and nothing was subscribed.
    const back = {
      licensePriceId: PRO_MONTHLY,
      billingEmail: "billing@acme.test",
      setupSessionId: sent.setupSessionId,
    };
    await expect(session.checkout(back)).rejects.toMatchObject({
      status: 409,
      code: "CreateSessionCheckout.SetupSessionIncomplete",
    });
    expect(double.state()).toMatchObject({ subscribed: false, cardOnFile: false });

    const page = await call(`/provider/setup/${sent.setupSessionId}`);
    expect(await page.text()).toContain("Save card");
    const saved = await call(`/provider/setup/${sent.setupSessionId}/save`, { method: "POST" });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(
      `${returnUrl}?kaiten_setup_session=${sent.setupSessionId}`,
    );

    const done = await session.checkout(back);
    expect(done).toMatchObject({ status: "subscribed" });
    expect(double.state()).toMatchObject({
      subscribed: true,
      cardOnFile: true,
      billingEmail: "billing@acme.test",
    });
  });

  test("lets a test say what became of the payment, and settles the invoice when the customer pays it", async () => {
    const { double, customer, call, recorder } = world();

    const outcomes = [
      ["failed", "PAYMENT_FAILED"],
      ["requires_action", "PAYMENT_FAILED"],
      ["processing", "PUSHED"],
      ["paid", "PAID"],
    ] as const;
    for (const [outcome, invoiceStatus] of outcomes) {
      double.reset({ card: true, email: true });
      double.payment(outcome);
      const result = await (await customer()).checkout({ licensePriceId: PRO_MONTHLY });
      if (result.status !== "subscribed") throw new Error("a subscription was expected");
      expect(result.payment.status).toBe(outcome);
      expect(result.activationInvoice?.status).toBe(invoiceStatus);
      expect(result.payment.hostedInvoiceUrl).toBe(
        `${ORIGIN}${DOUBLE_PATH}/provider/invoice/${result.activationInvoice?.id}`,
      );
    }

    // The last of them was paid. Pay another: through the provider's page, and through the control.
    for (const how of ["page", "control"] as const) {
      double.reset({ card: true, email: true });
      double.payment("requires_action");
      const session = await customer();
      const result = await session.checkout({ licensePriceId: PRO_MONTHLY });
      if (result.status !== "subscribed") throw new Error("a subscription was expected");
      const id = result.activationInvoice!.id;
      expect((await session.listInvoices()).items[0]?.status).toBe("PAYMENT_FAILED");

      if (how === "page") {
        const page = await (await call(`/provider/invoice/${id}`)).text();
        expect(page).toContain("Confirm payment");
        // The status as a person reads it, and the notice every page of the stand-in carries.
        expect(page).toContain("<strong>Payment failed</strong>");
        expect(page).toContain("no payment is real");
        expect((await call(`/provider/invoice/${id}/pay`, { method: "POST" })).status).toBe(303);
        expect(await (await call(`/provider/invoice/${id}`)).text()).toContain("Paid.");
      } else {
        expect(double.payInvoice(id)).toBe(true);
      }
      expect((await session.listInvoices()).items[0]).toMatchObject({ status: "PAID" });
    }
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("an unpaid checkout keeps the previous licence and selection unapplied until its activation is paid", async () => {
    const { double, customer, recorder } = world();
    double.reset({ card: true, email: true });
    double.payment("requires_action");
    const session = await customer();
    const result = await session.checkout({
      licensePriceId: PRO_MONTHLY,
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      voucherCode: "WELCOME20",
    });
    if (result.status !== "subscribed") throw new Error("expected a subscription");
    expect(result.subscription.status).toBe("INCOMPLETE");
    expect(await session.getPortal()).toMatchObject({
      instance: { licenseName: "Starter" },
      subscription: { status: "INCOMPLETE" },
      addOns: [],
      vouchers: [],
    });
    await expect(session.setAddonQuantity("extra-seats-v1", 1)).rejects.toMatchObject({
      code: "SetSessionAddonQuantity.SubscriptionIncomplete",
    });
    expect(double.advance(ORIGIN)).toMatchObject({ ok: false, code: "subscription_incomplete" });
    expect(double.payInvoice(result.activationInvoice!.id)).toBe(true);
    expect(await session.getPortal()).toMatchObject({
      instance: { licenseName: "Pro" },
      subscription: { status: "ACTIVE" },
      addOns: [{ quantity: 2, pendingQuantity: null }],
      vouchers: [{ applicationsCount: 1 }],
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("a pending paid replacement leaves a free subscription unchanged, and cancelling it drops only the selection", async () => {
    const { double, customer, recorder } = world();
    double.reset({ card: true, email: true });
    const session = await customer();
    await session.checkout({ licensePriceId: STARTER_MONTHLY });
    await session.cancelSubscription();
    const before = (await session.getPortal()).subscription;
    double.payment("processing");
    const result = await session.checkout({ licensePriceId: PRO_MONTHLY });
    if (result.status !== "subscribed") throw new Error("expected a subscription");
    expect((await session.getPortal()).subscription).toEqual({
      ...before,
      incompleteExpiresAt: result.subscription.incompleteExpiresAt,
    });
    expect((await session.getPortal()).instance?.licenseName).toBe("Starter");
    await session.cancelSubscription();
    expect((await session.getPortal()).subscription).toEqual(before);
    expect((await session.listInvoices()).items[0]?.status).toBe("VOID");
    expect(double.payInvoice(result.activationInvoice!.id)).toBe(false);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("a scheduled decrease can be replaced or cleared and the boundary bills its new quantity", async () => {
    const { double, customer, recorder } = world();
    double.reset({ subscribed: true });
    const session = await customer();
    await session.setAddonQuantity("extra-seats-v1", 5);
    expect(await session.setAddonQuantity("extra-seats-v1", 2)).toMatchObject({
      quantity: 5,
      pendingQuantity: 2,
    });
    expect(await session.setAddonQuantity("extra-seats-v1", 3)).toMatchObject({
      quantity: 5,
      pendingQuantity: 3,
    });
    expect(await session.setAddonQuantity("extra-seats-v1", 5)).toMatchObject({
      quantity: 5,
      pendingQuantity: null,
    });
    await session.setAddonQuantity("extra-seats-v1", 1);
    expect(double.advance(ORIGIN)).toMatchObject({ ok: true });
    expect((await session.getPortal()).addOns[0]).toMatchObject({
      quantity: 1,
      pendingQuantity: null,
    });
    expect((await session.listInvoices()).items[0]?.lines).toMatchObject([
      { type: "BASE" },
      { type: "ADDON", quantity: "1", amount: 1000 },
    ]);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("cancels and reactivates, and says what the portal is after each", async () => {
    const { double, customer, recorder } = world();
    double.reset({ subscribed: true });
    const session = await customer();

    expect(await session.getPortal()).toMatchObject({
      instance: { licenseName: "Pro" },
      capabilities: { unsubscribe: true, checkout: false },
      subscription: { cancelAtPeriodEnd: false },
    });
    expect(await session.cancelSubscription()).toMatchObject({ cancelAtPeriodEnd: true });
    expect(await session.getPortal()).toMatchObject({
      capabilities: { unsubscribe: false },
      subscription: { cancelAtPeriodEnd: true },
    });
    await expect(session.cancelSubscription()).rejects.toMatchObject({ status: 409 });
    expect(await session.reactivateSubscription()).toMatchObject({ cancelAtPeriodEnd: false });
    await expect(session.reactivateSubscription()).rejects.toMatchObject({ status: 409 });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("answers a session it does not know, one that was revoked and one that ended, with a 401", async () => {
    const { double, mint, server, recorder } = world();
    const created = await mint();
    const read = (token: string) =>
      new KaitenSessionClient({
        apiUrl: API,
        fetch: recorder.fetch,
        getCustomerSession: () => ({
          token,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
      }).getPortal();

    await expect(read(created.token)).resolves.toBeDefined();
    await expect(read(`kst_${"u".repeat(43)}`)).rejects.toMatchObject({ status: 401 });

    await CustomerSessions.revokeCustomerSession({
      client: server,
      throwOnError: true,
      path: { sessionId: created.id },
    });
    await expect(read(created.token)).rejects.toMatchObject({ status: 401 });
    expect(double.state()).toMatchObject({ minted: 1, revoked: 1 });

    // A token that is not the vendor's mints nothing, and a key that is not the page's reads no catalogue.
    const stranger = createKaitenClient({
      baseUrl: API,
      token: `ksh_${"x".repeat(43)}`,
      fetch: recorder.fetch,
    });
    await expect(
      CustomerSessions.createCustomerSession({
        client: stranger,
        throwOnError: true,
        body: { customerSlug: "acme-customer" },
      }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      new KaitenClient({
        apiUrl: API,
        authScheme: "publishable",
        tokenProvider: () => `pk_${"q".repeat(43)}`,
        fetch: recorder.fetch,
      }).getCatalog(),
    ).rejects.toBeInstanceOf(KaitenError);
  });

  test("gives a scripted answer in place of its own, once each, and only to the call that fits", async () => {
    const { double, customer, recorder } = world();
    double.reset({ card: true, email: true });
    const session = await customer();

    double.script("POST /public/session/checkout", {
      status: 429,
      retryAfter: 30,
      body: {
        type: "about:blank",
        title: "Too Many Requests",
        status: 429,
        detail: "slow",
        code: "PublicAuth.RateLimited",
      },
      dryRun: false,
    });
    // A preview is not the checkout the answer was kept for.
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, dryRun: true }),
    ).resolves.toMatchObject({ status: "preview" });
    await expect(session.checkout({ licensePriceId: PRO_MONTHLY })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
    });
    // And once: the next one is the stand-in's own.
    await expect(session.checkout({ licensePriceId: PRO_MONTHLY })).resolves.toMatchObject({
      status: "subscribed",
    });

    expect(
      contractProblemsOf(recorder.exchanges.filter((exchange) => exchange.status !== 429)),
    ).toEqual([]);
  });

  test("keeps what it was asked, with the kind of credential and never the credential", async () => {
    const { double, customer } = world();
    double.reset({ card: true, email: true });
    const session = await customer();
    await session.checkout({
      licensePriceId: PRO_MONTHLY,
      voucherCode: "WELCOME20",
      dryRun: true,
    });
    await new KaitenClient({
      apiUrl: API,
      authScheme: "publishable",
      tokenProvider: () => PUBLISHABLE_KEY,
      fetch: async (input, init) => (await double.route(new Request(input, init)))!,
    }).getCatalog();

    const calls: Call[] = double.calls();
    expect(calls.map(({ method, path, credential }) => `${method} ${path} ${credential}`)).toEqual([
      "POST /customer-sessions ksh_",
      "POST /public/session/checkout kst_",
      "GET /public/catalog pk_",
    ]);
    // A voucher code is the customer's, and a log has no use for it.
    expect(calls[1]?.body).toMatchObject({ voucherCode: "…" });
    expect(JSON.stringify(calls)).not.toContain("WELCOME20");
    expect(JSON.stringify(calls)).not.toContain(SERVER_TOKEN);
  });

  test("is controlled over HTTP, as a test in a browser does", async () => {
    const { double, customer, call } = world();
    const post = (path: string, data: unknown) =>
      call(`/control${path}`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "content-type": "application/json" },
      });

    expect((await post("/reset", { card: true, email: true })).status).toBe(200);
    expect((await post("/payment", { outcome: "failed" })).status).toBe(200);
    const session = await customer();
    const result = await session.checkout({ licensePriceId: PRO_MONTHLY });
    if (result.status !== "subscribed") throw new Error("a subscription was expected");
    expect(result.payment.status).toBe("failed");

    expect((await call("/control/state")).status).toBe(200);
    expect(
      ((await (await call("/control/state")).json()) as { subscribed: boolean }).subscribed,
    ).toBe(true);
    expect((await post(`/invoices/${result.activationInvoice!.id}/pay`, {})).status).toBe(200);
    expect((await post(`/invoices/${result.activationInvoice!.id}/decline`, {})).status).toBe(200);
    expect((await post("/invoices/none/pay", {})).status).toBe(404);
    expect((await customer().then((each) => each.listInvoices())).items[0]?.status).toBe(
      "PAYMENT_FAILED",
    );

    await post("/script", {
      key: "GET /public/session/portal",
      replies: [{ status: 403, body: {} }],
    });
    await expect((await customer()).getPortal()).rejects.toMatchObject({ status: 403 });
    expect(((await (await call("/control/calls")).json()) as Call[]).length).toBeGreaterThan(3);
    expect(double.state().invoices).toHaveLength(1);

    // A page of another origin does not control it.
    expect(
      (
        await call("/control/reset", {
          method: "POST",
          headers: { Origin: "https://elsewhere.test" },
        })
      ).status,
    ).toBe(403);

    // What is not the stand-in's is not answered: the storefront's own routes and its pages are another's.
    expect(
      await double.route(new Request(`${ORIGIN}/storefront-api/session`, { method: "POST" })),
    ).toBeUndefined();
    expect(await double.route(new Request(`${ORIGIN}/portal`))).toBeUndefined();
  });
});

describe("the catalogue's links", () => {
  test("sends every plan that is not free to the storefront's own sales page, on the origin that asks", async () => {
    const { double, recorder } = world();
    const read = async (origin: string) => {
      const response = await double.route(
        new Request(`${origin}${DOUBLE_PATH}/api/public/catalog`, {
          headers: { "x-kaiten-publishable-key": PUBLISHABLE_KEY },
        }),
      );
      return (await response!.json()) as {
        plans: Array<{ licenseSlug: string; pricingType: string; selfServeCtaUrl: string | null }>;
      };
    };

    const { plans } = await read("https://storefront.test");
    for (const plan of plans) {
      expect(plan.selfServeCtaUrl).toBe(
        plan.pricingType === "FREE"
          ? null
          : `https://storefront.test/sales?plan=${plan.licenseSlug}`,
      );
    }
    expect(plans.find((plan) => plan.licenseSlug === "pro-v2")?.selfServeCtaUrl).toBe(
      "https://storefront.test/sales?plan=pro-v2",
    );
    expect((await read("http://localhost:5180")).plans[1]?.selfServeCtaUrl).toMatch(
      /^http:\/\/localhost:5180\/sales\?plan=/,
    );
    expect(contractProblems(recorder)).toEqual([]);
  });
});

describe("checkout from a free plan", () => {
  test("a free subscription is replaced: cancelled at once with no invoice, then subscribed", async () => {
    const { double, customer, recorder } = world();
    double.reset({ free: true, card: true });
    const session = await customer();

    expect(double.state()).toMatchObject({
      subscribed: true,
      plan: "starter-v1",
      status: "ACTIVE",
      free: true,
      invoices: [],
    });
    // The portal lets the customer check out, and a preview is priced rather than refused.
    expect(await session.getPortal()).toMatchObject({
      instance: { licenseName: "Starter" },
      subscription: { status: "ACTIVE", basePrice: { amount: 0 } },
      capabilities: { checkout: true },
    });
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, dryRun: true }),
    ).resolves.toMatchObject({ status: "preview", dueToday: { total: 4900 } });

    const bought = await session.checkout({ licensePriceId: PRO_MONTHLY });
    expect(bought).toMatchObject({
      status: "subscribed",
      subscription: { status: "ACTIVE", basePrice: { amount: 4900 } },
      payment: { status: "paid" },
    });
    // The only invoice is the new subscription's: the free one billed nothing and ended with none.
    expect(double.state()).toMatchObject({
      plan: "pro-v2",
      planName: "Pro",
      free: false,
      invoices: [{ kind: "ACTIVATION", status: "PAID", total: 4900 }],
    });
    expect(double.events().map((event) => event.type)).toEqual([
      "instance.billing.canceled",
      "instance.billing.started",
      "instance.invoice.issued",
      "instance.invoice.paid",
    ]);
    expect(double.events()[0]?.detail).toContain("IMMEDIATE, no final invoice");

    // Now that it is a paid one, a second checkout is the 409 it always was.
    await expect(session.checkout({ licensePriceId: GROWTH_MONTHLY })).rejects.toMatchObject({
      status: 409,
      code: "CreateSessionCheckout.AlreadySubscribed",
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("a free subscription stays until the card is saved: nothing is replaced by a checkout that is not done", async () => {
    const { double, customer, call } = world();
    double.reset({ free: true });
    const session = await customer();

    const sent = await session.checkout({
      licensePriceId: PRO_MONTHLY,
      returnUrl: `${ORIGIN}/checkout/pro-v2`,
    });
    if (sent.status !== "requires_payment_method") throw new Error("a setup page was expected");
    expect(double.state()).toMatchObject({ plan: "starter-v1", free: true, invoices: [] });
    expect(double.events()).toEqual([]);

    await call(`/provider/setup/${sent.setupSessionId}/save`, { method: "POST" });
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, setupSessionId: sent.setupSessionId }),
    ).resolves.toMatchObject({ status: "subscribed" });
    expect(double.state()).toMatchObject({ plan: "pro-v2", status: "ACTIVE", cardOnFile: true });
  });

  test("a subscription that bills is never replaced, nor is a trial of a paid plan", async () => {
    const { double, customer } = world();

    double.reset({ subscribed: true });
    await expect(
      (await customer()).checkout({ licensePriceId: GROWTH_MONTHLY, dryRun: true }),
    ).rejects.toMatchObject({ status: 409, code: "CreateSessionCheckout.AlreadySubscribed" });
    expect(double.state()).toMatchObject({ plan: "pro-v2", free: false });

    // Lite is paid even though its trial bills nothing today and asks for no card.
    double.reset({ email: true });
    const lite = await customer();
    await lite.checkout({ licensePriceId: LITE_MONTHLY });
    expect(double.state()).toMatchObject({ plan: "lite-v1", status: "TRIAL", free: false });
    await expect(lite.checkout({ licensePriceId: PRO_MONTHLY })).rejects.toMatchObject({
      status: 409,
    });
    expect(await lite.getPortal()).toMatchObject({ capabilities: { checkout: false } });
  });

  test("a customer buys Starter first and Pro from there, with a card saved in between", async () => {
    const { double, customer, call, recorder } = world();
    double.reset({ email: true });
    const session = await customer();

    // Starter costs nothing and asks for no card.
    await expect(session.checkout({ licensePriceId: STARTER_MONTHLY })).resolves.toMatchObject({
      status: "subscribed",
      payment: { status: "not_required" },
    });
    expect(double.state()).toMatchObject({ plan: "starter-v1", free: true, cardOnFile: false });

    const sent = await session.checkout({
      licensePriceId: PRO_MONTHLY,
      returnUrl: `${ORIGIN}/checkout/pro-v2`,
    });
    if (sent.status !== "requires_payment_method") throw new Error("a setup page was expected");
    await call(`/provider/setup/${sent.setupSessionId}/save`, { method: "POST" });
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, setupSessionId: sent.setupSessionId }),
    ).resolves.toMatchObject({ status: "subscribed", payment: { status: "paid" } });
    expect(double.state()).toMatchObject({ plan: "pro-v2", free: false });
    expect(contractProblems(recorder)).toEqual([]);
  });
});

describe("the portal's entitlements", () => {
  test("follow the plan the customer is on: its limits, never a full meter, and nothing it does not list", async () => {
    const { double, customer, call, recorder } = world();
    double.reset({ email: true });
    const session = await customer();

    // Starter lists one seat in the catalogue: one seat, none used, and no other feature.
    await session.checkout({ licensePriceId: STARTER_MONTHLY });
    const starter = (await session.getPortal()).entitlements;
    expect(starter.map((each) => each.slug)).toEqual(["seats"]);
    expect(starter[0]).toMatchObject({
      limitValue: { value: 1 },
      currentValue: { value: 0 },
      percentageUsed: 0,
    });

    // Pro lists its API calls, its seats and single sign-on, at the catalogue's numbers.
    const sent = await session.checkout({
      licensePriceId: PRO_MONTHLY,
      returnUrl: `${ORIGIN}/checkout/pro-v2`,
    });
    if (sent.status !== "requires_payment_method") throw new Error("a setup page was expected");
    await call(`/provider/setup/${sent.setupSessionId}/save`, { method: "POST" });
    await session.checkout({ licensePriceId: PRO_MONTHLY, setupSessionId: sent.setupSessionId });
    const pro = (await session.getPortal()).entitlements;
    expect(pro.map((each) => each.slug).sort()).toEqual(["api-calls", "seats", "sso"]);
    expect(pro.find((each) => each.slug === "api-calls")).toMatchObject({
      limitValue: { value: 100000 },
      currentValue: { value: 15000 },
      maximumAllowedUsage: 120000,
    });
    const seats = pro.find((each) => each.slug === "seats");
    expect(seats).toMatchObject({ limitValue: { value: 5 }, currentValue: { value: 2 } });
    expect(pro.every((each) => (each.percentageUsed ?? 0) < 100)).toBe(true);
    expect(contractProblems(recorder)).toEqual([]);
  });
});

describe("the next boundary", () => {
  const advance = async (double: ReturnType<typeof world>["double"]) => {
    const result = double.advance(ORIGIN);
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    return result;
  };

  test("a trial ends into an ACTIVATION invoice, paid or not", async () => {
    const { double, customer, recorder } = world();
    double.reset({ card: true, email: true });
    const session = await customer();
    await session.checkout({ licensePriceId: GROWTH_MONTHLY });
    expect(double.state()).toMatchObject({ status: "TRIAL", invoices: [] });
    const trialEndsAt = double.state().trialEndsAt!;
    // The trial's period is the trial: the portal says it ends when the trial does.
    expect((await session.getPortal()).subscription).toMatchObject({
      status: "TRIAL",
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
    });
    // And it carries the trial block, with the figure the conversion's invoice will total.
    expect((await session.getPortal()).trial).toMatchObject({
      endsAt: trialEndsAt,
      charge: { amount: 9900, currencyCode: "EUR", billingInterval: "month" },
      paymentMethod: { brand: "visa", last4: "4242" },
    });

    const ended = double.endTrial(ORIGIN);
    expect(ended).toMatchObject({ ok: true, applied: "trial_converted" });
    expect(double.state()).toMatchObject({
      status: "ACTIVE",
      trialEndsAt: null,
      invoices: [{ kind: "ACTIVATION", status: "PAID", total: 9900 }],
    });
    // The period starts where the trial ended.
    expect(await session.getPortal()).toMatchObject({
      subscription: { status: "ACTIVE", currentPeriodStart: trialEndsAt },
    });
    expect((await session.listInvoices()).items[0]).toMatchObject({
      kind: "ACTIVATION",
      total: 9900,
      lines: [{ type: "BASE", label: "Growth", amount: 9900 }],
    });
    expect(double.events().map((event) => event.type)).toEqual([
      "instance.billing.started",
      "instance.billing.status_changed",
      "instance.invoice.issued",
      "instance.invoice.paid",
    ]);

    // The trial is over: it cannot end again.
    expect(double.endTrial(ORIGIN)).toMatchObject({ ok: false, code: "not_in_trial" });

    // A conversion whose payment fails leaves the subscription PAST_DUE.
    double.reset({ card: true, email: true });
    double.payment("failed");
    await (await customer()).checkout({ licensePriceId: GROWTH_MONTHLY });
    await advance(double);
    expect(double.state()).toMatchObject({
      status: "PAST_DUE",
      invoices: [{ kind: "ACTIVATION", status: "PAYMENT_FAILED" }],
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("a trial that ends with no card is not played yet, and says why", async () => {
    const { double, customer } = world();
    double.reset({ email: true });
    await (await customer()).checkout({ licensePriceId: LITE_MONTHLY });

    const refused = double.endTrial(ORIGIN);
    expect(refused).toMatchObject({ ok: false, code: "trial_without_payment_method" });
    expect(refused.ok === false && refused.detail).toContain("v3.1");
    expect(double.state()).toMatchObject({ status: "TRIAL", invoices: [] });
    expect(double.advance(ORIGIN)).toMatchObject({
      ok: false,
      code: "trial_without_payment_method",
    });

    // With nothing to move, there is nothing to say yes to.
    double.reset();
    expect(double.advance(ORIGIN)).toMatchObject({ ok: false, code: "no_subscription" });
    expect(double.endTrial(ORIGIN)).toMatchObject({ ok: false, code: "no_subscription" });
  });

  test("a period renews with a RENEWAL invoice, and a payment that fails leaves it PAST_DUE until it is paid", async () => {
    const { double, customer, call, recorder } = world();
    double.reset({ subscribed: true });
    const session = await customer();
    const before = (await session.getPortal()).subscription!.currentPeriodEnd;

    const renewed = await advance(double);
    expect(renewed).toMatchObject({ applied: "renewed" });
    const after = await session.getPortal();
    expect(after.subscription).toMatchObject({ status: "ACTIVE", currentPeriodStart: before });
    expect(new Date(after.subscription!.currentPeriodEnd).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );
    expect((await session.listInvoices()).items[0]).toMatchObject({
      kind: "RENEWAL",
      status: "PAID",
      total: 4900,
    });

    double.payment("failed");
    const failed = await advance(double);
    expect(double.state()).toMatchObject({ status: "PAST_DUE" });
    expect(await session.getPortal()).toMatchObject({
      subscription: { status: "PAST_DUE" },
      capabilities: { unsubscribe: true },
    });
    const open = (await session.listInvoices()).items.find(
      (invoice) => invoice.id === failed.invoiceId,
    );
    expect(open).toMatchObject({ kind: "RENEWAL", status: "PAYMENT_FAILED" });
    expect(open?.hostedInvoiceUrl).toBe(
      `${ORIGIN}${DOUBLE_PATH}/provider/invoice/${failed.invoiceId}`,
    );

    // The customer pays it on the provider's page.
    expect(
      (await call(`/provider/invoice/${failed.invoiceId}/pay`, { method: "POST" })).status,
    ).toBe(303);
    expect(double.state()).toMatchObject({ status: "ACTIVE" });
    expect(double.events().map((event) => event.type)).toContain("instance.billing.status_changed");
    expect(double.events().filter((event) => event.detail.includes("PAST_DUE"))).toHaveLength(2);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("an unknown outcome waits, and turns PAST_DUE if it is settled as a refusal", async () => {
    const { double } = world();
    double.reset({ subscribed: true });
    double.payment("processing");
    const waiting = await advance(double);
    expect(double.state()).toMatchObject({
      status: "ACTIVE",
      invoices: [
        { kind: "RENEWAL", status: "PUSHED" },
        { kind: "ACTIVATION", status: "PAID" },
      ],
    });

    expect(double.declineInvoice(waiting.invoiceId!)).toBe(true);
    expect(double.state()).toMatchObject({ status: "PAST_DUE" });
    expect(double.payInvoice(waiting.invoiceId!)).toBe(true);
    expect(double.state()).toMatchObject({ status: "ACTIVE" });
  });

  test("a renewal of a free plan bills nothing", async () => {
    const { double } = world();
    double.reset({ free: true });
    expect(await advance(double)).toMatchObject({ applied: "renewed", invoiceId: null });
    expect(double.state()).toMatchObject({ plan: "starter-v1", invoices: [] });
  });

  test("a cancellation takes effect at the boundary, and the plan stays on the instance", async () => {
    const { double, customer } = world();
    double.reset({ subscribed: true });
    const session = await customer();
    await session.cancelSubscription();

    expect(await advance(double)).toMatchObject({ applied: "canceled", invoiceId: null });
    expect(double.state()).toMatchObject({
      subscribed: false,
      status: null,
      plan: "pro-v2",
      cancelAtPeriodEnd: false,
    });
    // No fallback is played: the instance keeps the plan it had.
    expect(await session.getPortal()).toMatchObject({
      instance: { licenseName: "Pro" },
      subscription: null,
      capabilities: { checkout: true },
    });
    expect(double.events().map((event) => event.type)).toEqual([
      "instance.billing.cancellation_scheduled",
      "instance.billing.canceled",
    ]);
  });
});

describe("add-ons", () => {
  test("an increase applies now and a removal waits for the boundary, then leaves the portal", async () => {
    const { double, customer, recorder } = world();
    double.reset({ subscribed: true });
    const session = await customer();

    await expect(session.setAddonQuantity("extra-seats-v1", 2)).resolves.toMatchObject({
      slug: "extra-seats-v1",
      quantity: 2,
      maxQuantity: 50,
    });
    expect((await session.getPortal()).addOns).toMatchObject([
      { slug: "extra-seats-v1", quantity: 2 },
    ]);
    await session.setAddonQuantity("extra-seats-v1", 5);
    expect(double.state().addOns).toEqual([{ slug: "extra-seats-v1", quantity: 5 }]);
    // Setting the quantity held changes nothing, and says nothing.
    await session.setAddonQuantity("extra-seats-v1", 5);
    expect(double.events().map((event) => event.type)).toEqual([
      "instance.addon.added",
      "instance.addon.quantity_changed",
    ]);

    // Nothing was billed for it yet; the renewal bills the base fee and the five seats.
    expect(double.state().invoices).toHaveLength(1);
    expect(double.advance(ORIGIN)).toMatchObject({ ok: true });
    expect((await session.listInvoices()).items[0]).toMatchObject({
      kind: "RENEWAL",
      total: 4900 + 5 * 1000,
      lines: [
        { type: "BASE", amount: 4900 },
        { type: "ADDON", label: "Extra seats", quantity: "5", amount: 5000 },
      ],
    });

    await session.setAddonQuantity("extra-seats-v1", 0);
    expect((await session.getPortal()).addOns).toMatchObject([{ quantity: 5, pendingQuantity: 0 }]);
    expect(double.advance(ORIGIN)).toMatchObject({ ok: true });
    expect((await session.getPortal()).addOns).toEqual([]);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("refuses what does not fit: an unknown add-on, too many or fewer than none, a plan it does not suit, another currency", async () => {
    const { double, customer, recorder, mint, call } = world();
    const session = await customer();
    // Never subscribed, the instance is on Starter, which takes no add-on.
    await expect(session.setAddonQuantity("extra-seats-v1", 1)).rejects.toMatchObject({
      status: 422,
      code: "SetSessionAddonQuantity.Incompatible",
    });

    double.reset({ subscribed: true });
    const subscribed = await customer();
    await expect(subscribed.setAddonQuantity("nope", 1)).rejects.toMatchObject({
      code: "SetSessionAddonQuantity.AddonNotPublic",
    });
    await expect(subscribed.setAddonQuantity("extra-seats-v1", 51)).rejects.toMatchObject({
      code: "SetSessionAddonQuantity.QuantityExceedsMax",
    });
    // The client refuses a quantity below 0 before sending it; the route says what Kaiten says.
    const below = await call("/api/public/session/addons/extra-seats-v1", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${(await mint()).token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ quantity: -1 }),
    });
    expect(below.status).toBe(422);
    expect(await below.json()).toMatchObject({
      code: "SetSessionAddonQuantity.QuantityExceedsMax",
    });
    // The Japanese pack does not suit Pro.
    await expect(subscribed.setAddonQuantity("jp-pack-v1", 1)).rejects.toMatchObject({
      status: 422,
      code: "SetSessionAddonQuantity.Incompatible",
    });
    // The GPU pack suits Pro, and is priced in dollars only: a subscription in euros cannot take it.
    await expect(subscribed.setAddonQuantity("gpu-pack-v1", 1)).rejects.toMatchObject({
      status: 422,
      code: "SetSessionAddonQuantity.CurrencyMismatch",
    });
    expect(double.state().addOns).toEqual([]);
    // A session bound to the customer alone has no instance to attach anything to.
    await expect(
      (await customer(null)).setAddonQuantity("extra-seats-v1", 1),
    ).rejects.toMatchObject({ code: "SetSessionAddonQuantity.InstanceRequired" });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("without a live subscription, a change is in force at once, and only the plan and the maximum are checked", async () => {
    const { double, customer, recorder } = world();
    double.reset({ subscribed: true });
    const session = await customer();
    await session.cancelSubscription();
    expect(double.advance(ORIGIN)).toMatchObject({ ok: true, applied: "canceled" });
    expect(double.state()).toMatchObject({ subscribed: false, plan: "pro-v2" });

    // The instance is still on Pro. Nothing is billed, so neither the currency nor the period is
    // checked: the GPU pack, in dollars, is attached as the seats are.
    await expect(session.setAddonQuantity("extra-seats-v1", 2)).resolves.toMatchObject({
      slug: "extra-seats-v1",
      quantity: 2,
    });
    await expect(session.setAddonQuantity("gpu-pack-v1", 1)).resolves.toMatchObject({
      slug: "gpu-pack-v1",
      quantity: 1,
    });
    expect((await session.getPortal()).addOns).toMatchObject([
      { slug: "extra-seats-v1", quantity: 2 },
      { slug: "gpu-pack-v1", quantity: 1 },
    ]);
    await expect(session.setAddonQuantity("extra-seats-v1", 51)).rejects.toMatchObject({
      code: "SetSessionAddonQuantity.QuantityExceedsMax",
    });
    await expect(session.setAddonQuantity("jp-pack-v1", 1)).rejects.toMatchObject({
      code: "SetSessionAddonQuantity.Incompatible",
    });

    // A decrease is in force at once too, and 0 detaches.
    await session.setAddonQuantity("extra-seats-v1", 1);
    await session.setAddonQuantity("gpu-pack-v1", 0);
    expect(double.state().addOns).toEqual([{ slug: "extra-seats-v1", quantity: 1 }]);
    expect(double.events().slice(2)).toMatchObject([
      { type: "instance.addon.added", detail: expect.stringContaining("no subscription to bill") },
      { type: "instance.addon.added" },
      { type: "instance.addon.quantity_changed" },
      { type: "instance.addon.removed" },
    ]);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("refuses an add-on with no price for the subscription's billing period, in its currency", async () => {
    const { double, customer, recorder } = world();
    double.reset({ card: true, email: true });
    const session = await customer();
    // Pro, every quarter: the seats are sold in euros, by the month and by the year only.
    await session.checkout({ licensePriceId: PRO_QUARTERLY });
    await expect(session.setAddonQuantity("extra-seats-v1", 1)).rejects.toMatchObject({
      status: 422,
      code: "SetSessionAddonQuantity.Incompatible",
    });
    // The GPU pack has no price in euros at all, whatever the period.
    await expect(session.setAddonQuantity("gpu-pack-v1", 1)).rejects.toMatchObject({
      code: "SetSessionAddonQuantity.CurrencyMismatch",
    });
    expect(double.state().addOns).toEqual([]);

    // By the year, the seats are sold.
    double.reset({ card: true, email: true });
    const annual = await customer();
    await annual.checkout({ licensePriceId: PRO_ANNUAL });
    await expect(annual.setAddonQuantity("extra-seats-v1", 2)).resolves.toMatchObject({
      slug: "extra-seats-v1",
      quantity: 2,
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("attaches an add-on billed no flat fee for the period, as Kaiten does: metered only, free or custom", async () => {
    // Acme's catalogue, with three more add-ons that fit Pro: GPU hours, metered only; Priority
    // support, free, with a fee of 0 by the year alone; a Dedicated region, custom, with no price.
    const catalog = structuredClone(acmeCatalog) as Record<string, any>;
    const proAddon = (familySlug: string, name: string, pricingType: string, prices: object[]) => ({
      familySlug,
      addonSlug: `${familySlug}-v1`,
      addonId: randomUUID(),
      name,
      description: "",
      pricingType,
      maxQuantity: null,
      prices,
      entitlements: [],
      compatibleLicenseFamilies: ["pro"],
    });
    catalog.addOns.push(
      proAddon("gpu-hours", "GPU hours", "PAID", [
        {
          id: randomUUID(),
          billingModel: "USAGE_BASED",
          billingTiming: "ARREARS",
          billingPeriod: null,
          displayLabel: null,
          currency: "EUR",
          unitAmount: 90,
          unitAmountDecimal: "90",
          metered: {
            entitlementSlug: "gpu-hours",
            saleUnitFactor: "1",
            saleUnitSingular: null,
            saleUnitPlural: null,
          },
          displayOrder: 0,
          isDefault: false,
        },
      ]),
      proAddon("priority-support", "Priority support", "FREE", [
        {
          id: randomUUID(),
          billingModel: "FLAT_FEE",
          billingTiming: "ADVANCE",
          billingPeriod: "ANNUAL",
          currency: "EUR",
          unitAmount: 0,
          unitAmountDecimal: "0",
          displayLabel: "Annual",
          displayOrder: 0,
          isDefault: true,
          metered: null,
        },
      ]),
      proAddon("dedicated-region", "Dedicated region", "CUSTOM", []),
    );
    catalog.plans
      .find((plan: any) => plan.familySlug === "pro")
      .compatibleAddonFamilies.push("gpu-hours", "priority-support", "dedicated-region");

    const { double, customer, recorder } = world(catalog);
    double.reset({ subscribed: true });
    const session = await customer();
    // Pro, every month, in euros: none of the three has a monthly fee, and none needs one.
    for (const slug of ["gpu-hours-v1", "priority-support-v1", "dedicated-region-v1"]) {
      await expect(session.setAddonQuantity(slug, 1)).resolves.toMatchObject({ slug, quantity: 1 });
    }
    expect(double.state().addOns).toEqual([
      { slug: "gpu-hours-v1", quantity: 1 },
      { slug: "priority-support-v1", quantity: 1 },
      { slug: "dedicated-region-v1", quantity: 1 },
    ]);
    // A paid add-on with flat fees still needs one for the period: the seats, quarterly.
    double.reset({ card: true, email: true });
    const quarterly = await customer();
    await quarterly.checkout({ licensePriceId: PRO_QUARTERLY });
    await expect(quarterly.setAddonQuantity("extra-seats-v1", 1)).rejects.toMatchObject({
      code: "SetSessionAddonQuantity.Incompatible",
    });
    await expect(quarterly.setAddonQuantity("gpu-hours-v1", 1)).resolves.toMatchObject({
      quantity: 1,
    });
    expect(contractProblems(recorder)).toEqual([]);
  });
});

describe("a checkout of an instance that holds add-ons", () => {
  /**
   * Acme's catalogue, with Extra storage beside the seats: a paid add-on in euros that fits Pro,
   * 5.00 a month, so that a checkout can attach a family the instance does not hold.
   */
  function catalogWithStorage() {
    const catalog = structuredClone(acmeCatalog) as Record<string, any>;
    catalog.addOns.push({
      familySlug: "extra-storage",
      addonSlug: "extra-storage-v1",
      addonId: randomUUID(),
      name: "Extra storage",
      description: "",
      pricingType: "PAID",
      maxQuantity: null,
      prices: [
        {
          id: randomUUID(),
          billingModel: "FLAT_FEE",
          billingTiming: "ADVANCE",
          billingPeriod: "MONTHLY",
          currency: "EUR",
          unitAmount: 500,
          unitAmountDecimal: "500",
          displayLabel: "Monthly",
          displayOrder: 0,
          isDefault: true,
          metered: null,
        },
      ],
      entitlements: [],
      compatibleLicenseFamilies: ["pro"],
    });
    catalog.plans
      .find((plan: any) => plan.familySlug === "pro")
      .compatibleAddonFamilies.push("extra-storage");
    return catalog;
  }

  /**
   * A customer whose Pro subscription, by the month, has ended, and whose instance then took
   * `held`: without a live subscription a change is in force at once, whatever its prices.
   */
  async function canceledHolding(held: Array<[string, number]>, catalog?: Record<string, any>) {
    const found = world(catalog);
    found.double.reset({ subscribed: true });
    const session = await found.customer();
    await session.cancelSubscription();
    expect(found.double.advance(ORIGIN)).toMatchObject({ ok: true, applied: "canceled" });
    for (const [slug, quantity] of held) await session.setAddonQuantity(slug, quantity);
    return { ...found, session };
  }

  test("keeps what it holds through the subscribe, and bills it from the activation at the new period's fee", async () => {
    const { double, session, recorder } = await canceledHolding(
      [["extra-seats-v1", 3]],
      catalogWithStorage(),
    );

    // By the month, the three seats it holds are billed beside the base fee.
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, dryRun: true }),
    ).resolves.toMatchObject({
      status: "preview",
      dueToday: {
        total: 4900 + 3 * 1000,
        lines: [
          { type: "BASE", amount: 4900 },
          { type: "ADDON", label: "Extra seats", quantity: "3", amount: 3000 },
        ],
      },
    });
    // By the year, at their fee of the year.
    await expect(
      session.checkout({ licensePriceId: PRO_ANNUAL, dryRun: true }),
    ).resolves.toMatchObject({ dueToday: { total: 49000 + 3 * 10000 } });

    // The checkout attaches storage beside them, and replaces nothing.
    const bought = await session.checkout({
      licensePriceId: PRO_MONTHLY,
      addOns: [{ addonSlug: "extra-storage-v1", quantity: 2 }],
    });
    expect(bought).toMatchObject({
      status: "subscribed",
      activationInvoice: {
        kind: "ACTIVATION",
        total: 4900 + 3 * 1000 + 2 * 500,
        lines: [
          { type: "BASE", amount: 4900 },
          { type: "ADDON", label: "Extra seats", quantity: "3", amount: 3000 },
          { type: "ADDON", label: "Extra storage", quantity: "2", amount: 1000 },
        ],
      },
      payment: { status: "paid" },
    });
    expect(double.state().addOns).toEqual([
      { slug: "extra-seats-v1", quantity: 3 },
      { slug: "extra-storage-v1", quantity: 2 },
    ]);
    expect((await session.getPortal()).addOns).toMatchObject([
      { slug: "extra-seats-v1", quantity: 3 },
      { slug: "extra-storage-v1", quantity: 2 },
    ]);
    // And the renewal bills them all again.
    expect(double.advance(ORIGIN)).toMatchObject({ ok: true, applied: "renewed" });
    expect((await session.listInvoices()).items[0]).toMatchObject({
      kind: "RENEWAL",
      total: 4900 + 3000 + 1000,
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("refuses what it holds and the new price cannot bill, one entry per attachment, and changes nothing", async () => {
    const { double, session, recorder } = await canceledHolding([
      ["extra-seats-v1", 3],
      ["gpu-pack-v1", 1],
    ]);

    // Every quarter: the seats have no fee for it, and the GPU pack is in dollars.
    await expect(
      session.checkout({ licensePriceId: PRO_QUARTERLY, dryRun: true }),
    ).rejects.toMatchObject({
      status: 422,
      code: "CreateSessionCheckout.AddonInvalid",
      errors: [
        {
          location: "addons.extra-seats-v1",
          value: { code: "AttachInstanceAddon.NoPriceForBillingPeriod" },
        },
        {
          location: "addons.gpu-pack-v1",
          value: { code: "AttachInstanceAddon.CurrencyMismatch" },
        },
      ],
    });
    // By the month the seats are billed, and the GPU pack alone is refused, for its currency.
    await expect(session.checkout({ licensePriceId: PRO_MONTHLY })).rejects.toMatchObject({
      status: 422,
      code: "CreateSessionCheckout.CurrencyMismatch",
      errors: [
        { location: "addons.gpu-pack-v1", value: { code: "AttachInstanceAddon.CurrencyMismatch" } },
      ],
    });
    expect(double.state()).toMatchObject({
      subscribed: false,
      addOns: [
        { slug: "extra-seats-v1", quantity: 3 },
        { slug: "gpu-pack-v1", quantity: 1 },
      ],
      invoices: [{ kind: "ACTIVATION" }],
    });

    // Once the GPU pack is gone, the same checkout subscribes, with the seats.
    await session.setAddonQuantity("gpu-pack-v1", 0);
    await expect(session.checkout({ licensePriceId: PRO_MONTHLY })).resolves.toMatchObject({
      status: "subscribed",
      activationInvoice: { total: 4900 + 3000 },
    });
    expect(double.state().addOns).toEqual([{ slug: "extra-seats-v1", quantity: 3 }]);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("refuses an add-on of a family it holds, once the instance is found to be one it can subscribe", async () => {
    const { double, session, customer, recorder } = await canceledHolding([["extra-seats-v1", 3]]);

    for (const dryRun of [true, false]) {
      await expect(
        session.checkout({
          licensePriceId: PRO_MONTHLY,
          addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
          dryRun,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "CreateSessionCheckout.AddonInvalid",
        errors: [
          {
            location: "body.addOns[0]",
            value: { code: "AttachInstanceAddon.FamilyAlreadyAttached" },
          },
        ],
      });
    }
    expect(double.state()).toMatchObject({
      subscribed: false,
      addOns: [{ slug: "extra-seats-v1", quantity: 3 }],
    });

    // A live subscription is refused for what it is first, add-ons or not.
    double.reset({ subscribed: true });
    const subscribed = await customer();
    await subscribed.setAddonQuantity("extra-seats-v1", 2);
    await expect(
      subscribed.checkout({
        licensePriceId: PRO_MONTHLY,
        addOns: [{ addonSlug: "extra-seats-v1", quantity: 1 }],
        dryRun: true,
      }),
    ).rejects.toMatchObject({ status: 409, code: "CreateSessionCheckout.AlreadySubscribed" });
    expect(contractProblems(recorder)).toEqual([]);
  });
});

describe("the vendor's scheduled plan change", () => {
  test("is scheduled with the server SDK, shown in the portal, and applied at the boundary", async () => {
    const { double, customer, server, recorder } = world();
    double.reset({ subscribed: true });
    const session = await customer();

    const { data } = await Billing.schedulePlanChange({
      client: server,
      throwOnError: true,
      path: { instanceSlug: "acme-instance" },
      body: { licensePriceId: GROWTH_MONTHLY },
    });
    expect(data).toMatchObject({
      status: "ACTIVE",
      basePrice: { unitAmountDecimal: "4900" },
      scheduledChange: { price: { id: GROWTH_MONTHLY, unitAmountDecimal: "9900" } },
    });
    expect(data.scheduledChange?.effectiveAt).toBe(data.currentPeriodEnd);
    expect(double.state().scheduledChange).toMatchObject({ plan: "growth-v1" });
    expect((await session.getPortal()).subscription?.scheduledChange).toMatchObject({
      price: { id: GROWTH_MONTHLY },
      effectiveAt: data.currentPeriodEnd,
    });
    // The same target again changes nothing.
    await Billing.schedulePlanChange({
      client: server,
      throwOnError: true,
      path: { instanceSlug: "acme-instance" },
      body: { licensePriceId: GROWTH_MONTHLY },
    });
    expect(
      double.events().filter((event) => event.type === "instance.billing.plan_change_scheduled"),
    ).toHaveLength(1);

    // Nothing changes before the boundary; at it, the invoice is the new plan's and so is the instance.
    expect(double.state()).toMatchObject({ plan: "pro-v2" });
    expect(double.advance(ORIGIN)).toMatchObject({ ok: true, applied: "plan_changed" });
    expect(double.state()).toMatchObject({
      plan: "growth-v1",
      planName: "Growth",
      scheduledChange: null,
      invoices: [{ kind: "RENEWAL", total: 9900 }, { total: 4900 }],
    });
    expect(await session.getPortal()).toMatchObject({
      instance: { licenseName: "Growth" },
      subscription: { basePrice: { id: GROWTH_MONTHLY }, scheduledChange: null },
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("can be dropped before the boundary, and only when there is one", async () => {
    const { double, server, recorder } = world();
    double.reset({ subscribed: true });
    const cancel = () =>
      Billing.cancelPlanChange({
        client: server,
        throwOnError: true,
        path: { instanceSlug: "acme-instance" },
      });

    await expect(cancel()).rejects.toMatchObject({
      status: 409,
      code: "CancelPlanChange.NoPlanChangeScheduled",
    });
    await Billing.schedulePlanChange({
      client: server,
      throwOnError: true,
      path: { instanceSlug: "acme-instance" },
      body: { licensePriceId: GROWTH_MONTHLY },
    });
    await expect(cancel()).resolves.toMatchObject({ data: { scheduledChange: null } });
    expect(double.state().scheduledChange).toBeNull();
    expect(double.advance(ORIGIN)).toMatchObject({ applied: "renewed" });
    expect(double.state()).toMatchObject({ plan: "pro-v2" });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("is refused as Kaiten refuses it", async () => {
    const { double, customer, server, recorder } = world();
    const schedule = (licensePriceId: string, slug = "acme-instance") =>
      Billing.schedulePlanChange({
        client: server,
        throwOnError: true,
        path: { instanceSlug: slug },
        body: { licensePriceId },
      });

    await expect(schedule(GROWTH_MONTHLY)).rejects.toMatchObject({
      status: 404,
      code: "SchedulePlanChange.NotFound",
    });

    double.reset({ subscribed: true });
    await expect(schedule("00000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({
      status: 404,
      code: "SchedulePlanChange.PriceNotFound",
    });
    await expect(schedule(PRO_MONTHLY)).rejects.toMatchObject({
      status: 422,
      code: "SchedulePlanChange.SamePrice",
    });
    await expect(schedule(JAPAN_MONTHLY)).rejects.toMatchObject({
      status: 422,
      code: "SchedulePlanChange.CurrencyMismatch",
    });
    await expect(schedule("00000000-0000-4000-8000-000000000206")).rejects.toMatchObject({
      status: 422,
      code: "SchedulePlanChange.PriceNotFlatFee",
    });

    // A plan that does not suit what the instance holds.
    await (await customer()).setAddonQuantity("extra-seats-v1", 1);
    await expect(schedule(LITE_MONTHLY)).rejects.toMatchObject({
      status: 422,
      code: "SchedulePlanChange.AddonIncompatible",
    });

    // A cancellation scheduled, a trial in progress.
    await (await customer()).cancelSubscription();
    await expect(schedule(GROWTH_MONTHLY)).rejects.toMatchObject({
      status: 409,
      code: "SchedulePlanChange.CancellationScheduled",
    });
    double.reset({ card: true, email: true });
    await (await customer()).checkout({ licensePriceId: GROWTH_MONTHLY });
    await expect(schedule(PRO_MONTHLY)).rejects.toMatchObject({
      status: 409,
      code: "SchedulePlanChange.TrialInProgress",
    });

    // A canceled subscription has no plan to change.
    double.reset({ subscribed: true });
    await (await customer()).cancelSubscription();
    double.advance(ORIGIN);
    await expect(schedule(GROWTH_MONTHLY)).rejects.toMatchObject({
      status: 409,
      code: "SchedulePlanChange.NotActive",
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("takes the server token and no other credential", async () => {
    const { double, recorder } = world();
    double.reset({ subscribed: true });
    const stranger = createKaitenClient({
      baseUrl: API,
      token: `ksh_${"x".repeat(43)}`,
      fetch: recorder.fetch,
    });
    await expect(
      Billing.schedulePlanChange({
        client: stranger,
        throwOnError: true,
        path: { instanceSlug: "acme-instance" },
        body: { licensePriceId: GROWTH_MONTHLY },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(double.state().scheduledChange).toBeNull();
    const calls = double.calls();
    expect(calls.at(-1)).toMatchObject({
      method: "PUT",
      path: "/instances/acme-instance/billing/scheduled-change",
      credential: "ksh_",
      origin: null,
    });
  });
});

describe("the payment method", () => {
  test("changing it saves the other card, so that the change is seen", async () => {
    const { double, customer, call } = world();
    double.reset({ card: true, email: true });
    const session = await customer();
    expect(double.state().card).toBe("Visa 4242");

    const change = await session.createPaymentMethodSession({ returnUrl: `${ORIGIN}/portal` });
    expect(
      await (await call(new URL(change.url).pathname.replace(DOUBLE_PATH, ""))).text(),
    ).toContain("Save card 5555 5555 5555 4444");
    await call(`/provider/setup/${change.sessionId}/save`, { method: "POST" });
    expect(double.state().card).toBe("Mastercard 4444");
    expect(
      (await session.completePaymentMethodSession(change.sessionId)).paymentMethod,
    ).toMatchObject({
      brand: "mastercard",
      last4: "4444",
    });
    expect((await session.getPortal()).paymentMethod).toMatchObject({ last4: "4444" });
    expect(double.events().map((event) => event.type)).toEqual([
      "customer.payment_method.attached",
    ]);

    // And back.
    const again = await session.createPaymentMethodSession({ returnUrl: `${ORIGIN}/portal` });
    await call(`/provider/setup/${again.sessionId}/save`, { method: "POST" });
    expect(double.state().card).toBe("Visa 4242");
  });
});

describe("a code redeemed from the portal", () => {
  /**
   * What the stand-in answered that the contract does not allow, but for a dry run: Kaiten answers a
   * `dryRun` of `vouchers/redeem` with 200 and the contract declares the 201 only, so those answers
   * are held to the redemption's schema instead.
   */
  const problemsBesidesDryRuns = (recorder: ReturnType<typeof recordingFetch>) => {
    const dry = (exchange: { method: string; path: string; status: number }) =>
      exchange.method === "POST" &&
      exchange.path === "/public/session/vouchers/redeem" &&
      exchange.status === 200;
    return [
      ...contractProblemsOf(recorder.exchanges.filter((exchange) => !dry(exchange))),
      ...recorder.exchanges
        .filter(dry)
        .flatMap((exchange) => schemaProblems("SessionRedemption", exchange.body)),
    ];
  };

  test("is listed by the portal, takes effect on the next invoice and is not redeemed twice", async () => {
    const { double, recorder, customer } = world();
    double.reset({ subscribed: true });
    const session = await customer();

    // A dry run answers what the code would make, and writes nothing.
    const preview = await session.redeemVoucher({ code: "welcome-20", dryRun: true });
    expect(preview).toMatchObject({
      name: "Welcome 20%",
      voucherType: "PRICE",
      appliesFromInvoice: "next",
      applicationsCount: 0,
      applicationsMax: 3,
    });
    expect((await session.getPortal()).vouchers).toEqual([]);

    const made = await session.redeemVoucher({ code: "WELCOME20" });
    expect(made).toMatchObject({
      name: "Welcome 20%",
      status: "ACTIVE",
      appliesFromInvoice: "next",
    });
    expect((await session.getPortal()).vouchers).toEqual([made]);

    // Every refusal of the code is the one answer: an unknown code, and one already redeemed.
    const unknown = await session.redeemVoucher({ code: "NOPE" }).catch((error: unknown) => error);
    const twice = await session
      .redeemVoucher({ code: "WELCOME20" })
      .catch((error: unknown) => error);
    for (const refusal of [unknown, twice]) {
      expect(refusal).toBeInstanceOf(KaitenError);
      expect(refusal).toMatchObject({ status: 422, code: "RedeemSessionVoucher.VoucherInvalid" });
    }
    expect((unknown as KaitenError).detail).toBe((twice as KaitenError).detail);

    // The next invoice carries the discount, once, and the portal counts it.
    const renewed = double.advance(ORIGIN);
    expect(renewed).toMatchObject({ ok: true, applied: "renewed" });
    const invoice = double.state().invoices[0]!;
    expect(invoice).toMatchObject({ kind: "RENEWAL" });
    const [shown] = (await session.listInvoices()).items;
    expect(shown).toMatchObject({ discountTotal: 980 });
    expect((await session.getPortal()).vouchers).toEqual([
      expect.objectContaining({
        appliesFromInvoice: null,
        applicationsCount: 1,
        applicationsMax: 3,
      }),
    ]);

    expect(problemsBesidesDryRuns(recorder)).toEqual([]);
  });

  test("is refused as Kaiten refuses it: no instance, no subscription, a checkout waiting", async () => {
    const { double, recorder, customer } = world();
    double.reset({ subscribed: true });

    const bound = await customer(null);
    await expect(bound.redeemVoucher({ code: "WELCOME20" })).rejects.toMatchObject({
      status: 422,
      code: "RedeemSessionVoucher.InstanceRequired",
    });

    double.reset({ card: true, email: true });
    const none = await customer();
    await expect(none.redeemVoucher({ code: "WELCOME20" })).rejects.toMatchObject({
      status: 409,
      code: "RedeemSessionVoucher.NoLiveSubscription",
    });

    expect(problemsBesidesDryRuns(recorder)).toEqual([]);
  });

  test("a trial is live too: the code discounts the invoice the trial ends with", async () => {
    const { double, recorder, customer } = world();
    double.reset({ card: true, email: true });
    const session = await customer();
    await session.checkout({ licensePriceId: GROWTH_MONTHLY });
    const before = (await session.getPortal()).trial?.charge?.amount;

    await session.redeemVoucher({ code: "WELCOME20" });

    const after = (await session.getPortal()).trial?.charge?.amount;
    expect(before).toBeGreaterThan(0);
    expect(after).toBe(before! - Math.round((before! * 20) / 100));
    expect(double.endTrial(ORIGIN)).toMatchObject({ ok: true, applied: "trial_converted" });
    expect(double.state().invoices[0]).toMatchObject({ kind: "ACTIVATION", total: after });
    expect(problemsBesidesDryRuns(recorder)).toEqual([]);
  });

  test("a voucher a checkout carried is redeemed already", async () => {
    const { double, customer } = world();
    double.reset({ card: true, email: true });
    const session = await customer();
    await session.checkout({ licensePriceId: PRO_MONTHLY, voucherCode: "WELCOME20" });

    expect((await session.getPortal()).vouchers).toEqual([
      expect.objectContaining({
        name: "Welcome 20%",
        appliesFromInvoice: null,
        applicationsCount: 1,
      }),
    ]);
    await expect(session.redeemVoucher({ code: "WELCOME20" })).rejects.toMatchObject({
      code: "RedeemSessionVoucher.VoucherInvalid",
    });
  });

  test("is not taken again by a checkout or a check once the instance redeemed it", async () => {
    const { double, recorder, customer } = world();
    double.reset({ subscribed: true });
    const session = await customer();
    await expect(session.validateVoucher({ code: "WELCOME20" })).resolves.toMatchObject({
      valid: true,
    });
    await session.redeemVoucher({ code: "WELCOME20" });

    // The subscription ends, and the instance falls back to the free plan.
    await session.cancelSubscription();
    expect(double.advance(ORIGIN)).toMatchObject({ ok: true, applied: "canceled" });

    // The code is the instance's, taken: a check says so, and a new checkout that carries it is refused.
    await expect(session.validateVoucher({ code: "WELCOME20" })).resolves.toMatchObject({
      valid: false,
    });
    for (const dryRun of [true, false]) {
      await expect(
        session.checkout({ licensePriceId: PRO_MONTHLY, voucherCode: "WELCOME20", dryRun }),
      ).rejects.toMatchObject({ status: 422, code: "CreateSessionCheckout.VoucherInvalid" });
    }
    // Without the code the checkout goes through, and the invoice carries no discount.
    await session.checkout({ licensePriceId: PRO_MONTHLY });
    expect((await session.listInvoices()).items[0]).toMatchObject({ discountTotal: 0 });
    expect(problemsBesidesDryRuns(recorder)).toEqual([]);
  });

  test("a trial that carries the code discounts the invoice it ends with once", async () => {
    const { double, customer } = world();
    double.reset({ card: true, email: true });
    const session = await customer();
    await session.checkout({ licensePriceId: GROWTH_MONTHLY, voucherCode: "WELCOME20" });

    const [redemption] = (await session.getPortal()).vouchers;
    expect(redemption).toMatchObject({ name: "Welcome 20%", applicationsCount: 0 });
    expect(double.endTrial(ORIGIN)).toMatchObject({ ok: true, applied: "trial_converted" });

    // 9,900 less 20% of the base fee, and the code counted once.
    expect(double.state().invoices[0]).toMatchObject({ kind: "ACTIVATION", total: 9900 - 1980 });
    expect((await session.listInvoices()).items).toEqual([
      expect.objectContaining({ discountTotal: 1980 }),
    ]);
    expect((await session.getPortal()).vouchers).toEqual([
      expect.objectContaining({ applicationsCount: 1 }),
    ]);
  });

  test("refuses a body the contract does not allow", async () => {
    const { double, call, mint } = world();
    double.reset({ subscribed: true });
    const { token } = await mint();
    const post = (body: unknown) =>
      call("/api/public/session/vouchers/redeem", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    for (const body of [{}, { code: "" }, { code: "x".repeat(65) }, { code: "A", dryRun: "yes" }]) {
      expect((await post(body)).status).toBe(422);
    }
  });
});

describe("the new controls, over HTTP", () => {
  test("move the subscription, say what happened, and refuse what makes no sense", async () => {
    const { double, call } = world();
    const post = (path: string, data?: unknown) =>
      call(`/control${path}`, {
        method: "POST",
        body: JSON.stringify(data ?? {}),
        headers: { "content-type": "application/json" },
      });

    expect((await post("/reset", { free: true })).status).toBe(200);
    expect(await (await call("/control/state")).json()).toMatchObject({
      plan: "starter-v1",
      free: true,
    });

    expect((await post("/trial/end")).status).toBe(409);
    expect(await (await post("/trial/end")).json()).toMatchObject({
      ok: false,
      code: "not_in_trial",
    });

    await post("/reset", { subscribed: true });
    await post("/payment", { outcome: "failed" });
    const advanced = await post("/advance");
    expect(advanced.status).toBe(200);
    const body = (await advanced.json()) as { ok: true; applied: string; invoiceId: string };
    expect(body).toMatchObject({ ok: true, applied: "renewed" });
    // The provider's address on the invoice is that of the origin that asked.
    expect(
      (double.state().invoices.find((invoice) => invoice.id === body.invoiceId) ?? {}).status,
    ).toBe("PAYMENT_FAILED");
    expect(double.state().status).toBe("PAST_DUE");

    const events = (await (await call("/control/events")).json()) as Array<{ type: string }>;
    expect(events.map((event) => event.type)).toContain("instance.invoice.payment_failed");

    expect((await post("/payment", { outcome: "maybe" })).status).toBe(400);
    expect(
      (
        await call("/control/advance", {
          method: "POST",
          headers: { Origin: "https://elsewhere.test" },
        })
      ).status,
    ).toBe(403);
  });
});

describe("the stand-in as a Kaiten with no customer yet", () => {
  const STARTER_LICENCE = "00000000-0000-4000-8000-000000000001";
  const PRO_LICENCE = "00000000-0000-4000-8000-000000000002";
  const SOON = "2026-10-21T10:00:00.000Z";
  const LATER = "2029-10-21T10:00:00.000Z";

  /** The stand-in as a visitor finds it: nothing in it until a sign-up makes something. */
  function visitorWorld() {
    const made = world();
    made.double.reset({ signUp: true });
    const instance = (customerId: string, slug?: string, licenseId = STARTER_LICENCE) =>
      Instances.createInstance({
        client: made.server,
        throwOnError: true,
        body: {
          name: "Initech",
          description: "Signed up on the storefront",
          customerId,
          licenseId,
          startLicenseDate: SOON,
          endLicenseDate: LATER,
          ...(slug === undefined ? {} : { slug }),
        },
      });
    const customer = (name = "Initech", extra: Record<string, unknown> = {}) =>
      Customers.createCustomer({
        client: made.server,
        throwOnError: true,
        body: { name, billingEmail: "billing@initech.test", ...extra },
      });
    return { ...made, instance, customer };
  }

  test("takes a visitor from a customer to a subscription, and every answer fits the contract", async () => {
    const { double, recorder, server, customer, instance } = visitorWorld();
    expect(double.signUp()).toBe(true);
    expect(double.state()).toMatchObject({ customers: [], instances: [], subscribed: false });

    const { data: made } = await customer("Initech", { slug: "initech-1a2b3c" });
    expect(made).toMatchObject({
      name: "Initech",
      slug: "initech-1a2b3c",
      billingEmail: "billing@initech.test",
    });
    expect(made.id).toBeTruthy();

    const { data: started } = await instance(made.id, "initech-4d5e6f");
    expect(started).toMatchObject({
      slug: "initech-4d5e6f",
      customerId: made.id,
      customerSlug: "initech-1a2b3c",
      licenseId: STARTER_LICENCE,
      licenseSlug: "starter-v1",
      startLicenseDate: SOON,
      endLicenseDate: LATER,
      status: "HEALTHY",
    });
    // Starting on the free plan is not a subscription: the instance holds the licence and nothing is billed.
    expect(double.state()).toMatchObject({
      subscribed: false,
      plan: "starter-v1",
      billingEmail: "billing@initech.test",
      customers: [{ slug: "initech-1a2b3c", name: "Initech" }],
      instances: [
        { slug: "initech-4d5e6f", customerSlug: "initech-1a2b3c", licenseSlug: "starter-v1" },
      ],
    });

    const { data: minted } = await CustomerSessions.createCustomerSession({
      client: server,
      throwOnError: true,
      body: { customerSlug: "initech-1a2b3c", instanceSlug: "initech-4d5e6f", ttlSeconds: 900 },
    });
    const session = new KaitenSessionClient({
      apiUrl: API,
      fetch: recorder.fetch,
      getCustomerSession: () => ({ token: minted.token, expiresAt: minted.expiresAt }),
    });

    const portal = await session.getPortal();
    expect(portal.customer).toMatchObject({
      slug: "initech-1a2b3c",
      name: "Initech",
      billingEmail: "billing@initech.test",
    });
    expect(portal.instance).toMatchObject({ slug: "initech-4d5e6f", licenseSlug: "starter-v1" });
    expect(portal.subscription).toBeNull();
    expect(portal.capabilities.checkout).toBe(true);

    // The customer already has an address, so the checkout is not asked for one.
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, dryRun: true }),
    ).resolves.toMatchObject({ status: "preview" });
    await session.checkout({ licensePriceId: PRO_MONTHLY, returnUrl: `${ORIGIN}/checkout/pro-v2` });

    await Customers.deleteCustomer({
      client: server,
      throwOnError: true,
      path: { customerSlug: "initech-1a2b3c" },
    });
    expect(double.state()).toMatchObject({ customers: [], instances: [] });

    expect(contractProblems(recorder)).toEqual([]);
  });

  test("generates a slug when none is sent, and takes the one that is", async () => {
    const { customer, instance, recorder } = visitorWorld();
    const { data: made } = await customer("Café Münster");
    expect(made.slug).toMatch(/^cafe-munster-[0-9a-f]{6}$/);
    const { data: started } = await instance(made.id);
    expect(started.slug).toMatch(/^initech-[0-9a-f]{6}$/);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("refuses what Kaiten refuses, with Kaiten's codes, and every refusal fits the contract", async () => {
    const { double, recorder, customer, instance } = visitorWorld();
    const { data: made } = await customer("Initech", { slug: "initech-aaaaaa" });
    await instance(made.id, "initech-bbbbbb");

    // A slug that is taken, for a customer and for an instance.
    await expect(customer("Other", { slug: "initech-aaaaaa" })).rejects.toMatchObject({
      status: 409,
      code: "CreateCustomer.SlugConflict",
    });
    await expect(instance(made.id, "initech-bbbbbb")).rejects.toMatchObject({
      status: 409,
      code: "CreateInstance.SlugConflict",
    });
    // What is not a slug, an address, a name.
    await expect(customer("Other", { slug: "-bad-" })).rejects.toMatchObject({
      status: 422,
      code: "CreateCustomer.InvalidSlug",
    });
    await expect(customer("Other", { billingEmail: "nope" })).rejects.toMatchObject({
      status: 422,
      code: "CreateCustomer.InvalidBillingEmail",
    });
    await expect(
      customer("Other", { billingEmail: `${"x".repeat(250)}@a.co` }),
    ).rejects.toMatchObject({
      status: 422,
      code: "CreateCustomer.InvalidBillingEmail",
    });
    await expect(customer("")).rejects.toMatchObject({ status: 422 });
    // An instance of a customer that is not there, on a licence that is not there.
    await expect(instance("nobody")).rejects.toMatchObject({
      status: 404,
      code: "CreateInstance.CustomerNotFound",
    });
    await expect(
      instance(made.id, "initech-cccccc", "00000000-0000-4000-8000-0000000000ff"),
    ).rejects.toMatchObject({ status: 404, code: "CreateInstance.LicenseNotFound" });

    // Nothing that was refused was kept.
    expect(double.state().customers).toHaveLength(1);
    expect(double.state().instances).toHaveLength(1);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("refuses a token it does not know, and a customer that is not there to delete", async () => {
    const { recorder, server } = visitorWorld();
    const stranger = createKaitenClient({
      baseUrl: API,
      token: `ksh_${"x".repeat(43)}`,
      fetch: recorder.fetch,
    });
    await expect(
      Customers.createCustomer({ client: stranger, throwOnError: true, body: { name: "Initech" } }),
    ).rejects.toMatchObject({ status: 401, code: "Auth.InvalidCredential" });
    await expect(
      Instances.createInstance({
        client: stranger,
        throwOnError: true,
        body: {
          name: "x",
          description: "x",
          customerId: "x",
          licenseId: STARTER_LICENCE,
          startLicenseDate: SOON,
          endLicenseDate: LATER,
        },
      }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      Customers.deleteCustomer({
        client: stranger,
        throwOnError: true,
        path: { customerSlug: "x" },
      }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      Customers.deleteCustomer({
        client: server,
        throwOnError: true,
        path: { customerSlug: "nobody" },
      }),
    ).rejects.toMatchObject({ status: 404, code: "DeleteCustomer.NotFound" });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("mints a session for the customer and instance that exist, and for no other", async () => {
    const { double, recorder, server, customer, instance } = visitorWorld();
    const mint = (customerSlug: string, instanceSlug?: string) =>
      CustomerSessions.createCustomerSession({
        client: server,
        throwOnError: true,
        body: {
          customerSlug,
          ...(instanceSlug === undefined ? {} : { instanceSlug }),
          ttlSeconds: 900,
        },
      });

    // Nobody has signed up: the demo customer is not there either.
    await expect(mint("acme-customer", "acme-instance")).rejects.toMatchObject({
      status: 404,
      code: "CreateCustomerSession.CustomerNotFound",
    });

    const { data: initech } = await customer("Initech", { slug: "initech-aaaaaa" });
    await instance(initech.id, "initech-bbbbbb");
    const { data: globex } = await customer("Globex", { slug: "globex-aaaaaa" });
    await instance(globex.id, "globex-bbbbbb");

    await expect(mint("globex-aaaaaa", "globex-bbbbbb")).resolves.toBeTruthy();
    await expect(mint("globex-aaaaaa")).resolves.toBeTruthy();
    await expect(mint("globex-aaaaaa", "nothing-here")).rejects.toMatchObject({
      status: 404,
      code: "CreateCustomerSession.InstanceNotFound",
    });
    await expect(mint("globex-aaaaaa", "initech-bbbbbb")).rejects.toMatchObject({
      status: 422,
      code: "CreateCustomerSession.InstanceNotOfCustomer",
    });
    expect(double.state().minted).toBe(2);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("a second sign-up replaces the first: no session is minted for it, and the ones it held end", async () => {
    const { double, recorder, server, customer, instance } = visitorWorld();
    const mint = (customerSlug: string, instanceSlug?: string) =>
      CustomerSessions.createCustomerSession({
        client: server,
        throwOnError: true,
        body: {
          customerSlug,
          ...(instanceSlug === undefined ? {} : { instanceSlug }),
          ttlSeconds: 900,
        },
      });
    const portalOf = (token: string, expiresAt: string) =>
      new KaitenSessionClient({
        apiUrl: API,
        fetch: recorder.fetch,
        getCustomerSession: () => ({ token, expiresAt }),
      }).getPortal();

    const { data: initech } = await customer("Initech", {
      slug: "initech-aaaaaa",
      billingEmail: "billing@initech.test",
    });
    await instance(initech.id, "initech-bbbbbb");
    const { data: first } = await mint("initech-aaaaaa", "initech-bbbbbb");
    await expect(portalOf(first.token, first.expiresAt)).resolves.toMatchObject({
      customer: { name: "Initech", billingEmail: "billing@initech.test" },
    });

    const { data: globex } = await customer("Globex", {
      slug: "globex-aaaaaa",
      billingEmail: "ap@globex.test",
    });
    await instance(globex.id, "globex-bbbbbb", PRO_LICENCE);

    // Initech's cookie is still good in its browser: it mints nothing, so Globex's plan and address
    // are never shown under Initech's name.
    await expect(mint("initech-aaaaaa", "initech-bbbbbb")).rejects.toMatchObject({
      status: 404,
      code: "CreateCustomerSession.CustomerNotFound",
    });
    await expect(mint("initech-aaaaaa")).rejects.toMatchObject({ status: 404 });
    // And the session it already held does not read them either.
    await expect(portalOf(first.token, first.expiresAt)).rejects.toMatchObject({ status: 401 });
    // Globex is the account now.
    const { data: second } = await mint("globex-aaaaaa", "globex-bbbbbb");
    await expect(portalOf(second.token, second.expiresAt)).resolves.toMatchObject({
      customer: { name: "Globex", billingEmail: "ap@globex.test" },
      instance: { licenseSlug: "pro-v2" },
    });
    // Ending a replaced account's sessions is not a sign-out: the count of revocations is the storefront's.
    expect(double.state().revoked).toBe(0);
  });

  test("plays one instance at a time: a new one starts the billing over on its own licence", async () => {
    const { double, customer, instance } = visitorWorld();
    const { data: first } = await customer("Initech", { slug: "initech-aaaaaa" });
    await instance(first.id, "initech-bbbbbb");
    expect(double.state().plan).toBe("starter-v1");

    // The second customer starts on Pro's licence, with its own address and nothing of the first.
    const { data: second } = await customer("Globex", {
      slug: "globex-aaaaaa",
      billingEmail: "ap@globex.test",
    });
    await instance(second.id, "globex-bbbbbb", PRO_LICENCE);

    expect(double.state()).toMatchObject({
      plan: "pro-v2",
      planName: "Pro",
      subscribed: false,
      cardOnFile: false,
      billingEmail: "ap@globex.test",
      invoices: [],
    });
  });

  test("a scripted answer is given to a sign-up's calls as to any other, and the next call is the stand-in's own", async () => {
    const { double, customer, instance } = visitorWorld();
    double.script("POST /instances", { status: 503, retryAfter: 3, body: { code: "x" } });
    const { data: made } = await customer("Initech", { slug: "initech-aaaaaa" });
    await expect(instance(made.id, "initech-bbbbbb")).rejects.toMatchObject({
      status: 503,
      retryAfterSeconds: 3,
    });
    expect(double.calls().filter((each) => each.path === "/customers")).toHaveLength(1);
    await expect(instance(made.id, "initech-bbbbbb")).resolves.toBeTruthy();
  });

  test("a default reset is the demo customer again, and the sign-up scenario ignores the rest of a scenario", () => {
    const { double } = visitorWorld();
    expect(double.signUp()).toBe(true);
    double.reset();
    expect(double.signUp()).toBe(false);
    double.reset({ signUp: true, subscribed: true, card: true });
    expect(double.state()).toMatchObject({ subscribed: false, cardOnFile: false, customers: [] });
  });
});

describe("the anonymous checkout, against the stand-in", () => {
  const RETURN_URL = `${ORIGIN}/checkout/pro-v2`;
  // A Turnstile token is single-use: every start spends one of its own, as the widget gives a new one.
  let minted = 0;
  const token = () => `XXXX.DUMMY.TOKEN.${++minted}`;
  const STARTER_PRICE = STARTER_MONTHLY;
  const LITE_FAMILY_PRICE = LITE_MONTHLY;

  /** The stand-in with the key's anonymous checkout on, a visitor's client and the means to follow the provider's page. */
  function visitorShop(scenario: Parameters<ReturnType<typeof world>["double"]["reset"]>[0] = {}) {
    const made = world();
    made.double.reset({ anonymousCheckout: true, signUp: true, ...scenario });
    const checkout = new KaitenAnonymousCheckoutClient({
      apiUrl: API,
      publishableKey: PUBLISHABLE_KEY,
      fetch: made.recorder.fetch,
      storage: null,
    });
    const start = (priceId: string, extra: Record<string, unknown> = {}) =>
      checkout.startCheckout({
        turnstileToken: token(),
        priceId,
        email: "ada@acme.test",
        returnUrl: RETURN_URL,
        ...extra,
      });
    /** Saves the card on the provider's page, and says where the page sent the visitor back to. */
    const saveCard = async (setupUrl: string) => {
      const saved = await made.double.route(new Request(`${setupUrl}/save`, { method: "POST" }));
      expect(saved?.status).toBe(303);
      return new URL(saved!.headers.get("location")!);
    };
    /** A request to the anonymous routes with exactly the headers given. */
    const raw = (
      path: string,
      init: { method?: string; headers?: Record<string, string>; json?: unknown } = {},
    ) =>
      made.recorder.fetch(`${API}${path}`, {
        method: init.method,
        headers: { "Content-Type": "application/json", ...init.headers },
        body: init.json === undefined ? undefined : JSON.stringify(init.json),
      });
    return { ...made, checkout, start, saveCard, raw };
  }

  test("is off until the key starts it, and the catalogue says which", async () => {
    const { double, recorder, raw } = visitorShop({ anonymousCheckout: false });
    const catalogue = async () => {
      const response = await raw("/public/catalog", {
        headers: { "X-Kaiten-Publishable-Key": PUBLISHABLE_KEY },
      });
      return ((await response.json()) as any).capabilities;
    };
    expect(await catalogue()).toMatchObject({ anonymousCheckout: false, turnstileSiteKey: null });

    const refused = await raw("/public/checkout-sessions", {
      method: "POST",
      headers: { "X-Kaiten-Publishable-Key": PUBLISHABLE_KEY },
      json: { turnstileToken: token(), priceId: STARTER_PRICE, dryRun: true },
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      code: "CreateCheckoutSession.AnonymousCheckoutDisabled",
    });

    double.anonymousCheckout(true);
    expect(await catalogue()).toMatchObject({
      anonymousCheckout: true,
      turnstileSiteKey: "1x00000000000000000000AA",
    });
    expect(double.state().anonymousCheckout).toBe(true);
    // A scenario starts it on, and a reset without one off again.
    double.reset();
    expect(await catalogue()).toMatchObject({ anonymousCheckout: false });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("onboards a visitor on a free plan with no payment method and no provider, and every answer fits the contract", async () => {
    const { double, recorder, checkout, start } = visitorShop();

    const opened = await start(STARTER_PRICE, { clientReferenceId: "cart-7" });
    expect(opened).toMatchObject({
      status: "open",
      dueToday: { total: 0 },
      requiresPaymentMethod: false,
      trialEndsAt: null,
    });
    // Nothing exists but the session until it is confirmed.
    expect(double.state()).toMatchObject({ customers: [], instances: [], subscribed: false });
    expect(double.state().checkoutSessions).toMatchObject([
      { status: "OPEN", email: "ada@acme.test", clientReferenceId: "cart-7", customerSlug: null },
    ]);

    const done = await checkout.confirmCheckout(opened.sessionId);
    expect(done).toMatchObject({
      status: "completed",
      session: { status: "COMPLETED", activationInvoice: null, payment: null },
    });

    const state = double.state();
    expect(state.customers).toMatchObject([
      { name: "ada@acme.test", billingEmail: "ada@acme.test" },
    ]);
    expect(state.customers[0]!.slug).toMatch(/^ada-acme-test-[0-9a-f]{6}$/);
    expect(state.instances).toMatchObject([
      { customerSlug: state.customers[0]!.slug, licenseSlug: "starter-v1" },
    ]);
    // A subscription on the free plan, and no card, no invoice, no provider.
    expect(state).toMatchObject({
      subscribed: true,
      free: true,
      plan: "starter-v1",
      status: "ACTIVE",
      cardOnFile: false,
      invoices: [],
      billingEmail: "ada@acme.test",
      checkoutSessions: [
        {
          status: "COMPLETED",
          customerSlug: state.customers[0]!.slug,
          instanceSlug: state.instances[0]!.slug,
        },
      ],
    });
    expect(double.events().map((each) => each.type)).toEqual([
      "checkout_session.started",
      "instance.billing.started",
      "checkout_session.completed",
    ]);

    // A closed session reads its outcome, and is not confirmed again.
    await expect(checkout.getCheckoutSession(opened.sessionId)).resolves.toMatchObject({
      status: "COMPLETED",
      customerSlug: state.customers[0]!.slug,
    });
    await expect(checkout.confirmCheckout(opened.sessionId)).rejects.toMatchObject({
      status: 409,
      code: "ConfirmCheckoutSession.SessionClosed",
    });

    // Each credential went to its own routes, and only there.
    const kinds = double
      .calls()
      .filter((each) => each.path.startsWith("/public/checkout-sessions"))
      .map((each) => `${each.method} ${each.credential}`);
    // (The client keeps what it saw of a closed session, so the two calls after the close never left.)
    expect(kinds).toEqual(["POST pk_", "POST ksc_"]);
    // Neither the Turnstile token nor the ksc_ is in the log.
    expect(JSON.stringify(double.calls())).not.toContain("XXXX.DUMMY");
    expect(JSON.stringify(double.calls())).not.toContain("ksc_" + "c");
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("sells a paid plan: the provider's page first, then the payment, and the plan once it is paid", async () => {
    const { double, recorder, checkout, start, saveCard } = visitorShop();
    const opened = await start(PRO_MONTHLY, {
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
    });
    expect(opened).toMatchObject({
      dueToday: { subtotal: 6900, total: 6900 },
      requiresPaymentMethod: true,
    });

    const first = await checkout.confirmCheckout(opened.sessionId);
    if (first.status !== "requires_payment_method") throw new Error("a setup page was expected");
    expect(first.setupUrl).toContain(`${DOUBLE_PATH}/provider/setup/`);
    expect(double.state()).toMatchObject({ customers: [], cardOnFile: false });
    // Confirmed again before the card is saved: the same page.
    const again = await checkout.confirmCheckout(opened.sessionId);
    expect(again).toMatchObject({ status: "requires_payment_method", setupUrl: first.setupUrl });

    // The provider's page sends the visitor back to the page they left, naming the session.
    const back = await saveCard(first.setupUrl);
    expect(back.origin + back.pathname).toBe(RETURN_URL);
    expect(back.searchParams.get("kaiten_checkout_session")).toBe(opened.sessionId);
    expect(back.searchParams.has("kaiten_setup_session")).toBe(false);
    // The card belongs to a customer that does not exist yet.
    expect(double.state().cardOnFile).toBe(false);

    const paid = await checkout.confirmCheckout(opened.sessionId);
    expect(paid).toMatchObject({
      status: "completed",
      session: {
        status: "COMPLETED",
        payment: { status: "paid" },
        activationInvoice: { kind: "ACTIVATION", status: "PAID", total: 6900 },
      },
    });
    const state = double.state();
    expect(state).toMatchObject({
      subscribed: true,
      plan: "pro-v2",
      status: "ACTIVE",
      cardOnFile: true,
      card: "Visa 4242",
      billingEmail: "ada@acme.test",
      invoices: [{ kind: "ACTIVATION", status: "PAID", total: 6900 }],
    });
    // The instance moved from the free plan it started on to the one it bought.
    expect(state.instances).toMatchObject([{ licenseSlug: "pro-v2" }]);
    expect(double.events().map((each) => each.type)).toEqual([
      "checkout_session.started",
      "customer.payment_method.attached",
      "instance.invoice.issued",
      "instance.invoice.paid",
      "instance.billing.started",
      "checkout_session.completed",
    ]);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("keeps the instance on the free plan while the payment waits, and moves it when the invoice is paid", async () => {
    const { double, recorder, checkout, start, saveCard } = visitorShop();
    double.payment("requires_action");
    const opened = await start(PRO_MONTHLY);
    const setup = await checkout.confirmCheckout(opened.sessionId);
    if (setup.status !== "requires_payment_method") throw new Error("a setup page was expected");
    await saveCard(setup.setupUrl);

    const waiting = await checkout.confirmCheckout(opened.sessionId);
    expect(waiting).toMatchObject({
      status: "awaiting_payment",
      session: {
        status: "AWAITING_PAYMENT",
        payment: { status: "requires_action" },
        activationInvoice: { status: "PAYMENT_FAILED" },
      },
    });
    expect(double.state()).toMatchObject({
      subscribed: false,
      plan: "starter-v1",
      instances: [{ licenseSlug: "starter-v1" }],
    });
    // Confirmed again while it waits: the session as it is, and no second customer.
    await expect(checkout.confirmCheckout(opened.sessionId)).resolves.toMatchObject({
      status: "awaiting_payment",
    });
    expect(double.state().customers).toHaveLength(1);

    // The visitor confirms the payment on the invoice's page.
    const invoice = double.state().invoices[0]!;
    expect(double.payInvoice(invoice.id)).toBe(true);
    await expect(checkout.getCheckoutSession(opened.sessionId)).resolves.toMatchObject({
      status: "COMPLETED",
      payment: { status: "paid" },
    });
    expect(double.state()).toMatchObject({
      subscribed: true,
      plan: "pro-v2",
      instances: [{ licenseSlug: "pro-v2" }],
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("a payment that is declined leaves the session waiting, and its expiry closes it with the customer left on the free plan", async () => {
    const { double, checkout, start, saveCard } = visitorShop();
    double.payment("failed");
    const opened = await start(PRO_MONTHLY);
    const setup = await checkout.confirmCheckout(opened.sessionId);
    if (setup.status !== "requires_payment_method") throw new Error("a setup page was expected");
    await saveCard(setup.setupUrl);
    await expect(checkout.confirmCheckout(opened.sessionId)).resolves.toMatchObject({
      status: "awaiting_payment",
      session: { payment: { status: "failed" } },
    });

    expect(double.expireCheckout()).toMatchObject({ ok: true, status: "EXPIRED" });
    await expect(checkout.getCheckoutSession(opened.sessionId)).resolves.toMatchObject({
      status: "EXPIRED",
      customerSlug: expect.any(String),
    });
    expect(double.state()).toMatchObject({ subscribed: false, plan: "starter-v1" });
    expect(double.events().at(-1)).toMatchObject({ type: "checkout_session.abandoned" });
  });

  test("starts a trial with nothing to pay, a card first when the plan asks for one, and one trial per address and family", async () => {
    const { double, recorder, checkout, start, saveCard } = visitorShop();

    // Lite: a trial, and no payment method asked for. The session completes at the first confirm.
    const lite = await start(LITE_FAMILY_PRICE);
    expect(lite).toMatchObject({
      dueToday: { total: 0 },
      requiresPaymentMethod: false,
      trialRefusedReason: null,
      trialEndsAt: expect.any(String),
    });
    await expect(checkout.confirmCheckout(lite.sessionId)).resolves.toMatchObject({
      status: "completed",
      session: { trialEndsAt: lite.trialEndsAt, payment: null },
    });
    expect(double.state()).toMatchObject({
      status: "TRIAL",
      plan: "lite-v1",
      cardOnFile: false,
      invoices: [],
    });

    // The same address, the same family: no trial, the first period is due today.
    const second = await start(LITE_FAMILY_PRICE);
    expect(second).toMatchObject({
      trialEndsAt: null,
      trialRefusedReason: "ALREADY_CONSUMED",
      dueToday: { total: 1900 },
      requiresPaymentMethod: true,
    });
    // Another address, or another family, is not refused its trial.
    await expect(start(LITE_FAMILY_PRICE, { email: "grace@acme.test" })).resolves.toMatchObject({
      trialRefusedReason: null,
    });
    await expect(start(GROWTH_MONTHLY)).resolves.toMatchObject({ trialRefusedReason: null });
    // The visitor can decline a trial too.
    await expect(
      start(LITE_FAMILY_PRICE, { email: "grace@acme.test", trial: false }),
    ).resolves.toMatchObject({ trialEndsAt: null, dueToday: { total: 1900 } });

    // Growth asks for a card, and then starts its trial with nothing charged.
    double.reset({ anonymousCheckout: true, signUp: true });
    const growth = await start(GROWTH_MONTHLY);
    expect(growth).toMatchObject({ dueToday: { total: 0 }, requiresPaymentMethod: true });
    const setup = await checkout.confirmCheckout(growth.sessionId);
    if (setup.status !== "requires_payment_method") throw new Error("a setup page was expected");
    await saveCard(setup.setupUrl);
    await expect(checkout.confirmCheckout(growth.sessionId)).resolves.toMatchObject({
      status: "completed",
      session: { trialEndsAt: growth.trialEndsAt },
    });
    expect(double.state()).toMatchObject({
      status: "TRIAL",
      plan: "growth-v1",
      cardOnFile: true,
      invoices: [],
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("reprices a session whose trial another checkout used up, and refuses to once a card was saved for the amount shown", async () => {
    const { double, checkout, start, saveCard } = visitorShop();
    const first = await start(GROWTH_MONTHLY);
    const second = await start(GROWTH_MONTHLY);
    const setup = await checkout.confirmCheckout(first.sessionId);
    if (setup.status !== "requires_payment_method") throw new Error("a setup page was expected");
    await saveCard(setup.setupUrl);
    await checkout.confirmCheckout(first.sessionId);

    // Before its setup, the second session goes on without the trial, at the full price.
    const repriced = await checkout.confirmCheckout(second.sessionId);
    expect(repriced).toMatchObject({
      status: "requires_payment_method",
      session: {
        trialEndsAt: null,
        trialRefusedReason: "ALREADY_CONSUMED",
        dueToday: { total: 9900 },
      },
    });
    await expect(checkout.getCheckoutSession(second.sessionId)).resolves.toMatchObject({
      dueToday: { total: 9900 },
    });
    expect(double.state().customers).toHaveLength(1);

    // After one, with the trial used up between two confirms, it asks the visitor to start again.
    double.reset({ anonymousCheckout: true, signUp: true });
    const third = await start(GROWTH_MONTHLY, { email: "grace@acme.test" });
    const fourth = await start(GROWTH_MONTHLY, { email: "grace@acme.test" });
    const page = await checkout.confirmCheckout(fourth.sessionId);
    if (page.status !== "requires_payment_method") throw new Error("a setup page was expected");
    await saveCard(page.setupUrl);
    const sibling = await checkout.confirmCheckout(third.sessionId);
    if (sibling.status !== "requires_payment_method") throw new Error("a setup page was expected");
    await saveCard(sibling.setupUrl);
    await checkout.confirmCheckout(third.sessionId);
    await expect(checkout.confirmCheckout(fourth.sessionId)).rejects.toMatchObject({
      status: 409,
      code: "ConfirmCheckoutSession.DueTodayChanged",
    });
  });

  test("says what the security check came to as Kaiten does, for as many verifications as a test scripts", async () => {
    const { double, recorder, checkout, start } = visitorShop();

    double.turnstile("fail", 1);
    await expect(start(STARTER_PRICE)).rejects.toMatchObject({
      status: 422,
      code: "CreateCheckoutSession.TurnstileFailed",
      name: "TurnstileFailedError",
    });
    // Nothing was written, and the next verification passes again.
    expect(double.state().checkoutSessions).toEqual([]);
    await expect(start(STARTER_PRICE)).resolves.toMatchObject({ status: "open" });

    double.turnstile("unavailable", 1);
    await expect(start(STARTER_PRICE)).rejects.toMatchObject({
      status: 503,
      code: "CreateCheckoutSession.TurnstileUnavailable",
      retryAfterSeconds: 30,
    });
    double.turnstile("unconfigured");
    for (const _ of [1, 2]) {
      await expect(start(STARTER_PRICE)).rejects.toMatchObject({
        status: 422,
        code: "CreateCheckoutSession.TurnstileNotConfigured",
      });
    }
    double.turnstile("pass");
    await expect(
      checkout.startCheckout({ turnstileToken: token(), priceId: STARTER_PRICE, dryRun: true }),
    ).resolves.toMatchObject({ status: "preview" });
    expect(double.state().turnstileChecks).toBe(6);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("takes a Turnstile token once, a preview's included, as Cloudflare does", async () => {
    const { double, recorder, checkout } = visitorShop();
    const spent = token();
    // A preview spends the token like a start: the page that previews and then starts needs two.
    await expect(
      checkout.startCheckout({ turnstileToken: spent, priceId: PRO_MONTHLY, dryRun: true }),
    ).resolves.toMatchObject({ status: "preview" });
    await expect(
      checkout.startCheckout({
        turnstileToken: spent,
        priceId: PRO_MONTHLY,
        email: "ada@acme.test",
        returnUrl: RETURN_URL,
      }),
    ).rejects.toMatchObject({ status: 422, code: "CreateCheckoutSession.TurnstileFailed" });
    expect(double.state().checkoutSessions).toEqual([]);
    expect(double.state().turnstileReused).toBe(1);

    // A token the check refused is spent too, and a new one goes through.
    double.turnstile("fail", 1);
    const refused = token();
    await expect(
      checkout.startCheckout({ turnstileToken: refused, priceId: PRO_MONTHLY, dryRun: true }),
    ).rejects.toMatchObject({ code: "CreateCheckoutSession.TurnstileFailed" });
    await expect(
      checkout.startCheckout({ turnstileToken: refused, priceId: PRO_MONTHLY, dryRun: true }),
    ).rejects.toMatchObject({ code: "CreateCheckoutSession.TurnstileFailed" });
    expect(double.state().turnstileReused).toBe(2);
    await expect(
      checkout.startCheckout({ turnstileToken: token(), priceId: PRO_MONTHLY, dryRun: true }),
    ).resolves.toMatchObject({ status: "preview" });

    // A check that could not be made spends nothing: the same token goes through once it can.
    double.turnstile("unavailable", 1);
    const waited = token();
    await expect(
      checkout.startCheckout({ turnstileToken: waited, priceId: PRO_MONTHLY, dryRun: true }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      checkout.startCheckout({ turnstileToken: waited, priceId: PRO_MONTHLY, dryRun: true }),
    ).resolves.toMatchObject({ status: "preview" });
    expect(double.state().turnstileReused).toBe(2);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("prices a preview and writes nothing, and takes a plan by its version and period", async () => {
    const { double, recorder, checkout } = visitorShop();
    const preview = await checkout.startCheckout({
      turnstileToken: token(),
      licenseSlug: "pro-v2",
      billingPeriod: "ANNUAL",
      dryRun: true,
    });
    expect(preview).toMatchObject({
      status: "preview",
      dueToday: { total: 49000 },
      requiresPaymentMethod: true,
    });
    expect(double.state().checkoutSessions).toEqual([]);
    expect(double.events()).toEqual([]);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("refuses what Kaiten refuses at the start, with its codes, and every refusal fits the contract", async () => {
    const { double, recorder, start, raw } = visitorShop();
    const post = async (json: unknown, headers: Record<string, string> = {}) => {
      const spends =
        typeof json === "object" &&
        json !== null &&
        typeof (json as { turnstileToken?: unknown }).turnstileToken === "string" &&
        (json as { turnstileToken: string }).turnstileToken !== "";
      const response = await raw("/public/checkout-sessions", {
        method: "POST",
        headers: { "X-Kaiten-Publishable-Key": PUBLISHABLE_KEY, ...headers },
        // A body that is refused for something other than its token is not refused for a spent one.
        json: spends ? { ...(json as object), turnstileToken: token() } : json,
      });
      return { status: response.status, body: (await response.json()) as any };
    };
    const valid = {
      turnstileToken: token(),
      priceId: PRO_MONTHLY,
      email: "ada@acme.test",
      returnUrl: RETURN_URL,
    };

    // The shape of the body.
    for (const body of [
      { priceId: PRO_MONTHLY },
      { ...valid, surprise: true },
      { ...valid, email: 12 },
      { ...valid, turnstileToken: "" },
      { ...valid, addOns: [{ addonSlug: "extra-seats-v1", quantity: 0 }] },
      "not an object",
    ]) {
      const refused = await post(body);
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: "CreateCheckoutSession.InvalidBody" });
    }
    // The contract asks for a token and a reference that are not empty, and for no more: an empty
    // e-mail or price fits the schema, and is refused for what it is.
    await expect(post({ ...valid, clientReferenceId: "" })).resolves.toMatchObject({
      status: 422,
      body: { code: "CreateCheckoutSession.InvalidBody" },
    });
    await expect(post({ ...valid, email: "" })).resolves.toMatchObject({
      status: 422,
      body: { code: "CreateCheckoutSession.InvalidEmail" },
    });
    await expect(post({ ...valid, priceId: "" })).resolves.toMatchObject({
      status: 422,
      body: { code: "CreateCheckoutSession.InvalidPriceSelection" },
    });
    await expect(post({ ...valid, voucherCode: "" })).resolves.not.toMatchObject({
      body: { code: "CreateCheckoutSession.InvalidBody" },
    });
    // The price.
    await expect(post({ ...valid, priceId: undefined })).resolves.toMatchObject({
      status: 422,
      body: { code: "CreateCheckoutSession.InvalidPriceSelection" },
    });
    await expect(
      post({ ...valid, licenseSlug: "pro-v2", billingPeriod: "MONTHLY" }),
    ).resolves.toMatchObject({
      body: { code: "CreateCheckoutSession.InvalidPriceSelection" },
    });
    await expect(
      post({ ...valid, priceId: "00000000-0000-4000-8000-0000000000ff" }),
    ).resolves.toMatchObject({ body: { code: "CreateCheckoutSession.PriceNotPublic" } });
    await expect(
      post({ ...valid, priceId: "00000000-0000-4000-8000-000000000206" }),
    ).resolves.toMatchObject({
      body: { code: "CreateCheckoutSession.PriceNotFlatFee" },
    });
    // The add-ons.
    await expect(
      post({
        ...valid,
        priceId: GROWTH_MONTHLY,
        addOns: [{ addonSlug: "gpu-pack-v1", quantity: 1 }],
      }),
    ).resolves.toMatchObject({ body: { code: "CreateCheckoutSession.AddonNotPublic" } });
    await expect(
      post({ ...valid, addOns: [{ addonSlug: "gpu-pack-v1", quantity: 1 }] }),
    ).resolves.toMatchObject({ body: { code: "CreateCheckoutSession.CurrencyMismatch" } });
    await expect(
      post({ ...valid, addOns: [{ addonSlug: "extra-seats-v1", quantity: 51 }] }),
    ).resolves.toMatchObject({ body: { code: "CreateCheckoutSession.QuantityExceedsMax" } });
    await expect(
      post({
        ...valid,
        priceId: STARTER_PRICE,
        addOns: [{ addonSlug: "extra-seats-v1", quantity: 1 }],
      }),
    ).resolves.toMatchObject({ body: { code: "CreateCheckoutSession.AddonNotPublic" } });
    // The visitor.
    await expect(post({ ...valid, email: "nope" })).resolves.toMatchObject({
      body: { code: "CreateCheckoutSession.InvalidEmail" },
    });
    await expect(post({ ...valid, email: undefined })).resolves.toMatchObject({
      body: { code: "CreateCheckoutSession.InvalidEmail" },
    });
    await expect(post({ ...valid, returnUrl: undefined })).resolves.toMatchObject({
      body: { code: "CreateCheckoutSession.InvalidReturnUrl" },
    });
    await expect(post({ ...valid, returnUrl: "http://shop.test/checkout" })).resolves.toMatchObject(
      {
        body: { code: "CreateCheckoutSession.InvalidReturnUrl" },
      },
    );
    await expect(
      post({ ...valid, returnUrl: "https://other.test/checkout" }, { Origin: ORIGIN }),
    ).resolves.toMatchObject({ body: { code: "CreateCheckoutSession.InvalidReturnUrl" } });
    // A voucher: Kaiten refuses every code of a visitor it knows nothing of.
    await expect(post({ ...valid, voucherCode: "WELCOME20" })).resolves.toMatchObject({
      status: 422,
      body: { code: "CreateCheckoutSession.VoucherInvalid" },
    });
    // The credential.
    await expect(post(valid, { Authorization: `Bearer ${SERVER_TOKEN}` })).resolves.toMatchObject({
      status: 403,
      body: { code: "Auth.WrongCredentialKind" },
    });
    await expect(
      post(valid, { "X-Kaiten-Publishable-Key": `pk_${"x".repeat(43)}` }),
    ).resolves.toMatchObject({
      status: 401,
      body: { code: "PublicAuth.InvalidCredential" },
    });

    // A paid plan needs a free plan to start the instance on; a catalogue without one has none to offer.
    const plans = (acmeCatalog.plans as any[]).filter((plan) => plan.pricingType !== "FREE");
    const lone = world({ ...acmeCatalog, plans });
    lone.double.reset({ anonymousCheckout: true });
    const loneStart = await lone.double.route(
      new Request(`${API}/public/checkout-sessions`, {
        method: "POST",
        headers: {
          "X-Kaiten-Publishable-Key": PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...valid, dryRun: true }),
      }),
    );
    expect(loneStart?.status).toBe(422);
    expect(await loneStart!.json()).toMatchObject({
      code: "CreateCheckoutSession.FallbackRequired",
    });
    // But a trial with nothing due needs none.
    await start(GROWTH_MONTHLY);

    // Of everything refused above, nothing was written; the one session is the trial's.
    expect(double.state().checkoutSessions).toHaveLength(1);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("is sent bodies that fit the contract's draft by its own client", async () => {
    const { double, checkout } = visitorShop();
    await checkout.startCheckout({
      turnstileToken: token(),
      licenseSlug: "pro-v2",
      billingPeriod: "MONTHLY",
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 1 }],
      trial: false,
      email: "ada@acme.test",
      returnUrl: RETURN_URL,
      clientReferenceId: "cart-9",
    });
    await checkout.startCheckout({ turnstileToken: token(), priceId: PRO_MONTHLY, dryRun: true });
    const starts = double.calls().filter((each) => each.path === "/public/checkout-sessions");
    expect(starts).toHaveLength(2);
    for (const call of starts) {
      expect(schemaProblems("CheckoutSessionDraft", call.body)).toEqual([]);
      expect(call.body).toMatchObject({ turnstileToken: "\u2026" });
    }
  });

  test("refuses a credential of another class, another session's token and an unknown one on a session's routes", async () => {
    const { double, checkout, start, raw } = visitorShop();
    const one = await start(STARTER_PRICE);
    const two = await start(STARTER_PRICE, { email: "grace@acme.test" });
    const tokenOf = (sessionId: string) =>
      // The client keeps the token it was given; the stand-in's own state does not show it.
      (sessionId === one.sessionId ? one : two).token;
    const read = (sessionId: string, headers: Record<string, string>) =>
      raw(`/public/checkout-sessions/${sessionId}`, { headers });

    expect(
      (await read(one.sessionId, { Authorization: `Bearer ${tokenOf(one.sessionId)}` })).status,
    ).toBe(200);
    // Another session's id answers as an unknown token does.
    expect(
      (await read(two.sessionId, { Authorization: `Bearer ${tokenOf(one.sessionId)}` })).status,
    ).toBe(401);
    expect(
      (await read(one.sessionId, { Authorization: `Bearer ksc_${"z".repeat(43)}` })).status,
    ).toBe(401);
    expect((await read(one.sessionId, {})).status).toBe(401);
    // The wrong class: a publishable key, a customer's session, a server token.
    expect(
      (await read(one.sessionId, { "X-Kaiten-Publishable-Key": PUBLISHABLE_KEY })).status,
    ).toBe(403);
    expect(
      (await read(one.sessionId, { Authorization: `Bearer kst_${"z".repeat(43)}` })).status,
    ).toBe(403);
    expect((await read(one.sessionId, { Authorization: `Bearer ${SERVER_TOKEN}` })).status).toBe(
      403,
    );
    expect(double.state().customers).toEqual([]);
    expect(checkout.holdsCheckoutSession(one.sessionId)).toBe(true);
  });

  test("closes a session that waits for too long, and says how", async () => {
    const { double, recorder, checkout, start } = visitorShop();
    expect(double.expireCheckout()).toEqual({ ok: false });

    const opened = await start(PRO_MONTHLY);
    expect(double.expireCheckout()).toMatchObject({ ok: true, status: "ABANDONED" });
    await expect(checkout.getCheckoutSession(opened.sessionId)).resolves.toMatchObject({
      status: "ABANDONED",
      customerSlug: null,
    });
    await expect(checkout.confirmCheckout(opened.sessionId)).rejects.toMatchObject({
      status: 409,
      code: "ConfirmCheckoutSession.SessionClosed",
      name: "CheckoutSessionClosedError",
      sessionStatus: "ABANDONED",
    });
    expect(double.state().customers).toEqual([]);
    expect(double.events().at(-1)).toMatchObject({ type: "checkout_session.abandoned" });
    expect(double.expireCheckout()).toEqual({ ok: false });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("turned off after the start, it refuses the confirm", async () => {
    const { double, checkout, start } = visitorShop();
    const opened = await start(STARTER_PRICE);
    double.anonymousCheckout(false);
    await expect(checkout.confirmCheckout(opened.sessionId)).rejects.toMatchObject({
      status: 403,
      code: "ConfirmCheckoutSession.AnonymousCheckoutDisabled",
    });
    expect(double.state().customers).toEqual([]);
  });

  test("answers a scripted refusal on a session's routes, whichever session", async () => {
    const { double, checkout, start } = visitorShop();
    const opened = await start(STARTER_PRICE);
    double.script("POST /public/checkout-sessions/*/confirm", {
      status: 409,
      body: {
        title: "Conflict",
        status: 409,
        detail: "changed",
        code: "ConfirmCheckoutSession.DueTodayChanged",
      },
    });
    await expect(checkout.confirmCheckout(opened.sessionId)).rejects.toMatchObject({
      code: "ConfirmCheckoutSession.DueTodayChanged",
      name: "DueTodayChangedError",
    });
    // The next call is the stand-in's own.
    await expect(checkout.confirmCheckout(opened.sessionId)).resolves.toMatchObject({
      status: "completed",
    });
  });

  test("drives the controls over HTTP and refuses what makes no sense", async () => {
    const { call } = visitorShop();
    const post = (path: string, json?: unknown) =>
      call(`/control${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json ?? {}),
      });
    expect((await post("/anonymous-checkout", { enabled: "yes" })).status).toBe(400);
    expect((await post("/turnstile", { verdict: "maybe" })).status).toBe(400);
    expect((await post("/turnstile", { verdict: "fail", times: 0 })).status).toBe(400);
    expect((await post("/checkout-sessions/expire")).status).toBe(409);
    expect((await post("/anonymous-checkout", { enabled: false })).status).toBe(200);
    expect((await post("/turnstile", { verdict: "fail", times: 2 })).status).toBe(200);
    expect((await post("/reset", { anonymousCheckout: true })).status).toBe(200);
    expect(await (await call("/control/state")).json()).toMatchObject({
      anonymousCheckout: true,
      turnstileChecks: 0,
    });
  });
});

describe("the vendor's reads and updates of a customer and an instance, against the stand-in", () => {
  const KAITEN_ID = "00000000-0000-0000-0000-000000000001";
  const RETURN_URL = `${ORIGIN}/checkout/starter-v1`;
  let tokens = 0;

  /** A customer and an instance that a completed anonymous checkout made, and one a service made. */
  async function shop() {
    const made = world();
    made.double.reset({ anonymousCheckout: true, signUp: true });
    const checkout = new KaitenAnonymousCheckoutClient({
      apiUrl: API,
      publishableKey: PUBLISHABLE_KEY,
      fetch: made.recorder.fetch,
      storage: null,
    });
    const opened = await checkout.startCheckout({
      turnstileToken: `XXXX.DUMMY.TOKEN.${++tokens}`,
      priceId: STARTER_MONTHLY,
      email: "ada@acme.test",
      returnUrl: RETURN_URL,
    });
    await checkout.confirmCheckout(opened.sessionId);
    const [bought] = made.double.state().customers;
    const [boughtInstance] = made.double.state().instances;
    const stranger = createKaitenClient({
      baseUrl: API,
      token: `ksh_${"x".repeat(43)}`,
      fetch: made.recorder.fetch,
    });
    return { ...made, bought: bought!, boughtInstance: boughtInstance!, stranger };
  }

  test("reads what a checkout made: Kaiten's own identity made it, and the address is its name", async () => {
    const { recorder, server, bought, boughtInstance } = await shop();
    const { data: customer } = await Customers.getCustomer({
      client: server,
      throwOnError: true,
      path: { customerSlug: bought.slug },
    });
    expect(customer).toMatchObject({
      name: "ada@acme.test",
      billingEmail: "ada@acme.test",
      slug: bought.slug,
      createdBy: { id: KAITEN_ID, name: "Kaiten" },
      updatedBy: { id: KAITEN_ID },
    });
    const { data: instance } = await Instances.getInstance({
      client: server,
      throwOnError: true,
      path: { instanceSlug: boughtInstance.slug },
    });
    expect(instance).toMatchObject({
      name: "ada@acme.test",
      description: "",
      customerSlug: bought.slug,
      customerId: customer.id,
      licenseSlug: "starter-v1",
      createdBy: { id: KAITEN_ID },
    });
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("a customer a service made says so: it is not Kaiten's", async () => {
    const { recorder, server } = await shop();
    const { data: made } = await Customers.createCustomer({
      client: server,
      throwOnError: true,
      body: { name: "Initech", billingEmail: "billing@initech.test" },
    });
    const { data: read } = await Customers.getCustomer({
      client: server,
      throwOnError: true,
      path: { customerSlug: made.slug! },
    });
    expect(read.createdBy.id).not.toBe(KAITEN_ID);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("a customer's omitted/null PUT members keep their values; empty strings clear them", async () => {
    const { double, recorder, server, bought } = await shop();
    const update = (body: Record<string, unknown>) =>
      Customers.updateCustomer({
        client: server,
        throwOnError: true,
        path: { customerSlug: bought.slug },
        body: body as never,
      });
    const read = async () =>
      (
        await Customers.getCustomer({
          client: server,
          throwOnError: true,
          path: { customerSlug: bought.slug },
        })
      ).data;

    await update({ name: "Analytical Engines", domain: "engines.test", externalCustomerId: "x-1" });
    expect(await read()).toMatchObject({
      name: "Analytical Engines",
      domain: "engines.test",
      externalCustomerId: "x-1",
      // Omitted: kept.
      billingEmail: "ada@acme.test",
      // Made by Kaiten, changed by the service account.
      createdBy: { id: KAITEN_ID },
      updatedBy: { name: "Storefront service account" },
    });
    expect(double.state().customers).toMatchObject([{ name: "Analytical Engines" }]);

    // Sent again with the slug on record: omitted members keep their stored values.
    await update({ name: "Analytical Engines Ltd", slug: bought.slug });
    const kept = await read();
    expect(kept).toMatchObject({
      name: "Analytical Engines Ltd",
      domain: "engines.test",
      externalCustomerId: "x-1",
    });
    await update({ name: "Analytical Engines Ltd", billingEmail: null, externalCustomerId: null });
    expect(await read()).toMatchObject({
      billingEmail: "ada@acme.test",
      externalCustomerId: "x-1",
      domain: "engines.test",
    });

    // An empty address removes it.
    await update({
      name: "Analytical Engines Ltd",
      billingEmail: "",
      domain: "",
      externalCustomerId: "",
    });
    const cleared = await read();
    expect(cleared).not.toHaveProperty("billingEmail");
    expect(cleared).not.toHaveProperty("domain");
    expect(cleared).not.toHaveProperty("externalCustomerId");
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("refuses what Kaiten refuses to a customer's update, and nothing that was refused is kept", async () => {
    const { double, recorder, server, stranger, bought } = await shop();
    const put = (client: typeof server, slug: string, body: Record<string, unknown>) =>
      Customers.updateCustomer({
        client,
        throwOnError: true,
        path: { customerSlug: slug },
        body: body as never,
      });

    await expect(put(server, bought.slug, { name: "" })).rejects.toMatchObject({
      status: 422,
      code: "UpdateCustomer.InvalidName",
    });
    await expect(
      put(server, bought.slug, { name: "x", slug: "another-slug" }),
    ).rejects.toMatchObject({ status: 422, code: "UpdateCustomer.SlugNotRenameable" });
    await expect(
      put(server, bought.slug, {
        name: "x",
        integrations: { attio: { id: "a", syncStatus: "OK" } },
      }),
    ).rejects.toMatchObject({ status: 422, code: "UpdateCustomer.IntegrationsNotSettable" });
    await expect(
      put(server, bought.slug, { name: "x", billingEmail: "nope" }),
    ).rejects.toMatchObject({ status: 422, code: "UpdateCustomer.InvalidBillingEmail" });
    // The schema is closed: a member it does not list is refused, and so is a domain that is not one.
    await expect(
      put(server, bought.slug, { name: "x", favouriteColour: "green" }),
    ).rejects.toMatchObject({ status: 422, code: "UpdateCustomer.InvalidBody" });
    await expect(
      put(server, bought.slug, { name: "x", domain: "Not A Domain" }),
    ).rejects.toMatchObject({ status: 422, code: "UpdateCustomer.InvalidDomain" });
    await expect(put(server, "nobody", { name: "x" })).rejects.toMatchObject({
      status: 404,
      code: "UpdateCustomer.NotFound",
    });
    await expect(
      Customers.getCustomer({
        client: server,
        throwOnError: true,
        path: { customerSlug: "nobody" },
      }),
    ).rejects.toMatchObject({ status: 404, code: "GetCustomer.NotFound" });
    await expect(put(stranger, bought.slug, { name: "x" })).rejects.toMatchObject({ status: 401 });
    await expect(
      Customers.getCustomer({
        client: stranger,
        throwOnError: true,
        path: { customerSlug: bought.slug },
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(double.state().customers).toMatchObject([{ name: "ada@acme.test" }]);
    expect(contractProblems(recorder)).toEqual([]);
  });

  test("renames an instance by a full replacement, and refuses what it will not move", async () => {
    const { double, recorder, server, stranger, bought, boughtInstance } = await shop();
    const read = async () =>
      (
        await Instances.getInstance({
          client: server,
          throwOnError: true,
          path: { instanceSlug: boughtInstance.slug },
        })
      ).data;
    const before = await read();
    const body = (extra: Record<string, unknown> = {}) => ({
      name: "Analytical Engines",
      description: "Contact: Ada Lovelace",
      customerId: before.customerId,
      licenseId: before.licenseId,
      startLicenseDate: before.startLicenseDate,
      endLicenseDate: before.endLicenseDate,
      ...extra,
    });
    const put = (client: typeof server, slug: string, content: Record<string, unknown>) =>
      Instances.updateInstance({
        client,
        throwOnError: true,
        path: { instanceSlug: slug },
        body: content as never,
      });

    await put(server, boughtInstance.slug, body({ metadata: { plan: "gold" } }));
    expect(await read()).toMatchObject({
      name: "Analytical Engines",
      description: "Contact: Ada Lovelace",
      customerSlug: bought.slug,
      licenseSlug: "starter-v1",
      metadata: { plan: "gold" },
      createdBy: { id: KAITEN_ID },
      updatedBy: { name: "Storefront service account" },
    });
    expect(double.state().instances).toMatchObject([
      { name: "Analytical Engines", description: "Contact: Ada Lovelace" },
    ]);
    // A repeated replacement changes nothing more.
    await put(server, boughtInstance.slug, body({ slug: boughtInstance.slug }));

    await expect(put(server, boughtInstance.slug, body({ name: "" }))).rejects.toMatchObject({
      status: 422,
      code: "UpdateInstance.InvalidBody",
    });
    await expect(
      put(server, boughtInstance.slug, body({ description: undefined })),
    ).rejects.toMatchObject({ status: 422, code: "UpdateInstance.InvalidBody" });
    await expect(
      put(server, boughtInstance.slug, body({ integrations: { x: { id: "y" } } })),
    ).rejects.toMatchObject({ status: 422, code: "UpdateInstance.IntegrationsNotSettable" });
    await expect(
      put(server, boughtInstance.slug, body({ favouriteColour: "green" })),
    ).rejects.toMatchObject({ status: 422, code: "UpdateInstance.InvalidBody" });
    await expect(
      put(server, boughtInstance.slug, body({ customerId: randomUUID() })),
    ).rejects.toMatchObject({ status: 409, code: "UpdateInstance.BillingFrozen" });
    await expect(put(server, "nothing-here", body())).rejects.toMatchObject({
      status: 404,
      code: "UpdateInstance.NotFound",
    });
    await expect(
      Instances.getInstance({
        client: server,
        throwOnError: true,
        path: { instanceSlug: "nothing-here" },
      }),
    ).rejects.toMatchObject({ status: 404, code: "GetInstance.NotFound" });
    await expect(put(stranger, boughtInstance.slug, body())).rejects.toMatchObject({ status: 401 });

    expect(double.state().instances).toMatchObject([{ name: "Analytical Engines" }]);
    expect(contractProblems(recorder)).toEqual([]);
  });
});
