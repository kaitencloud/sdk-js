// What the suites of the checkout components share: a styled provider on a session double, the
// answers a checkout gives, and the plan and add-on they sell.
//
// A copy, in part, of `packages/react/tests/support/billing.tsx`, for the reason
// `kaiten-client-double.ts` is one: each package type-checks its own tests.

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
  type KaitenSessionClientLike,
  type PortalSubscription,
  type SessionInvoice,
  type SessionInvoiceLine,
} from "@kaitencloud/client";
import {
  createMockKaitenSessionClient,
  demoCheckoutPrices,
  demoPortal,
  demoSessionAddOns,
  demoSessionInvoices,
  demoUnsubscribedPortal,
  type MockKaitenSessionClient,
  type MockKaitenSessionClientOptions,
} from "@kaitencloud/client/testing";
import type { Addon, KaitenLocalizationOverrides, Plan } from "@kaitencloud/react";

import { KaitenProvider } from "./styled-provider.tsx";

export { demoPortal, demoUnsubscribedPortal };

/** The provider of a customer session on `client`, with a style root and no polling. */
export function sessionProvider(
  client: KaitenSessionClientLike,
  extra: { locale?: KaitenLocalizationOverrides } = {},
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KaitenProvider
        mode="customer-session"
        sessionClient={client}
        apiUrl="https://kaiten.test/api"
        polling={{ enabled: false }}
        {...extra}
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

/** The plan the suites sell: Growth, monthly or annual. */
export function growthPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    slug: "growth",
    name: "Growth",
    currencyCode: "USD",
    compatibleAddonFamilies: ["extra-seats"],
    billingPrices: demoCheckoutPrices().filter((price) => price.id !== "price_starter_monthly"),
    entitlements: [],
    ...overrides,
  };
}

/** The add-on they offer: seats, $25.00 each a month, 20 at most. */
export const extraSeats: Addon = demoSessionAddOns()[0]!;

export const PERIOD = {
  serviceFrom: "2026-01-15T09:00:00.000Z",
  serviceTo: "2026-02-15T09:00:00.000Z",
};

export const line = (
  seq: number,
  type: string,
  label: string,
  amount: number,
  description = "",
): SessionInvoiceLine => ({
  seq,
  type,
  label,
  description,
  quantity: "1",
  unitAmountDecimal: type === "DISCOUNT" ? null : `${amount}`,
  amount,
  ...PERIOD,
});

/** What a checkout's `dryRun` answers; the total is the server's, whatever the lines add up to. */
export function previewOf(total: number, lines: SessionInvoiceLine[] = []): CheckoutPreview {
  return {
    status: "preview",
    dueToday: { currencyCode: "USD", subtotal: total, discountTotal: 0, total, lines },
    trialEndsAt: null,
  };
}

export const trialPreview = (trialEndsAt: string): CheckoutPreview => ({
  ...previewOf(0),
  trialEndsAt,
});

export const subscription: PortalSubscription = {
  status: "ACTIVE",
  providerKind: "STRIPE",
  collectionMethod: "CHARGE_AUTOMATICALLY",
  currencyCode: "USD",
  billingInterval: "month",
  basePrice: demoCheckoutPrices()[1]!,
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
  paidAt: status === "PAID" ? "2026-01-15T09:00:05.000Z" : null,
  hostedInvoiceUrl: `https://pay.example.test/i/${id}`,
});

export function subscribed(
  status: string,
  invoice: SessionInvoice | null = activationInvoice(status === "paid" ? "PAID" : "PAYMENT_FAILED"),
  patch: Partial<PortalSubscription> = {},
): CheckoutSubscribed {
  return {
    status: "subscribed",
    subscription: { ...subscription, ...patch },
    activationInvoice: invoice,
    payment: { status, hostedInvoiceUrl: invoice?.hostedInvoiceUrl ?? null },
  };
}

const problem = (status: number, code: string) => ({ title: code, status, code, detail: code });

export const alreadySubscribed = () =>
  new KaitenError(problem(409, "CreateSessionCheckout.AlreadySubscribed"));
export const voucherInvalid = () =>
  new KaitenError(problem(422, "CreateSessionCheckout.VoucherInvalid"));
export const setupIncomplete = () =>
  new KaitenError(problem(409, "CreateSessionCheckout.SetupSessionIncomplete"));
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
  new RateLimitedError(problem(429, "CreateSessionCheckout.RateLimited"), {
    retryAfterSeconds: seconds,
  });
export const cannotCapture = () =>
  new KaitenError(problem(422, "CreateSessionCheckout.ProviderCannotCapturePayment"));
export const boundaryPending = (seconds = 60) =>
  new BoundaryPendingError(problem(409, "SetSessionAddonQuantity.BoundaryPending"), {
    retryAfterSeconds: seconds,
  });

/** The calls a double received for one method, oldest first, as their first argument. */
export function callsOf(client: MockKaitenSessionClient, method: string): unknown[] {
  return client.calls.filter((call) => call.method === method).map((call) => call.args[0]);
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

/** Lets the fake timers run for `ms` and every promise they started settle, then what that renders. */
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
