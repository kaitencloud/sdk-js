import { describe, expect, test } from "vite-plus/test";

import { mapCheckout, mapVoucherValidation } from "../src/client/session-mapping.ts";

const P = "2026-10-01T00:00:00.000Z";
const P1 = "2026-11-01T00:00:00.000Z";

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

/** The subscription of an active, monthly session. */
const SUBSCRIPTION = {
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

describe("invoices, checkout and vouchers", () => {
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
      subscription: SUBSCRIPTION,
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

  test("a trial end and a payment page the API leaves out read as null", () => {
    const preview = mapCheckout({ status: "preview", dueToday: INVOICE });
    const subscribed = mapCheckout({
      status: "subscribed",
      subscription: SUBSCRIPTION,
      activationInvoice: null,
      payment: { status: "not_required" },
    });

    expect(preview).toMatchObject({ status: "preview", trialEndsAt: null });
    expect(subscribed).toMatchObject({
      status: "subscribed",
      payment: { status: "not_required", hostedInvoiceUrl: null },
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
