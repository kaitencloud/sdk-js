// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The answers of the anonymous checkout routes, typed by the contract. Unlike
// the catalogue and the customer session (fixtures/README.md), they are written
// by hand from the contract's descriptions, not produced by Kaiten's code: the
// routes are new. `anonymous-checkout.test.ts` holds every one of them to its
// response schema, and every request the client makes to its request schema.

import type { KaitenApi } from "../../src/index.ts";

export const SESSION_ID = "chk_01JD2Z8W4Q7M3N5P6R8T0V2X4Y";
export const OTHER_SESSION_ID = "chk_01JD2Z9A1B3C5D7F9H1K3M5N7P";
export const KSC = `ksc_${"c".repeat(43)}`;
export const OTHER_KSC = `ksc_${"d".repeat(43)}`;
export const PK = `pk_${"a".repeat(43)}`;
export const API = "https://api.acme.test/api";
export const RETURN_URL = "https://shop.acme.test/welcome";

const PRICE_ID = "00000000-0000-4000-8000-000000000301";
const NOW = "2026-10-22T10:00:00Z";
const IN_A_DAY = "2026-10-23T10:00:00Z";
const IN_A_MONTH = "2026-11-22T10:00:00Z";

const line = (overrides: Partial<KaitenApi.SessionLine> = {}): KaitenApi.SessionLine => ({
  seq: 1,
  type: "BASE",
  label: "Growth, monthly",
  description: "",
  quantity: "1",
  unitAmountDecimal: "4900",
  amount: 4900,
  serviceFrom: NOW,
  serviceTo: IN_A_MONTH,
  ...overrides,
});

/** What a paid plan bills today: 49.00 EUR, 10 % off. */
export const dueToday = (): KaitenApi.DueToday => ({
  currency: "EUR",
  subtotal: 4900,
  discountTotal: 490,
  total: 4410,
  lines: [
    line(),
    line({
      seq: 2,
      type: "DISCOUNT",
      label: "WELCOME10",
      unitAmountDecimal: null,
      amount: -490,
    }),
  ],
});

/** What a trial or a free plan bills today: nothing, and no line. */
export const nothingDue = (): KaitenApi.DueToday => ({
  currency: "EUR",
  subtotal: 0,
  discountTotal: 0,
  total: 0,
  lines: [],
});

export const startPreview = (
  overrides: Partial<KaitenApi.CheckoutSessionStart> = {},
): KaitenApi.CheckoutSessionStart => ({
  status: "preview",
  dueToday: dueToday(),
  trialEndsAt: null,
  trialRefusedReason: null,
  requiresPaymentMethod: true,
  ...overrides,
});

export const startOpen = (
  overrides: Partial<KaitenApi.CheckoutSessionStart> = {},
): KaitenApi.CheckoutSessionStart => ({
  status: "open",
  sessionId: SESSION_ID,
  token: KSC,
  expiresAt: IN_A_DAY,
  dueToday: dueToday(),
  trialEndsAt: null,
  trialRefusedReason: null,
  requiresPaymentMethod: true,
  ...overrides,
});

export const activationInvoice = (): KaitenApi.SessionInvoice => ({
  id: "00000000-0000-4000-8000-0000000004a1",
  kind: "ACTIVATION",
  status: "PAYMENT_FAILED",
  currency: "EUR",
  subtotal: 4900,
  discountTotal: 490,
  total: 4410,
  issuedAt: NOW,
  dueAt: NOW,
  paidAt: null,
  serviceFrom: NOW,
  serviceTo: IN_A_MONTH,
  providerInvoiceNumber: "ACME-0001",
  externalReference: null,
  hostedInvoiceUrl: "https://pay.acme.test/i/in_1",
  invoicePdfUrl: null,
  lines: dueToday().lines,
});

export const checkoutSession = (
  overrides: Partial<KaitenApi.CheckoutSession> = {},
): KaitenApi.CheckoutSession => ({
  sessionId: SESSION_ID,
  status: "OPEN",
  email: "ada@acme.test",
  clientReferenceId: "cart-42",
  licenseSlug: "growth-v1",
  billingPeriod: "MONTHLY",
  priceId: PRICE_ID,
  addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
  dueToday: dueToday(),
  trialEndsAt: null,
  trialRefusedReason: null,
  requiresPaymentMethod: true,
  expiresAt: IN_A_DAY,
  customerSlug: null,
  instanceSlug: null,
  activationInvoice: null,
  payment: null,
  createdAt: NOW,
  completedAt: null,
  ...overrides,
});

/** A session whose first invoice is not paid yet. */
export const awaitingSession = (): KaitenApi.CheckoutSession =>
  checkoutSession({
    status: "AWAITING_PAYMENT",
    customerSlug: "ada-x7k2",
    instanceSlug: "ada-x7k2-main",
    activationInvoice: activationInvoice(),
    payment: { status: "requires_action", hostedInvoiceUrl: "https://pay.acme.test/i/in_1" },
  });

/** A session that closed with a customer and an instance. */
export const completedSession = (
  overrides: Partial<KaitenApi.CheckoutSession> = {},
): KaitenApi.CheckoutSession =>
  checkoutSession({
    status: "COMPLETED",
    customerSlug: "ada-x7k2",
    instanceSlug: "ada-x7k2-main",
    completedAt: NOW,
    ...overrides,
  });

export const confirmation = (
  overrides: Partial<KaitenApi.CheckoutConfirmation> = {},
): KaitenApi.CheckoutConfirmation => ({
  status: "completed",
  session: completedSession(),
  ...overrides,
});

export const requiresPaymentMethod = (): KaitenApi.CheckoutConfirmation => ({
  status: "requires_payment_method",
  setupUrl: "https://checkout.stripe.test/c/setup_123",
  setupExpiresAt: IN_A_DAY,
  session: checkoutSession(),
});

/** A problem as Kaiten renders it. */
export const problem = (
  status: number,
  code: string,
  extra: Partial<KaitenApi.Problem> = {},
): KaitenApi.Problem => ({
  type: "https://tools.ietf.org/html/rfc4918#section-11.2",
  title: "Refused",
  status,
  detail: `refused with ${code}`,
  code,
  ...extra,
});
