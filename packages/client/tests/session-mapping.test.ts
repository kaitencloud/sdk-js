import { describe, expect, test } from "vite-plus/test";

import {
  mapCheckout,
  mapInvoicePage,
  mapPortal,
  mapVoucherValidation,
} from "../src/client/billing.ts";

const P = "2026-10-01T00:00:00.000Z";
const P1 = "2026-11-01T00:00:00.000Z";
const R = "2026-10-06T09:00:00.000Z";

const price = (id: string, period: string | null, unitAmount: number | null, extra = {}) => ({
  id,
  billingModel: "FLAT_FEE",
  billingTiming: "ADVANCE",
  billingPeriod: period,
  currency: "EUR",
  unitAmount,
  unitAmountDecimal: `${unitAmount}`,
  metered: null,
  displayLabel: "Monthly",
  displayOrder: 0,
  isDefault: true,
  status: "ACTIVE",
  ...extra,
});

/** The portal of an instance-bound, active session. */
const BOUND = {
  customer: { slug: "initech", name: "Initech", billingEmail: "ap@initech.test" },
  instance: {
    slug: "initech-prod",
    name: "Initech Prod",
    licenseSlug: "pro-v2",
    licenseName: "Pro",
  },
  instances: null,
  subscription: {
    status: "ACTIVE",
    providerKind: "STRIPE",
    collectionMethod: "CHARGE_AUTOMATICALLY",
    currency: "EUR",
    billingPeriod: "MONTHLY",
    basePrice: price("lp-pro-m", "MONTHLY", 4900),
    currentPeriodStart: P,
    currentPeriodEnd: P1,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    scheduledChange: null,
  },
  entitlements: [
    {
      slug: "api-calls",
      name: "API calls",
      type: "NUMBER",
      limitValue: 200000,
      currentValue: 30000,
      unlimited: false,
      limitCapExceededOveragePercent: 20,
      maximumAllowedUsage: 240000,
      percentageUsed: 15,
      currentPeriodStart: P,
      currentPeriodEnd: P1,
      source: "license",
      provenance: {
        license: { value: { type: "number", value: 100000 }, limitCapExceededOveragePercent: 20 },
        addons: [],
        boosts: [
          {
            voucherId: "v-1",
            modifierType: "MULTIPLY",
            modifierValue: 2,
            redeemedAt: R,
            effectiveStartsAt: R,
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
      },
    },
    {
      slug: "seats",
      name: "Seats",
      type: "NUMBER",
      limitValue: 8,
      currentValue: 8,
      unlimited: false,
      limitCapExceededOveragePercent: 0,
      maximumAllowedUsage: 8,
      percentageUsed: 100,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      source: "license",
    },
    {
      slug: "sso",
      name: "Single sign-on",
      type: "BOOLEAN",
      limitValue: true,
      currentValue: null,
      unlimited: false,
      limitCapExceededOveragePercent: null,
      maximumAllowedUsage: null,
      percentageUsed: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      source: "license",
    },
    {
      slug: "priority-support",
      name: "Priority support",
      type: "BOOLEAN",
      limitValue: true,
      currentValue: null,
      unlimited: false,
      maximumAllowedUsage: null,
      percentageUsed: null,
      source: "addon",
    },
    {
      slug: "gpu-hours",
      name: "GPU hours",
      type: "NUMBER_AI_CREDIT",
      limitValue: 100,
      currentValue: null,
      unlimited: false,
      maximumAllowedUsage: 100,
      percentageUsed: null,
      source: "license",
    },
  ],
  addOns: [
    {
      addonSlug: "extra-seats-v1",
      familySlug: "extra-seats",
      name: "Extra seats",
      quantity: 3,
      maxQuantity: 50,
      prices: [price("ap-seats-m", "MONTHLY", 1000)],
    },
  ],
  vouchers: [
    {
      name: "Double API calls",
      voucherType: "ENTITLEMENT_BOOST",
      status: "ACTIVE",
      effectiveStartsAt: R,
      effectiveExpiresAt: null,
    },
  ],
  paymentMethod: { status: "ACTIVE", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
  upcomingInvoice: {
    currency: "EUR",
    subtotal: 10646,
    discountTotal: 0,
    total: 10646,
    boundaryAt: P1,
  },
  capabilities: { paymentMethods: true, invoices: true, unsubscribe: true, checkout: false },
  updatedAt: "2026-10-06T10:00:00.000Z",
};

const INVOICE = {
  id: "inv-1",
  kind: "ACTIVATION",
  status: "PAID",
  currency: "EUR",
  subtotal: 6900,
  discountTotal: 1380,
  total: 5520,
  issuedAt: P,
  dueAt: P,
  paidAt: P,
  serviceFrom: P,
  serviceTo: P1,
  providerInvoiceNumber: "INV-0001",
  externalReference: null,
  hostedInvoiceUrl: "https://pay.test/i/1",
  invoicePdfUrl: "https://pay.test/i/1.pdf",
  lines: [
    {
      seq: 1,
      type: "BASE",
      label: "Monthly",
      description: null,
      quantity: "1",
      unitAmountDecimal: "4900",
      amount: 4900,
      serviceFrom: P,
      serviceTo: P1,
    },
  ],
};

describe("the portal", () => {
  const portal = mapPortal(BOUND);

  test("subscription: money and period in the SDK's terms", () => {
    expect(portal.subscription).toMatchObject({
      status: "ACTIVE",
      currencyCode: "EUR",
      billingInterval: "month",
      basePrice: { id: "lp-pro-m", amount: 4900, currencyCode: "EUR", interval: "month" },
      currentPeriodEnd: P1,
      cancelAtPeriodEnd: false,
      scheduledChange: null,
    });
    expect(portal.subscription).not.toHaveProperty("intervalCount");
    expect(
      mapPortal({ ...BOUND, subscription: { ...BOUND.subscription, billingPeriod: "QUARTERLY" } })
        .subscription,
    ).toMatchObject({ billingInterval: "month", intervalCount: 3 });
  });

  test("entitlements are the effective ones, with their source and provenance", () => {
    const [apiCalls, seats, sso, support] = portal.entitlements;

    expect(apiCalls).toMatchObject({
      slug: "api-calls",
      limitValue: { type: "number", value: 200000 },
      currentValue: { type: "number", value: 30000 },
      maximumAllowedUsage: 240000,
      remaining: 210000,
      percentageUsed: 15,
      status: "enabled",
      source: "license",
      currentPeriodStart: P,
      currentPeriodEnd: P1,
    });
    expect(apiCalls?.provenance?.boosts[0]?.modifierType).toBe("MULTIPLY");
    expect(apiCalls?.provenance?.number?.effective).toBe(200000);
    expect(seats).toMatchObject({ remaining: 0, status: "over_limit" });
    expect(sso).toMatchObject({
      limitValue: { type: "boolean", value: true },
      currentValue: { type: "boolean", value: true },
      status: "enabled",
    });
    expect(support).toMatchObject({ source: "addon", status: "enabled" });
    expect(portal.entitlements.some((entitlement) => entitlement.source === "credit")).toBe(false);
  });

  test("a number without its usage is unknown usage, never zero", () => {
    const gpu = portal.entitlements[4];

    expect(gpu).toMatchObject({
      type: "NUMBER_AI_CREDIT",
      currentValue: null,
      usageUnavailable: true,
      remaining: null,
    });
  });

  test("add-ons, capabilities, upcoming invoice and payment method", () => {
    expect(portal.addOns).toMatchObject([
      {
        slug: "extra-seats-v1",
        familySlug: "extra-seats",
        quantity: 3,
        maxQuantity: 50,
        price: 1000,
        currencyCode: "EUR",
      },
    ]);
    expect(portal.capabilities).toEqual({
      paymentMethods: true,
      invoices: true,
      unsubscribe: true,
      checkout: false,
    });
    expect(portal.upcomingInvoice).toEqual({
      currencyCode: "EUR",
      subtotal: 10646,
      discountTotal: 0,
      total: 10646,
      boundaryAt: P1,
    });
    expect(portal.paymentMethod).toMatchObject({ brand: "visa", last4: "4242" });
    expect(portal.instance?.slug).toBe("initech-prod");
    expect(portal.instances).toBeNull();
  });

  test("an unbound session's portal has no subscription and no entitlements", () => {
    const unbound = mapPortal({
      ...BOUND,
      instance: null,
      instances: [
        { slug: "initech-lab", name: "Lab", licenseSlug: "starter-v1", billingStatus: null },
      ],
      subscription: null,
      entitlements: [],
      addOns: [],
      upcomingInvoice: null,
    });

    expect(unbound).toMatchObject({
      instance: null,
      subscription: null,
      entitlements: [],
      addOns: [],
      upcomingInvoice: null,
    });
    expect(unbound.instances).toHaveLength(1);
  });
});

describe("invoices, checkout and vouchers", () => {
  test("an invoice page keeps the server's totals and renames the currency", () => {
    const page = mapInvoicePage({ items: [INVOICE], hasMore: true, nextCursor: "c2" });

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("c2");
    expect(page.items[0]).toMatchObject({
      id: "inv-1",
      currencyCode: "EUR",
      subtotal: 6900,
      discountTotal: 1380,
      total: 5520,
      hostedInvoiceUrl: "https://pay.test/i/1",
      lines: [{ seq: 1, amount: 4900, unitAmountDecimal: "4900" }],
    });
    expect(page.items[0]).not.toHaveProperty("currency");
  });

  test("a preview carries the server's total, never a sum of its lines", () => {
    const preview = mapCheckout({
      status: "preview",
      dueToday: { ...INVOICE, total: 9999 },
      trialEndsAt: null,
    });

    expect(preview).toMatchObject({
      status: "preview",
      dueToday: { total: 9999, currencyCode: "EUR" },
    });
  });

  test("a subscribed checkout maps its subscription and activation invoice", () => {
    const subscribed = mapCheckout({
      status: "subscribed",
      subscription: BOUND.subscription,
      activationInvoice: INVOICE,
      payment: { status: "requires_action", hostedInvoiceUrl: "https://pay.test/i/1" },
    });

    expect(subscribed).toMatchObject({
      status: "subscribed",
      subscription: { currencyCode: "EUR", billingInterval: "month" },
      activationInvoice: { id: "inv-1", currencyCode: "EUR" },
      payment: { status: "requires_action", hostedInvoiceUrl: "https://pay.test/i/1" },
    });
  });

  test("a setup answer is passed through", () => {
    const setup = {
      status: "requires_payment_method",
      setupUrl: "https://pay.test/s",
      setupSessionId: "cs_1",
      expiresAt: "2026-10-06T11:00:00.000Z",
    };
    expect(mapCheckout(setup)).toEqual(setup);
  });

  test("a voucher check: a refusal says nothing, a discount carries its currency code", () => {
    expect(mapVoucherValidation({ valid: false })).toEqual({ valid: false });
    expect(
      mapVoucherValidation({
        valid: true,
        voucher: {
          name: "Welcome 20%",
          voucherType: "PRICE",
          duration: "ONCE",
          durationInPeriods: null,
          discount: { type: "FIXED_AMOUNT", value: 500, currency: "EUR", appliesTo: "BASE" },
        },
      }),
    ).toEqual({
      valid: true,
      voucher: {
        name: "Welcome 20%",
        voucherType: "PRICE",
        duration: "ONCE",
        durationInPeriods: null,
        discount: { type: "FIXED_AMOUNT", value: 500, currencyCode: "EUR", appliesTo: "BASE" },
      },
    });
  });
});
