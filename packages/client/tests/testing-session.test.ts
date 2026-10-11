import { describe, expect, test } from "vite-plus/test";

import { KaitenError } from "../src/index.ts";
import type { KaitenSessionClientLike } from "../src/index.ts";
import {
  createMockKaitenSessionClient,
  demoCheckoutPrices,
  demoPortal,
  demoSessionAddOns,
  demoSessionInvoices,
  demoUnsubscribedPortal,
} from "../src/testing/index.ts";
import { answer } from "./support/session-answers.ts";
import { json, open, useSessionClock } from "./support/session-harness.ts";

useSessionClock();

const GROWTH_MONTHLY = "price_growth_monthly";
const STARTER_MONTHLY = "price_starter_monthly";
const RETURN = "https://app.acme.example/billing";

/** What a host takes: any client of the session routes. */
async function renderBilling(session: KaitenSessionClientLike) {
  const portal = await session.getPortal();
  return portal.subscription?.status ?? "none";
}

const refusedWith = async (call: Promise<unknown>) => {
  const error = await call.catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(KaitenError);
  return error as KaitenError;
};

describe("fixtures", () => {
  test("each call returns a fresh object graph", () => {
    expect(demoPortal()).not.toBe(demoPortal());
    expect(demoPortal().subscription).not.toBe(demoPortal().subscription);
    expect(demoSessionInvoices()).not.toBe(demoSessionInvoices());
    expect(demoSessionAddOns()[0]).not.toBe(demoSessionAddOns()[0]);
  });

  // The members of a portal are the ones the client reads from the API: a demo
  // that drifted from them would let a component pass against it and fail on
  // the real thing.
  test("the demo portal and invoices have the members the client builds from the API", async () => {
    const { client } = open(() => json(answer("portal")));
    const real = await client.getPortal();
    const demo = demoPortal();
    const keys = (value: object | null | undefined) => Object.keys(value ?? {}).sort();

    expect(keys(demo)).toEqual(keys(real));
    expect(keys(demo.customer)).toEqual(keys(real.customer));
    expect(keys(demo.instance)).toEqual(keys(real.instance));
    expect(keys(demo.subscription)).toEqual(keys(real.subscription));
    expect(keys(demo.paymentMethod)).toEqual(keys(real.paymentMethod));
    expect(keys(demo.upcomingInvoice)).toEqual(keys(real.upcomingInvoice));
    expect(keys(demo.capabilities)).toEqual(keys(real.capabilities));
    expect(keys(demo.addOns[0])).toEqual(keys(real.addOns[0]));

    const { client: invoiceClient } = open(() => json(answer("invoicesFirstPage")));
    const [invoice] = (await invoiceClient.listInvoices()).items;
    const [demoInvoice] = demoSessionInvoices();
    expect(keys(demoInvoice)).toEqual(keys(invoice));
    expect(keys(demoInvoice?.lines[0])).toEqual(keys(invoice?.lines[0]));
  });

  test("the unsubscribed portal offers a checkout and nothing to cancel", () => {
    expect(demoUnsubscribedPortal()).toMatchObject({
      subscription: null,
      paymentMethod: null,
      capabilities: { checkout: true, unsubscribe: false },
    });
  });
});

describe("createMockKaitenSessionClient", () => {
  test("is a session client wherever one is taken, as the real one is", async () => {
    const { client: real } = open(() => json(answer("portal")));

    expect(await renderBilling(createMockKaitenSessionClient())).toBe("ACTIVE");
    expect(await renderBilling(real)).toBe("ACTIVE");
  });

  test("serves the demo portal by default, and a copy of it", async () => {
    const session = createMockKaitenSessionClient();

    const portal = await session.getPortal();
    portal.customer.name = "Changed by the host";

    expect(portal).toMatchObject({
      customer: { slug: "acme" },
      instance: { slug: "acme-production" },
    });
    expect((await session.getPortal()).customer.name).toBe("Acme Corporation");
  });

  test("lists the invoices a page at a time", async () => {
    const session = createMockKaitenSessionClient();

    const first = await session.listInvoices({ limit: 1 });
    expect(first.items.map((invoice) => invoice.id)).toEqual(["inv_demo_0002"]);
    expect(first).toMatchObject({ hasMore: true, nextCursor: "1" });

    const last = await session.listInvoices({ cursor: first.nextCursor, limit: 1 });
    expect(last.items.map((invoice) => invoice.id)).toEqual(["inv_demo_0001"]);
    expect(last.hasMore).toBe(false);
    expect(last).not.toHaveProperty("nextCursor");
  });

  test("a cancellation ends the subscription with its period, and a reactivation keeps it", async () => {
    const session = createMockKaitenSessionClient();

    const canceled = await session.cancelSubscription({ reason: "too expensive" });
    expect(canceled.cancelAtPeriodEnd).toBe(true);
    expect((await session.getPortal()).capabilities.unsubscribe).toBe(false);

    // Repeating a cancellation changes nothing, as the API answers it.
    expect((await session.cancelSubscription()).cancelAtPeriodEnd).toBe(true);

    const kept = await session.reactivateSubscription();
    expect(kept.cancelAtPeriodEnd).toBe(false);
    expect((await session.getPortal()).capabilities.unsubscribe).toBe(true);
    expect(await refusedWith(session.reactivateSubscription())).toMatchObject({
      status: 409,
      code: "ReactivateSessionSubscription.NotScheduledForCancellation",
    });
  });

  test("an instance with no subscription has nothing to cancel", async () => {
    const session = createMockKaitenSessionClient({ portal: demoUnsubscribedPortal() });

    expect(await refusedWith(session.cancelSubscription())).toMatchObject({
      status: 409,
      code: "CancelSessionSubscription.NotActive",
    });
  });

  test("a checkout previews what is due, with a voucher's discount from the server's side", async () => {
    const session = createMockKaitenSessionClient({ portal: demoUnsubscribedPortal() });

    const preview = await session.checkout({
      licensePriceId: GROWTH_MONTHLY,
      voucherCode: "welcome-20",
      dryRun: true,
    });

    expect(preview).toMatchObject({
      status: "preview",
      dueToday: { currencyCode: "USD", subtotal: 7900, discountTotal: 1580, total: 6320 },
    });
    if (preview.status !== "preview") return;
    expect(preview.dueToday.lines.map((line) => [line.type, line.amount])).toEqual([
      ["BASE", 7900],
      ["DISCOUNT", -1580],
    ]);
    // A preview changes nothing.
    expect((await session.getPortal()).subscription).toBeNull();
  });

  test("a customer with no payment method saves one first, then subscribes", async () => {
    const session = createMockKaitenSessionClient({ portal: demoUnsubscribedPortal() });

    const needsMethod = await session.checkout({
      licensePriceId: GROWTH_MONTHLY,
      returnUrl: RETURN,
    });
    expect(needsMethod.status).toBe("requires_payment_method");
    if (needsMethod.status !== "requires_payment_method") return;
    expect(needsMethod.setupUrl).toContain(needsMethod.setupSessionId);

    const subscribed = await session.checkout({
      licensePriceId: GROWTH_MONTHLY,
      setupSessionId: needsMethod.setupSessionId,
    });

    expect(subscribed).toMatchObject({
      status: "subscribed",
      subscription: { status: "ACTIVE", currencyCode: "USD", billingInterval: "month" },
      activationInvoice: { kind: "ACTIVATION", status: "PAID", total: 7900 },
      payment: { status: "paid" },
    });
    const portal = await session.getPortal();
    expect(portal).toMatchObject({
      subscription: { status: "ACTIVE", basePrice: { id: GROWTH_MONTHLY } },
      paymentMethod: { status: "ACTIVE", brand: "visa" },
      capabilities: { unsubscribe: true, checkout: false },
    });
    expect((await session.listInvoices()).items[0]?.kind).toBe("ACTIVATION");
    // The page was used: it cannot be used twice.
    await expect(
      createMockKaitenSessionClient({ portal: demoUnsubscribedPortal() }).checkout({
        licensePriceId: GROWTH_MONTHLY,
        setupSessionId: needsMethod.setupSessionId,
      }),
    ).rejects.toMatchObject({ code: "CreateSessionCheckout.SetupSessionIncomplete" });
  });

  test("a free plan subscribes at once, without a payment method", async () => {
    const session = createMockKaitenSessionClient({ portal: demoUnsubscribedPortal() });

    const result = await session.checkout({ licensePriceId: STARTER_MONTHLY });

    expect(result).toMatchObject({
      status: "subscribed",
      payment: { status: "not_required", hostedInvoiceUrl: null },
    });
  });

  test("a checkout is refused as the API refuses it", async () => {
    const subscribed = createMockKaitenSessionClient();
    expect(
      await refusedWith(subscribed.checkout({ licensePriceId: GROWTH_MONTHLY })),
    ).toMatchObject({ status: 409, code: "CreateSessionCheckout.AlreadySubscribed" });

    const fresh = () => createMockKaitenSessionClient({ portal: demoUnsubscribedPortal() });
    expect(await refusedWith(fresh().checkout({ licensePriceId: "nope" }))).toMatchObject({
      status: 422,
      code: "CreateSessionCheckout.PriceNotPublic",
    });
    expect(
      await refusedWith(fresh().checkout({ licensePriceId: GROWTH_MONTHLY, voucherCode: "NOPE" })),
    ).toMatchObject({ status: 422, code: "CreateSessionCheckout.VoucherInvalid" });
    expect(await refusedWith(fresh().checkout({ licensePriceId: GROWTH_MONTHLY }))).toMatchObject({
      status: 422,
      code: "CreateSessionCheckout.InvalidReturnUrl",
    });
  });

  test("a checkout outcome the model does not cover is scripted", async () => {
    const session = createMockKaitenSessionClient({
      portal: demoUnsubscribedPortal(),
      checkout: (input) => {
        if (input.addOns?.length) {
          throw new KaitenError({
            title: "Quota",
            status: 422,
            code: "CreateSessionCheckout.QuotaExceeded",
          });
        }
        return {
          status: "preview",
          dueToday: { currencyCode: "USD", subtotal: 0, discountTotal: 0, total: 0, lines: [] },
          trialEndsAt: "2026-02-15T09:00:00.000Z",
        };
      },
    });

    expect(await session.checkout({ licensePriceId: GROWTH_MONTHLY, dryRun: true })).toMatchObject({
      trialEndsAt: "2026-02-15T09:00:00.000Z",
    });
    await expect(
      session.checkout({
        licensePriceId: GROWTH_MONTHLY,
        addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: "CreateSessionCheckout.QuotaExceeded" });
  });

  test("add-ons the model does not price are not silently left out of a checkout", async () => {
    const session = createMockKaitenSessionClient({ portal: demoUnsubscribedPortal() });

    await expect(
      session.checkout({
        licensePriceId: GROWTH_MONTHLY,
        addOns: [{ addonSlug: "extra-seats-v1", quantity: 1 }],
      }),
    ).rejects.toThrow(/does not model add-ons/);
  });

  test("a voucher check ignores case and separators, and gives nothing away about a refusal", async () => {
    const session = createMockKaitenSessionClient();

    expect(await session.validateVoucher({ code: "Welcome-20" })).toMatchObject({
      valid: true,
      voucher: { name: "Welcome 20%", duration: "REPEATING" },
    });
    expect(await session.validateVoucher({ code: "expired" })).toEqual({ valid: false });
  });

  test("a payment method is saved on the provider's page and completed once", async () => {
    const session = createMockKaitenSessionClient({ portal: demoPortal({ paymentMethod: null }) });

    const page = await session.createPaymentMethodSession({ returnUrl: RETURN });
    const completed = await session.completePaymentMethodSession(page.sessionId);

    expect(completed.paymentMethod).toMatchObject({
      status: "ACTIVE",
      last4: "4242",
      attachedAt: expect.any(String),
    });
    expect((await session.getPortal()).paymentMethod).toMatchObject({ brand: "visa" });
    expect(await refusedWith(session.completePaymentMethodSession(page.sessionId))).toMatchObject({
      status: 409,
    });
    await expect(session.completePaymentMethodSession("")).rejects.toBeInstanceOf(TypeError);
  });

  test("a payment method page asks for a currency when there is no subscription to take it from", async () => {
    const session = createMockKaitenSessionClient({ portal: demoUnsubscribedPortal() });

    expect(
      await refusedWith(session.createPaymentMethodSession({ returnUrl: RETURN })),
    ).toMatchObject({
      status: 422,
      code: "CreateSessionPaymentMethodSession.CurrencyRequired",
    });
    expect(
      await session.createPaymentMethodSession({ returnUrl: RETURN, currencyCode: "USD" }),
    ).toMatchObject({ sessionId: expect.any(String) });
  });

  test("the billing portal is a link", async () => {
    const session = createMockKaitenSessionClient();

    expect(await session.createPortalSession({ returnUrl: RETURN })).toEqual({
      url: "https://billing.example.test/portal",
    });
  });

  test("an add-on's quantity moves it, up to its maximum, and zero removes it", async () => {
    const session = createMockKaitenSessionClient();

    const more = await session.setAddonQuantity("extra-seats-v1", 5);
    expect(more).toMatchObject({ quantity: 5, maxQuantity: 20 });
    expect((await session.getPortal()).addOns[0]?.quantity).toBe(5);

    expect(await refusedWith(session.setAddonQuantity("extra-seats-v1", 21))).toMatchObject({
      status: 422,
      code: "SetSessionAddonQuantity.QuantityExceedsMax",
    });
    expect(await refusedWith(session.setAddonQuantity("not-offered", 1))).toMatchObject({
      status: 422,
      code: "SetSessionAddonQuantity.AddonNotPublic",
    });

    expect(await session.setAddonQuantity("extra-seats-v1", 0)).toMatchObject({ quantity: 0 });
    expect((await session.getPortal()).addOns).toEqual([]);
    expect(await session.setAddonQuantity("extra-seats-v1", 1)).toMatchObject({ quantity: 1 });
    expect((await session.getPortal()).addOns).toHaveLength(1);

    await expect(session.setAddonQuantity("extra-seats-v1", -1)).rejects.toBeInstanceOf(TypeError);
    await expect(session.setAddonQuantity("", 1)).rejects.toBeInstanceOf(TypeError);
  });

  test("records every call, and takes the scenario to swap mid-flight", async () => {
    const session = createMockKaitenSessionClient();

    await session.getPortal();
    await session.validateVoucher({ code: "WELCOME20" });
    await session.setAddonQuantity("extra-seats-v1", 3);
    session.setPortal(demoUnsubscribedPortal());
    session.setInvoices([]);

    expect(session.calls).toEqual([
      { method: "getPortal", args: [] },
      { method: "validateVoucher", args: [{ code: "WELCOME20" }] },
      { method: "setAddonQuantity", args: ["extra-seats-v1", 3] },
    ]);
    expect((await session.getPortal()).subscription).toBeNull();
    expect((await session.listInvoices()).items).toEqual([]);
  });

  test("error makes every call reject, and delayMs holds each one back", async () => {
    const failing = createMockKaitenSessionClient({ error: new Error("backend down") });
    await expect(failing.getPortal()).rejects.toThrow("backend down");
    await expect(failing.cancelSubscription()).rejects.toThrow("backend down");

    const slow = createMockKaitenSessionClient({ delayMs: 20 });
    const started = performance.now();
    await slow.getPortal();
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });

  test("its prices are the ones to offer a checkout", () => {
    expect(demoCheckoutPrices().map((price) => price.id)).toEqual([
      STARTER_MONTHLY,
      GROWTH_MONTHLY,
      "price_growth_annual",
    ]);
  });
});
