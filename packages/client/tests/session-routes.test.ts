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
