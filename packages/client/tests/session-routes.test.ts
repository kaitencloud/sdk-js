import { describe, expect, test } from "vite-plus/test";

import { KaitenError } from "../src/index.ts";
import { answer, refused } from "./support/session-answers.ts";
import { json, open, sent, useSessionClock } from "./support/session-harness.ts";

// Each route of the session client, on the answer Kaiten serves for it
// (fixtures/README.md): what is sent, and what the host reads back.
useSessionClock();

describe("the portal", () => {
  const read = async (key: Parameters<typeof answer>[0] & `portal${string}` = "portal") => {
    const { client, requests } = open(() => json(answer(key)));
    const portal = await client.getPortal();
    return { portal, requests };
  };

  test("an instance-bound session: customer, instance, subscription and the rest", async () => {
    const { portal, requests } = await read();

    expect(await sent(requests)).toEqual([["GET", "/public/session/portal", undefined]]);
    expect(portal.customer).toEqual({
      slug: "initech",
      name: "Initech",
      billingEmail: "ap@initech.test",
    });
    expect(portal.instance).toEqual({
      slug: "initech-prod",
      name: "Initech Prod",
      licenseSlug: "pro-v2",
      licenseName: "Pro",
    });
    expect(portal.instances).toEqual([]);
    expect(portal.subscription).toMatchObject({
      status: "ACTIVE",
      currencyCode: "EUR",
      billingInterval: "month",
      basePrice: { amount: 4900, currencyCode: "EUR", interval: "month" },
      cancelAtPeriodEnd: false,
      scheduledChange: null,
    });
    expect(portal.subscription).not.toHaveProperty("intervalCount");
    expect(portal.upcomingInvoice).toEqual({
      currencyCode: "EUR",
      subtotal: 10646,
      discountTotal: 0,
      total: 10646,
      boundaryAt: "2026-11-01T00:00:00Z",
    });
    expect(portal.capabilities).toEqual({
      paymentMethods: true,
      invoices: true,
      unsubscribe: true,
      checkout: false,
    });
    expect(portal.updatedAt).toBe("2026-10-10T10:00:00Z");
    expect(portal.vouchers).toEqual([
      {
        name: "Double API calls",
        voucherType: "ENTITLEMENT_BOOST",
        status: "ACTIVE",
        effectiveStartsAt: "2026-10-06T09:00:00Z",
        effectiveExpiresAt: null,
      },
      {
        name: "Welcome 20%",
        voucherType: "PRICE",
        status: "ACTIVE",
        effectiveStartsAt: "2026-10-01T00:00:00Z",
        effectiveExpiresAt: null,
      },
    ]);
  });

  test("entitlements are the effective ones, each with the layer that grants it", async () => {
    const { portal } = await read();
    const bySlug = Object.fromEntries(
      portal.entitlements.map((entitlement) => [entitlement.slug, entitlement]),
    );

    expect(Object.keys(bySlug)).toEqual([
      "ai-credits",
      "api-calls",
      "branding",
      "priority-support",
      "seats",
      "sso",
      "workspaces",
    ]);
    expect(bySlug["api-calls"]).toMatchObject({
      id: "api-calls",
      type: "NUMBER",
      limitValue: { type: "number", value: 200000 },
      currentValue: { type: "number", value: 30000 },
      limitCapExceededOveragePercent: 20,
      maximumAllowedUsage: 240000,
      percentageUsed: 15,
      remaining: 210000,
      status: "enabled",
      source: "license",
      currentPeriodStart: "2026-10-01T00:00:00Z",
      currentPeriodEnd: "2026-11-01T00:00:00Z",
    });
    expect(bySlug["seats"]).toMatchObject({
      limitValue: { type: "number", value: 8 },
      currentValue: { type: "number", value: 8 },
      remaining: 0,
      status: "over_limit",
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    expect(bySlug["workspaces"]).toMatchObject({
      unlimited: true,
      maximumAllowedUsage: null,
      remaining: null,
      percentageUsed: null,
      status: "enabled",
    });
    expect(bySlug["sso"]).toMatchObject({
      limitValue: { type: "boolean", value: true },
      currentValue: { type: "boolean", value: true },
      status: "enabled",
    });
    expect(bySlug["branding"]).toMatchObject({
      type: "CONFIG",
      limitValue: { type: "object", value: { theme: "dark", logo: true } },
      status: "enabled",
    });
    expect(bySlug["priority-support"]).toMatchObject({ source: "addon", status: "enabled" });
    expect(bySlug["ai-credits"]).toMatchObject({
      type: "NUMBER_AI_CREDIT",
      limitValue: { type: "number", value: 100 },
      currentValue: { type: "number", value: 0 },
      status: "enabled",
    });
    expect(portal.entitlements.some((entitlement) => entitlement.source === "credit")).toBe(false);
  });

  test("provenance names the rows each layer comes from, and the arithmetic", async () => {
    const { portal } = await read();
    const entitlement = (slug: string) => portal.entitlements.find((found) => found.slug === slug);

    expect(entitlement("api-calls")?.provenance).toEqual({
      license: {
        licenseEntitlementId: "00000000-0000-4000-8000-000000000e01",
        value: { type: "number", value: 100000 },
        limitCapExceededOveragePercent: 20,
      },
      addons: [],
      boosts: [
        {
          instanceVoucherId: "00000000-0000-4000-8000-000000000b01",
          voucherId: "00000000-0000-4000-8000-000000000b02",
          voucherEntitlementGrantId: "00000000-0000-4000-8000-000000000b03",
          modifierType: "MULTIPLY",
          modifierValue: 2,
          redeemedAt: "2026-10-06T09:00:00Z",
          effectiveStartsAt: "2026-10-06T09:00:00Z",
          effectiveExpiresAt: null,
        },
      ],
      number: {
        license: 100000,
        afterAddons: 100000,
        boostSet: null,
        boostAdd: null,
        boostMultiply: 2,
        unlimited: false,
        effective: 200000,
      },
    });
    expect(entitlement("seats")?.provenance?.addons).toEqual([
      {
        instanceAddonId: "00000000-0000-4000-8000-00000000a001",
        addonId: "00000000-0000-4000-8000-0000000000a1",
        addonEntitlementId: "00000000-0000-4000-8000-000000000e03",
        quantity: 3,
        overrideBehavior: "ADD",
        value: { type: "number", value: 1 },
        limitCapExceededOveragePercent: 0,
        attachedAt: "2026-10-02T00:00:00Z",
      },
    ]);
    // An add-on alone grants it: no licence layer, no arithmetic.
    expect(entitlement("priority-support")?.provenance).toMatchObject({
      license: null,
      number: null,
    });
    expect(entitlement("sso")?.provenance).toMatchObject({
      license: { value: { type: "boolean", value: true }, limitCapExceededOveragePercent: null },
      number: null,
    });
    // No layer detail where the server sends none.
    expect(entitlement("branding")).not.toHaveProperty("provenance");
  });

  test("add-ons say how many the instance holds and every price they are billed at", async () => {
    const { portal } = await read();

    expect(portal.addOns[0]).toEqual({
      slug: "extra-seats-v1",
      familySlug: "extra-seats",
      name: "Extra seats",
      quantity: 3,
      maxQuantity: 50,
      price: 1000,
      currencyCode: "EUR",
      interval: "month",
      // The 1.0-typed list holds the flat fee alone, as for a catalogue add-on.
      prices: [
        {
          id: "00000000-0000-4000-8000-00000000a101",
          amount: 1000,
          unitAmountDecimal: "1000",
          currencyCode: "EUR",
          billingModel: "FLAT_FEE",
          isDefault: true,
          interval: "month",
          label: "Monthly",
        },
      ],
      billingPrices: [
        {
          id: "00000000-0000-4000-8000-00000000a101",
          amount: 1000,
          unitAmountDecimal: "1000",
          currencyCode: "EUR",
          billingModel: "FLAT_FEE",
          isDefault: true,
          interval: "month",
          label: "Monthly",
        },
        {
          id: "00000000-0000-4000-8000-00000000a102",
          unitAmountDecimal: "0.5",
          currencyCode: "EUR",
          billingModel: "USAGE_BASED",
          isDefault: false,
          meteredEntitlementSlug: "api-calls",
          saleUnitFactor: 1000,
          saleUnitSingular: "1k calls",
          saleUnitPlural: "1k calls",
        },
      ],
    });
    // Unbounded, and billed nothing: no price to show.
    expect(portal.addOns[1]).toMatchObject({
      slug: "gpu-pack-v1",
      quantity: 1,
      maxQuantity: null,
      billingPrices: [],
      prices: [],
    });
  });

  test("a payment method gives its labels, and null for one the provider keeps back", async () => {
    expect((await read()).portal.paymentMethod).toEqual({
      status: "ACTIVE",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    });
    expect((await read("portalPastDue")).portal.paymentMethod).toEqual({
      status: "FAILED",
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
    });
  });

  test("a session bound to the customer only lists its instances and has nothing else", async () => {
    const { portal } = await read("portalCustomerWide");

    expect(portal.instance).toBeNull();
    expect(portal.instances).toEqual([
      {
        slug: "initech-prod",
        name: "Initech Prod",
        licenseSlug: "pro-v2",
        billingStatus: "ACTIVE",
      },
      { slug: "initech-lab", name: "Initech Lab", licenseSlug: "starter-v1", billingStatus: null },
    ]);
    expect(portal).toMatchObject({
      subscription: null,
      entitlements: [],
      addOns: [],
      vouchers: [],
      upcomingInvoice: null,
      paymentMethod: { brand: "visa" },
    });
  });

  test("an instance never subscribed may check out, and has no email or payment method yet", async () => {
    const { portal } = await read("portalNeverSubscribed");

    expect(portal.customer.billingEmail).toBeNull();
    expect(portal).toMatchObject({
      subscription: null,
      paymentMethod: null,
      upcomingInvoice: null,
      capabilities: { checkout: true, unsubscribe: false },
    });
    expect(portal.entitlements.map((entitlement) => entitlement.slug)).toEqual(["sso"]);
  });

  test("a subscription that ends with its period, one changing plan, one past due", async () => {
    expect((await read("portalCanceling")).portal).toMatchObject({
      subscription: { cancelAtPeriodEnd: true },
      capabilities: { unsubscribe: false },
    });
    expect(
      (await read("portalScheduledChange")).portal.subscription?.scheduledChange,
    ).toMatchObject({
      effectiveAt: "2026-11-01T00:00:00Z",
      price: { amount: 49000, interval: "year" },
    });
    expect((await read("portalPastDue")).portal.subscription).toMatchObject({
      status: "PAST_DUE",
      billingInterval: "month",
      intervalCount: 3,
      basePrice: { amount: 13500, intervalCount: 3 },
    });
  });

  test("a list the answer leaves out reads as empty, never as a null the host trips on", async () => {
    const wire = answer("portal") as unknown as Record<string, unknown>;
    for (const member of ["instances", "entitlements", "addOns", "vouchers"]) delete wire[member];
    const { client } = open(() => json(wire));

    const portal = await client.getPortal();

    expect(portal).toMatchObject({ instances: [], entitlements: [], addOns: [], vouchers: [] });
  });
});

describe("vouchers", () => {
  const CODE = "WELCOME20";
  const PRICE = "00000000-0000-4000-8000-000000000201";

  test("the code goes in the body and nowhere else, with the price it is checked for", async () => {
    const { client, requests } = open(() => json(answer("voucherPercent")));

    await client.validateVoucher({ code: CODE, licensePriceId: PRICE });

    expect(await sent(requests)).toEqual([
      [
        "POST",
        "/public/session/vouchers/validate",
        JSON.stringify({ code: CODE, licensePriceId: PRICE }),
      ],
    ]);
    expect(requests[0]!.url).not.toContain(CODE);
  });

  test("a percentage repeating for a few invoices keeps its value exact", async () => {
    const { client } = open(() => json(answer("voucherPercent")));

    expect(await client.validateVoucher({ code: CODE })).toEqual({
      valid: true,
      voucher: {
        name: "Welcome 20%",
        voucherType: "PRICE",
        duration: "REPEATING",
        durationInPeriods: 3,
        discount: { type: "PERCENTAGE", value: "20", appliesTo: "LICENSE_BASE" },
      },
    });
  });

  test("an amount off once carries its currency code", async () => {
    const { client } = open(() => json(answer("voucherFixed")));

    expect(await client.validateVoucher({ code: "FIVEOFF" })).toEqual({
      valid: true,
      voucher: {
        name: "Five off",
        voucherType: "PRICE",
        duration: "ONE_TIME",
        durationInPeriods: null,
        discount: { type: "FIXED_AMOUNT", value: "500", currencyCode: "EUR", appliesTo: "BOTH" },
      },
    });
  });

  test("boosts last as long as the voucher, and an unlimited one has no value", async () => {
    const { client } = open(() => json(answer("voucherBoost")));

    const check = await client.validateVoucher({ code: "LAUNCH" });

    expect(check).toEqual({
      valid: true,
      voucher: {
        name: "Launch boost",
        voucherType: "ENTITLEMENT_BOOST",
        duration: "FOREVER",
        durationInPeriods: null,
        boosts: [
          { entitlementSlug: "api-calls", modifierType: "MULTIPLY", modifierValue: "2" },
          { entitlementSlug: "workspaces", modifierType: "UNLIMITED", modifierValue: null },
        ],
      },
    });
    expect(check).not.toHaveProperty("voucher.discount");
  });

  test("every code that does not apply gets the same answer, which says nothing more", async () => {
    const { client } = open(() => json(answer("voucherRefused")));

    expect(await client.validateVoucher({ code: "NOPE" })).toEqual({ valid: false });
  });

  test("a duration, a discount or a modifier the contract does not list yet is passed on", async () => {
    const wire = answer("voucherPercent");
    wire.voucher!.duration = "SEASONAL" as never;
    wire.voucher!.discount!.appliesTo = "BUNDLES" as never;
    const { client } = open(() => json(wire));

    expect(await client.validateVoucher({ code: CODE })).toMatchObject({
      valid: true,
      voucher: { duration: "SEASONAL", discount: { appliesTo: "BUNDLES" } },
    });
  });

  test("guessing is slowed by a 429, which keeps its wait and is not sent again", async () => {
    const { client, requests } = open(() => refused("voucherRateLimited"));

    const error = await client.validateVoucher({ code: CODE }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({
      status: 429,
      code: "ValidateSessionVoucher.RateLimited",
      retryAfterSeconds: 90,
    });
    expect(requests).toHaveLength(1);
    expect(String((error as Error).message)).not.toContain(CODE);
  });
});

describe("the provider's pages", () => {
  const RETURN = "https://app.initech.test/billing";

  test("the billing portal is a link, sent back to the page the host names", async () => {
    const { client, requests } = open(() => json(answer("portalSession")));

    const portal = await client.createPortalSession({ returnUrl: RETURN });

    expect(await sent(requests)).toEqual([
      ["POST", "/public/session/billing/portal-session", JSON.stringify({ returnUrl: RETURN })],
    ]);
    expect(portal).toEqual({ url: "https://billing.stripe.test/p/session_1" });
  });

  test("a payment method page is opened in the currency the host names", async () => {
    const { client, requests } = open(() => json(answer("paymentMethodSession")));

    const page = await client.createPaymentMethodSession({
      returnUrl: RETURN,
      currencyCode: "EUR",
    });

    expect(await sent(requests)).toEqual([
      [
        "POST",
        "/public/session/billing/payment-method-session",
        JSON.stringify({ returnUrl: RETURN, currency: "EUR" }),
      ],
    ]);
    expect(page).toEqual({
      url: "https://checkout.stripe.test/c/setup_2",
      sessionId: "cs_setup_2",
      expiresAt: "2026-10-11T12:00:00Z",
    });
  });

  test("a customer who already pays in a currency is asked for none", async () => {
    const { client, requests } = open(() => json(answer("paymentMethodSession")));

    await client.createPaymentMethodSession({ returnUrl: RETURN });

    expect(await sent(requests)).toEqual([
      [
        "POST",
        "/public/session/billing/payment-method-session",
        JSON.stringify({ returnUrl: RETURN }),
      ],
    ]);
  });

  test("completing a session reads the payment method it saved, and when", async () => {
    const { client, requests } = open(() => json(answer("paymentMethodCompleted")));

    const completed = await client.completePaymentMethodSession("cs_setup_2");

    expect(await sent(requests)).toEqual([
      ["POST", "/public/session/billing/payment-method-session/cs_setup_2/complete", undefined],
    ]);
    expect(completed).toEqual({
      paymentMethod: {
        status: "ACTIVE",
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
        attachedAt: "2026-10-10T11:00:00Z",
      },
    });
  });

  test("a payment method the provider gives no labels for has them null, and no date", async () => {
    const { client } = open(() => json(answer("paymentMethodCompletedBare")));

    const completed = await client.completePaymentMethodSession("cs_setup_2");

    expect(completed.paymentMethod).toEqual({
      status: "ACTIVE",
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
    });
  });

  test("the session id is one path segment, and an empty one is refused before any request", async () => {
    const { client, requests } = open(() => json(answer("paymentMethodCompleted")));

    await client.completePaymentMethodSession("cs/1 ?");
    expect(new URL(requests[0]!.url).pathname).toBe(
      "/api/public/session/billing/payment-method-session/cs%2F1%20%3F/complete",
    );

    await expect(client.completePaymentMethodSession("")).rejects.toBeInstanceOf(TypeError);
    expect(requests).toHaveLength(1);
  });

  test("a provider that cannot be reached answers 503 once, with how long to wait", async () => {
    const { client, requests } = open(() => refused("paymentMethodUnavailable"));

    const error = await client
      .createPaymentMethodSession({ returnUrl: RETURN })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      status: 503,
      code: "CreateSessionPaymentMethodSession.ProviderUnavailable",
      retryAfterSeconds: 30,
    });
    expect(requests).toHaveLength(1);
  });
});

describe("checkout", () => {
  const PRICE = "00000000-0000-4000-8000-000000000201";

  test("a preview is asked for with dryRun, and its total is the server's", async () => {
    const wire = answer("checkoutPreview");
    // The lines add up to 5520; the server says otherwise, and the SDK believes the server.
    wire.dueToday.total = 9999;
    const { client, requests } = open(() => json(wire));

    const result = await client.checkout({ licensePriceId: PRICE, dryRun: true });

    expect(await sent(requests)).toEqual([
      ["POST", "/public/session/checkout", JSON.stringify({ licensePriceId: PRICE, dryRun: true })],
    ]);
    expect(result).toEqual({
      status: "preview",
      dueToday: {
        currencyCode: "EUR",
        subtotal: 6900,
        discountTotal: 1380,
        total: 9999,
        lines: [
          expect.objectContaining({ type: "BASE", amount: 4900, unitAmountDecimal: "4900" }),
          expect.objectContaining({ type: "ADDON", amount: 2000, quantity: "2" }),
          expect.objectContaining({ type: "DISCOUNT", amount: -1380, unitAmountDecimal: null }),
        ],
      },
      trialEndsAt: null,
    });
  });

  test("a trial owes nothing today and says when it ends", async () => {
    const { client } = open(() => json(answer("checkoutPreviewTrial")));

    expect(await client.checkout({ licensePriceId: PRICE, dryRun: true })).toEqual({
      status: "preview",
      dueToday: { currencyCode: "EUR", subtotal: 0, discountTotal: 0, total: 0, lines: [] },
      trialEndsAt: "2026-11-01T00:00:00Z",
    });
  });

  test("a payment method to save first sends the customer to the provider's page", async () => {
    const { client } = open(() => json(answer("checkoutRequiresMethod")));

    const result = await client.checkout({
      licensePriceId: PRICE,
      returnUrl: "https://app.initech.test/billing",
    });

    expect(result).toEqual({
      status: "requires_payment_method",
      setupUrl: "https://checkout.stripe.test/c/setup_1",
      setupSessionId: "cs_setup_1",
      expiresAt: "2026-10-11T12:00:00Z",
    });
  });

  test("the request carries what the host asked for, and only that", async () => {
    const { client, requests } = open(() => json(answer("checkoutSubscribed"), 201));

    await client.checkout({
      licensePriceId: PRICE,
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      voucherCode: "WELCOME20",
      billingEmail: "ap@initech.test",
      trial: false,
      setupSessionId: "cs_setup_1",
      returnUrl: "https://app.initech.test/billing",
    });

    expect(await requests[0]!.clone().json()).toEqual({
      licensePriceId: PRICE,
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      voucherCode: "WELCOME20",
      billingEmail: "ap@initech.test",
      trial: false,
      setupSessionId: "cs_setup_1",
      returnUrl: "https://app.initech.test/billing",
    });
  });

  test("a subscribed customer has the subscription, its first invoice and the payment's outcome", async () => {
    const { client } = open(() => json(answer("checkoutSubscribed"), 201));

    const result = await client.checkout({ licensePriceId: PRICE });

    expect(result).toMatchObject({
      status: "subscribed",
      subscription: { status: "ACTIVE", currencyCode: "EUR", billingInterval: "month" },
      activationInvoice: {
        kind: "ACTIVATION",
        status: "PAID",
        total: 4900,
        paidAt: "2026-10-10T10:00:00Z",
      },
      payment: { status: "paid", hostedInvoiceUrl: "https://pay.initech.test/i/100" },
    });
  });

  test("a payment that needs the customer's confirmation points at the page to do it on", async () => {
    const { client } = open(() => json(answer("checkoutSubscribedAction"), 201));

    const result = await client.checkout({ licensePriceId: PRICE });

    expect(result).toMatchObject({
      status: "subscribed",
      activationInvoice: { status: "PAYMENT_FAILED", paidAt: null },
      payment: { status: "requires_action", hostedInvoiceUrl: "https://pay.initech.test/i/1" },
    });
  });

  test("a trial has no first invoice and no page to pay on", async () => {
    const { client } = open(() => json(answer("checkoutSubscribedTrial"), 201));

    const result = await client.checkout({ licensePriceId: PRICE });

    expect(result).toMatchObject({
      status: "subscribed",
      subscription: { status: "TRIAL", trialEndsAt: "2026-11-01T00:00:00Z" },
      activationInvoice: null,
      payment: { status: "not_required", hostedInvoiceUrl: null },
    });
  });

  test("a 200 and a 201 are both an answer, whichever the contract declares for the status", async () => {
    for (const [key, status] of [
      ["checkoutPreview", 200],
      ["checkoutPreview", 201],
      ["checkoutRequiresMethod", 200],
      ["checkoutRequiresMethod", 201],
      ["checkoutSubscribed", 200],
      ["checkoutSubscribed", 201],
    ] as const) {
      const { client } = open(() => json(answer(key), status));

      const result = await client.checkout({ licensePriceId: PRICE });

      expect(result.status).toBe(answer(key).status);
    }
  });

  test("a status this client does not know reaches the host as it came", async () => {
    const wire = { status: "scheduled", effectiveAt: "2026-11-01T00:00:00Z" };
    const { client } = open(() => json(wire, 201));

    expect(await client.checkout({ licensePriceId: PRICE })).toEqual(wire);
  });

  test("a refusal keeps its code, and the checkout is not sent again", async () => {
    const { client, requests } = open(() => refused("checkoutAlreadySubscribed"));

    await expect(client.checkout({ licensePriceId: PRICE })).rejects.toMatchObject({
      status: 409,
      code: "CreateSessionCheckout.AlreadySubscribed",
    });
    expect(requests).toHaveLength(1);
  });

  test("a provider that cannot be reached answers 503 once, with how long to wait", async () => {
    const { client, requests } = open(() => refused("checkoutProviderUnavailable"));

    const error = await client
      .checkout({ licensePriceId: PRICE })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({
      status: 503,
      code: "CreateSessionCheckout.ProviderUnavailable",
      retryAfterSeconds: 30,
    });
    // A second checkout could subscribe the customer twice: it is never replayed.
    expect(requests).toHaveLength(1);
  });
});

describe("invoices", () => {
  test("a page asks for its cursor and its size, and keeps the cursor of the next", async () => {
    const { client, requests } = open(() => json(answer("invoicesFirstPage")));

    const page = await client.listInvoices({ cursor: "eyJzZXEiOjF9", limit: 2 });

    expect(await sent(requests)).toEqual([
      ["GET", "/public/session/invoices?cursor=eyJzZXEiOjF9&limit=2", undefined],
    ]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("eyJzZXEiOjJ9");
    expect(page.items.map((invoice) => invoice.id.slice(-3))).toEqual(["302", "301"]);
  });

  test("the first and the last page are asked for without a query when nothing narrows them", async () => {
    const { client, requests } = open(() => json(answer("invoicesLastPage")));

    const page = await client.listInvoices();

    expect(await sent(requests)).toEqual([["GET", "/public/session/invoices", undefined]]);
    expect(page.hasMore).toBe(false);
    expect(page).not.toHaveProperty("nextCursor");
  });

  test("a customer without invoices gets an empty page", async () => {
    const { client } = open(() => json(answer("invoicesEmpty")));

    expect(await client.listInvoices()).toEqual({ items: [], hasMore: false });
  });

  test("a paid invoice keeps the server's totals, its dates and where to read it", async () => {
    const { client } = open(() => json(answer("invoicesFirstPage")));

    const [renewal] = (await client.listInvoices()).items;

    expect(renewal).toMatchObject({
      id: "00000000-0000-4000-8000-000000000302",
      kind: "RENEWAL",
      status: "PAID",
      currencyCode: "EUR",
      subtotal: 12646,
      discountTotal: 2000,
      total: 10646,
      issuedAt: "2026-10-01T00:00:00Z",
      dueAt: "2026-10-01T00:00:00Z",
      paidAt: "2026-10-01T01:00:00Z",
      serviceFrom: "2026-10-01T00:00:00Z",
      serviceTo: "2026-11-01T00:00:00Z",
      providerInvoiceNumber: "INV-0002",
      externalReference: null,
      hostedInvoiceUrl: "https://pay.initech.test/i/2",
      invoicePdfUrl: "https://pay.initech.test/i/2.pdf",
    });
    expect(renewal).not.toHaveProperty("currency");
  });

  test("lines carry the arithmetic, and a discount has no unit amount", async () => {
    const { client } = open(() => json(answer("invoicesFirstPage")));

    const [renewal] = (await client.listInvoices()).items;

    expect(renewal?.lines.map((line) => [line.type, line.amount, line.unitAmountDecimal])).toEqual([
      ["BASE", 4900, "4900"],
      ["ADDON", 3000, "1000"],
      ["USAGE", 4846, "0.5"],
      ["DISCOUNT", -2000, null],
    ]);
    expect(renewal?.lines[2]).toEqual({
      seq: 3,
      type: "USAGE",
      label: "API calls",
      description: "9,692 × 0.50 EUR (per 1k calls)",
      quantity: "9.692",
      unitAmountDecimal: "0.5",
      amount: 4846,
      serviceFrom: "2026-10-01T00:00:00Z",
      serviceTo: "2026-11-01T00:00:00Z",
    });
  });

  test("a server that sends an empty unit amount for a discount is read the same way", async () => {
    const wire = answer("invoicesFirstPage");
    wire.items[0]!.lines[3]!.unitAmountDecimal = "";
    const { client } = open(() => json(wire));

    const [renewal] = (await client.listInvoices()).items;

    expect(renewal?.lines[3]).toMatchObject({ type: "DISCOUNT", unitAmountDecimal: null });
  });

  test("a payment that failed leaves the page to confirm it on, and no paid date", async () => {
    const { client } = open(() => json(answer("invoicesFirstPage")));

    const failed = (await client.listInvoices()).items[1];

    expect(failed).toMatchObject({
      kind: "ACTIVATION",
      status: "PAYMENT_FAILED",
      paidAt: null,
      dueAt: "2026-10-15T00:00:00Z",
      hostedInvoiceUrl: "https://pay.initech.test/i/1",
      invoicePdfUrl: null,
    });
  });

  test("an invoice the vendor collects itself has an external reference and no provider", async () => {
    const { client } = open(() => json(answer("invoicesLastPage")));

    const [manual] = (await client.listInvoices()).items;

    expect(manual).toMatchObject({
      status: "MANUAL",
      issuedAt: "2026-10-09T00:00:00Z",
      dueAt: null,
      paidAt: null,
      providerInvoiceNumber: null,
      externalReference: "ACME-2026-17",
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
    });
    // A line with no arithmetic says so with an empty description.
    expect(manual?.lines[0]).toMatchObject({ description: "" });
  });

  test("an invoice not issued yet has no issue date", async () => {
    const wire = answer("invoicesLastPage");
    wire.items[0]!.issuedAt = null;
    const { client } = open(() => json(wire));

    expect((await client.listInvoices()).items[0]?.issuedAt).toBeNull();
  });
});

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
