// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the suites of the billing hooks share: a provider on a session double, and the answers a
// checkout gives, in the shapes the client maps them to.

import type { ReactNode } from "react";
import { act } from "@testing-library/react";
import { vi } from "vite-plus/test";
import {
  BoundaryPendingError,
  KaitenError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
  type CheckoutPreview,
  type CheckoutSubscribed,
  type KaitenPortal,
  type KaitenSessionClientLike,
  type PortalSubscription,
  type SessionInvoice,
  type SessionInvoiceLine,
} from "@kaitencloud/client";
import {
  createMockKaitenSessionClient,
  demoPortal,
  demoSessionInvoices,
  demoUnsubscribedPortal,
  type MockKaitenSessionClient,
  type MockKaitenSessionClientOptions,
} from "@kaitencloud/client/testing";

import { KaitenProvider } from "../../src/index.ts";

export { demoPortal, demoSessionInvoices, demoUnsubscribedPortal };

/** The provider of a customer session on `client`, with no polling: a read happens when a test says so. */
export function sessionProvider(client: KaitenSessionClientLike) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KaitenProvider
        mode="customer-session"
        sessionClient={client}
        apiUrl="https://kaiten.test/api"
        polling={{ enabled: false }}
      >
        {children}
      </KaitenProvider>
    );
  };
}

/** A session double for an instance that was never subscribed: what a checkout is for. */
export function unsubscribedSession(
  options: MockKaitenSessionClientOptions = {},
): MockKaitenSessionClient {
  return createMockKaitenSessionClient({ portal: demoUnsubscribedPortal(), ...options });
}

/** The portal of a customer that has no billing email yet. */
export function portalWithoutEmail(): KaitenPortal {
  const portal = demoUnsubscribedPortal();
  return { ...portal, customer: { ...portal.customer, billingEmail: null } };
}

const PERIOD = { serviceFrom: "2026-01-15T09:00:00.000Z", serviceTo: "2026-02-15T09:00:00.000Z" };

export const line = (
  seq: number,
  type: string,
  label: string,
  amount: number,
): SessionInvoiceLine => ({
  seq,
  type,
  label,
  description: "",
  quantity: "1",
  unitAmountDecimal: type === "DISCOUNT" ? null : `${amount}`,
  amount,
  ...PERIOD,
});

/**
 * What a checkout's `dryRun` answers. The total is given, never derived from the lines: the
 * server's value is the one a screen must show, and a test needs to be able to tell it from a sum.
 */
export function previewOf(total: number, lines: SessionInvoiceLine[] = []): CheckoutPreview {
  return {
    status: "preview",
    dueToday: {
      currencyCode: "EUR",
      subtotal: lines
        .filter((entry) => entry.amount > 0)
        .reduce((sum, entry) => sum + entry.amount, 0),
      discountTotal: 0,
      total,
      lines,
    },
    trialEndsAt: null,
  };
}

/** A preview during a trial: nothing due, and the day the first invoice is. */
export const trialPreview = (trialEndsAt: string): CheckoutPreview => ({
  ...previewOf(0),
  trialEndsAt,
});

const base = {
  currencyCode: "EUR" as const,
  amount: 4900,
  unitAmountDecimal: "4900",
  billingModel: "FLAT_FEE" as const,
  isDefault: true,
  interval: "month" as const,
};

export const subscription: PortalSubscription = {
  status: "ACTIVE",
  providerKind: "STRIPE",
  collectionMethod: "CHARGE_AUTOMATICALLY",
  currencyCode: "EUR",
  billingInterval: "month",
  basePrice: { id: "price_pro_monthly", ...base },
  currentPeriodStart: "2026-01-15T09:00:00.000Z",
  currentPeriodEnd: "2026-02-15T09:00:00.000Z",
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
  scheduledChange: null,
};

export const activationInvoice = (status: string, id = "inv_activation"): SessionInvoice => ({
  ...demoSessionInvoices()[0]!,
  id,
  kind: "ACTIVATION",
  status,
  total: 4900,
  currencyCode: "EUR",
  paidAt: status === "PAID" ? "2026-01-15T09:00:05.000Z" : null,
  hostedInvoiceUrl: `https://pay.example.test/i/${id}`,
});

/** The answer of a checkout that subscribed the instance, with the payment as it went. */
export function subscribed(
  status: string,
  invoice: SessionInvoice | null = activationInvoice(status === "paid" ? "PAID" : "PAYMENT_FAILED"),
): CheckoutSubscribed {
  return {
    status: "subscribed",
    subscription,
    activationInvoice: invoice,
    payment: { status, hostedInvoiceUrl: invoice?.hostedInvoiceUrl ?? null },
  };
}

export const REQUIRES_METHOD = {
  status: "requires_payment_method" as const,
  setupUrl: "https://pay.example.test/setup/cs_1",
  setupSessionId: "cs_1",
  expiresAt: "2026-01-15T10:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Refusals, as the client throws them
// ---------------------------------------------------------------------------

const problem = (status: number, code: string, detail = code) => ({
  title: detail,
  status,
  code,
  detail,
});

export const alreadySubscribed = () =>
  new KaitenError(problem(409, "CreateSessionCheckout.AlreadySubscribed"));
export const voucherInvalid = () =>
  new KaitenError(problem(422, "CreateSessionCheckout.VoucherInvalid"));
export const setupIncomplete = () =>
  new KaitenError(problem(409, "CreateSessionCheckout.SetupSessionIncomplete"));
export const billingEmailRequired = () =>
  new KaitenError(problem(422, "CreateSessionCheckout.BillingEmailRequired"));
export const cannotCapture = () =>
  new KaitenError(problem(422, "CreateSessionCheckout.ProviderCannotCapturePayment"));
export const quotaExceeded = (...entitlementSlugs: string[]) =>
  new QuotaExceededError({
    ...problem(422, "CreateSessionCheckout.QuotaExceeded"),
    errors: [{ location: "body.licensePriceId", message: "over", value: { entitlementSlugs } }],
  });
export const providerUnavailable = (seconds = 30) =>
  new ProviderUnavailableError(problem(503, "CreateSessionCheckout.ProviderUnavailable"), {
    retryAfterSeconds: seconds,
  });
export const rateLimited = (seconds = 90) =>
  new RateLimitedError(problem(429, "ValidateSessionVoucher.RateLimited"), {
    retryAfterSeconds: seconds,
  });
export const boundaryPending = (seconds = 60) =>
  new BoundaryPendingError(problem(409, "SetSessionAddonQuantity.BoundaryPending"), {
    retryAfterSeconds: seconds,
  });
export const setupNotComplete = () =>
  new KaitenError(problem(409, "CompleteSessionPaymentMethodSession.SessionNotComplete"));

/** The calls a double received for one method, oldest first, as their first argument. */
export function callsOf(client: MockKaitenSessionClient, method: string): unknown[] {
  return client.calls.filter((call) => call.method === method).map((call) => call.args[0]);
}

/**
 * Lets the fake timers run for `ms` and every promise they started settle, then the zero-delay
 * timers those settled into, once React has rendered what the first ones changed.
 */
export async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** The timers a debounce or a poll is made of, and the clock. Frames and microtasks stay real. */
export const FAKE_TIMERS = {
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as (
    | "setTimeout"
    | "clearTimeout"
    | "setInterval"
    | "clearInterval"
    | "Date"
  )[],
};
