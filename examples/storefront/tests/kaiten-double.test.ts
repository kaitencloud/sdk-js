// The stand-in for Kaiten, held to what it stands in for: the conformance suite's journey, which
// takes a customer from the catalogue to a revoked session and holds each answer to the API
// contract, runs against it; and so does every other answer these tests make it give. A stand-in
// that drifted from the contract would pass the storefront's end-to-end tests for a Kaiten that
// does not exist.

import { KaitenClient, KaitenError, KaitenSessionClient } from "@kaitencloud/client";
import { createKaitenClient, CustomerSessions } from "@kaitencloud/server";
import { describe, expect, test } from "vite-plus/test";

import type { Configuration } from "../../conformance/src/configuration.ts";
import { Journey } from "../../conformance/src/journey.ts";
import { contractProblemsOf, recordingFetch } from "../../conformance/src/recording.ts";
import { createKaitenDouble, DOUBLE_PATH, type Call } from "../server/double/kaiten-double.ts";

const ORIGIN = "https://storefront.test";
const API = `${ORIGIN}${DOUBLE_PATH}/api`;
const PUBLISHABLE_KEY = `pk_${"p".repeat(43)}`;
const SERVER_TOKEN = `ksh_${"s".repeat(43)}`;
const PRO_MONTHLY = "00000000-0000-4000-8000-000000000201";
const GROWTH_MONTHLY = "00000000-0000-4000-8000-000000000301";

function world() {
  const double = createKaitenDouble({ serverToken: SERVER_TOKEN, publishableKey: PUBLISHABLE_KEY });
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
    const { double, recorder } = world();
    void recorder;
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

    // A customer with no email, then one with: the checkout is priced, sent to the provider, and made.
    await expect(
      session.checkout({ licensePriceId: PRO_MONTHLY, dryRun: true }),
    ).rejects.toMatchObject({
      status: 422,
      code: "CreateSessionCheckout.BillingEmailRequired",
    });
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
        expect(await (await call(`/provider/invoice/${id}`)).text()).toContain("Confirm payment");
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

    // What is not the stand-in's is not answered: the storefront's own routes and its pages are another's.
    expect(
      await double.route(new Request(`${ORIGIN}/storefront-api/session`, { method: "POST" })),
    ).toBeUndefined();
    expect(await double.route(new Request(`${ORIGIN}/portal`))).toBeUndefined();
  });
});
