// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type {
  KaitenPortal,
  SessionAddon,
  SessionInvoice,
  VoucherSummary,
} from "../client/session-types.ts";
import type { BillingPrice } from "../client/types.ts";
import { demoEntitlements } from "./fixtures.ts";

/**
 * Fixtures for `createMockKaitenSessionClient`: what a customer portal and a
 * checkout read for Acme, the customer the other demo fixtures describe.
 *
 * Like those, every one is a factory, with fixed ids and dates, so a test that
 * changes what it received cannot reach another. The shapes are what
 * `KaitenSessionClient` returns, and amounts are in minor units.
 */

/** The instant the demo session reads: the portal's snapshot, and the start of its period. */
export const DEMO_SESSION_NOW = "2026-01-15T09:00:00.000Z";

/** When a payment method setup page opened by the demo session expires. */
export const DEMO_SETUP_EXPIRES_AT = "2026-01-15T10:00:00.000Z";

/** When the trial of `demoTrialPortal` ends. */
export const DEMO_TRIAL_ENDS_AT = "2026-01-29T09:00:00.000Z";

const PERIOD_START = "2026-01-01T00:00:00.000Z";
const PERIOD_END = "2026-02-01T00:00:00.000Z";

const flatFee = (
  id: string,
  amount: number,
  interval: "month" | "year",
  label: string,
): BillingPrice => ({
  id,
  amount,
  unitAmountDecimal: `${amount}`,
  currencyCode: "USD",
  billingModel: "FLAT_FEE",
  isDefault: true,
  interval,
  label,
});

/** The prices of the public plans a demo checkout can buy: Starter is free. */
export function demoCheckoutPrices(): BillingPrice[] {
  return [
    flatFee("price_starter_monthly", 0, "month", "Monthly"),
    flatFee("price_growth_monthly", 7900, "month", "Monthly"),
    flatFee("price_growth_annual", 79000, "year", "Annual"),
  ];
}

/** Add-ons of the demo portal: the instance holds two of the seats that fit it. */
export function demoSessionAddOns(): SessionAddon[] {
  const monthly = flatFee("price_extra_seats_monthly", 2500, "month", "Monthly");
  return [
    {
      slug: "extra-seats-v1",
      familySlug: "extra-seats",
      name: "Extra seats",
      quantity: 2,
      maxQuantity: 20,
      price: monthly.amount,
      currencyCode: "USD",
      interval: "month",
      prices: [{ ...monthly, amount: 2500, interval: "month" }],
      billingPrices: [monthly],
    },
  ];
}

/**
 * The portal of a session bound to Acme's production instance: subscribed to
 * Growth, paying by card, with its effective entitlements, one add-on, and an
 * estimate of the next invoice.
 */
export function demoPortal(overrides: Partial<KaitenPortal> = {}): KaitenPortal {
  const basePrice = demoCheckoutPrices()[1]!;
  return {
    customer: { slug: "acme", name: "Acme Corporation", billingEmail: "billing@acme.example" },
    instance: {
      slug: "acme-production",
      name: "Production",
      licenseSlug: "growth",
      licenseName: "Growth",
    },
    instances: [],
    subscription: {
      status: "ACTIVE",
      providerKind: "STRIPE",
      collectionMethod: "CHARGE_AUTOMATICALLY",
      currencyCode: "USD",
      billingInterval: "month",
      basePrice,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      scheduledChange: null,
    },
    entitlements: demoEntitlements(),
    addOns: demoSessionAddOns(),
    vouchers: [],
    paymentMethod: { status: "ACTIVE", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
    upcomingInvoice: {
      currencyCode: "USD",
      subtotal: 12900,
      discountTotal: 0,
      total: 12900,
      boundaryAt: PERIOD_END,
    },
    capabilities: { paymentMethods: true, invoices: true, unsubscribe: true, checkout: false },
    trial: null,
    updatedAt: DEMO_SESSION_NOW,
    ...overrides,
  };
}

/**
 * The portal of a session whose instance is in the trial of Growth, which ends on the 29th of
 * January: no card on file yet, so that the end of the trial charges $79.00 to a card that is still
 * to be added. Pass `overrides` for a trial that already has its card (`paymentMethod` and
 * `trial.paymentMethod`) or one that charges nothing (`trial.charge: null`).
 */
export function demoTrialPortal(overrides: Partial<KaitenPortal> = {}): KaitenPortal {
  const portal = demoPortal();
  return demoPortal({
    subscription: {
      ...portal.subscription!,
      status: "TRIAL",
      currentPeriodEnd: DEMO_TRIAL_ENDS_AT,
      trialEndsAt: DEMO_TRIAL_ENDS_AT,
    },
    addOns: [],
    paymentMethod: null,
    upcomingInvoice: null,
    trial: {
      endsAt: DEMO_TRIAL_ENDS_AT,
      reminderAt: "2026-01-26T09:00:00.000Z",
      charge: { amount: 7900, currencyCode: "USD", billingInterval: "month" },
      paymentMethod: null,
    },
    ...overrides,
  });
}

/**
 * The portal of an instance that was never subscribed, whose plan can be
 * bought alone: no subscription, no payment method, and a checkout to offer.
 */
export function demoUnsubscribedPortal(): KaitenPortal {
  return demoPortal({
    subscription: null,
    entitlements: [],
    addOns: [],
    paymentMethod: null,
    upcomingInvoice: null,
    capabilities: { paymentMethods: true, invoices: true, unsubscribe: false, checkout: true },
  });
}

/** The invoices of the demo portal, newest first: the last renewal and the first invoice. */
export function demoSessionInvoices(): SessionInvoice[] {
  const invoice = (
    id: string,
    kind: SessionInvoice["kind"],
    from: string,
    to: string,
  ): SessionInvoice => ({
    id,
    kind,
    status: "PAID",
    currencyCode: "USD",
    subtotal: 7900,
    discountTotal: 0,
    total: 7900,
    issuedAt: from,
    dueAt: from,
    paidAt: from,
    serviceFrom: from,
    serviceTo: to,
    providerInvoiceNumber: `INV-${id.slice(-4).toUpperCase()}`,
    externalReference: null,
    hostedInvoiceUrl: `https://pay.example.test/i/${id}`,
    invoicePdfUrl: `https://pay.example.test/i/${id}.pdf`,
    lines: [
      {
        seq: 1,
        type: "BASE",
        label: "Growth",
        description: "1 × 79.00 USD",
        quantity: "1",
        unitAmountDecimal: "7900",
        amount: 7900,
        serviceFrom: from,
        serviceTo: to,
      },
    ],
  });
  return [
    invoice("inv_demo_0002", "RENEWAL", PERIOD_START, PERIOD_END),
    invoice("inv_demo_0001", "ACTIVATION", "2025-12-01T00:00:00.000Z", PERIOD_START),
  ];
}

/**
 * The voucher codes a demo checkout accepts: `WELCOME20`, 20% off the base fee for three invoices,
 * and `DOUBLECALLS`, a boost of the API calls.
 */
export function demoVouchers(): Record<string, VoucherSummary> {
  return {
    WELCOME20: {
      name: "Welcome 20%",
      voucherType: "PRICE",
      duration: "REPEATING",
      durationInPeriods: 3,
      discount: { type: "PERCENTAGE", value: "20", appliesTo: "LICENSE_BASE" },
    },
    DOUBLECALLS: {
      name: "Double API calls",
      voucherType: "ENTITLEMENT_BOOST",
      duration: "FOREVER",
      durationInPeriods: null,
      boosts: [{ entitlementSlug: "api-calls", modifierType: "MULTIPLY", modifierValue: "2" }],
    },
  };
}
