// The stand-in for Kaiten, held to what it stands in for: the conformance suite's journey, which
// takes a customer from the catalogue to a revoked session and holds each answer to the API
// contract, runs against it; and so does every other answer these tests make it give. A stand-in
// that drifted from the contract would pass the storefront's end-to-end tests for a Kaiten that
// does not exist.

import { randomUUID } from "node:crypto";

import { KaitenClient, KaitenError, KaitenSessionClient } from "@kaitencloud/client";
import { Billing, createKaitenClient, CustomerSessions } from "@kaitencloud/server";
import { describe, expect, test } from "vite-plus/test";

import type { Configuration } from "../../conformance/src/configuration.ts";
import { Journey } from "../../conformance/src/journey.ts";
import { contractProblemsOf, recordingFetch } from "../../conformance/src/recording.ts";
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

    // A customer with no email: a preview is priced without one (Kaiten: Δ2.12), the checkout
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

describe("checkout from a free plan (V31-68)", () => {
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
    // No fallback is played (V31-66): the instance keeps the plan it had.
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
  test("an increase is in force at once and billed at the next renewal, a removal leaves the portal", async () => {
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
          currency: "EUR",
          unitAmount: 90,
          unitAmountDecimal: "90",
          metered: { entitlementSlug: "gpu-hours", saleUnitFactor: "1" },
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
