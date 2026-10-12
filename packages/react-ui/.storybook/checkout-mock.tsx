// What the stories of a checkout draw: a customer session on the session double, and a server
// that prices what it is asked.
//
// The double's own checkout is a model of Kaiten's, and stays out of the way: a story has to be
// able to put the checkout in any state a customer meets, and every state of a payment is one a
// story scripts. The sums below are the mock server's, as a real server's are: nothing in the
// components adds a price up, and these amounts are what the screens show.

import * as React from "react";
import { SWRConfig } from "swr";

import { KaitenError, ProviderUnavailableError, QuotaExceededError } from "@kaitencloud/client";
import type {
  CheckoutInput,
  CheckoutPaymentStatus,
  CheckoutPreview,
  CheckoutResult,
  KaitenPortal,
  SessionInvoice,
} from "@kaitencloud/client";
import {
  createMockKaitenSessionClient,
  demoCheckoutPrices,
  demoSessionAddOns,
  demoSessionInvoices,
  demoUnsubscribedPortal,
  demoPortal,
  type MockKaitenSessionClient,
} from "@kaitencloud/client/testing";
import {
  KaitenProvider,
  type Addon,
  type KaitenLocalizationOverrides,
  type Plan,
} from "@kaitencloud/react";

import { KaitenStyleRoot } from "../src/style-root/kaiten-style-root.tsx";
import { STORYBOOK_API_BASE, useIsolatedSWRCache } from "./kaiten-mock.tsx";

/** The plan the stories sell: Growth, monthly or annual, with a two-week trial when a story says so. */
export function growthPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    slug: "growth",
    name: "Growth",
    currencyCode: "USD",
    compatibleAddonFamilies: ["extra-seats"],
    billingPrices: demoCheckoutPrices().filter((price) => price.id !== "price_starter_monthly"),
    entitlements: [],
    selfServe: true,
    ...overrides,
  };
}

/** The add-on the stories offer: seats, $25.00 each a month, 20 at most. */
export const extraSeats: Addon = demoSessionAddOns()[0]!;

const PRICES: Record<string, number> = { price_growth_monthly: 7900, price_growth_annual: 79000 };
const SEAT = 2500;
const TRIAL_ENDS = "2026-11-02T00:00:00.000Z";
export const STORY_CODE = "WELCOME20";

const refusal = (status: number, code: string, detail: string) =>
  new KaitenError({ title: detail, status, code, detail });

const PERIOD = { serviceFrom: "2026-10-19T00:00:00.000Z", serviceTo: "2026-11-19T00:00:00.000Z" };

/** What the mock server says is due today: its lines, and the total it is sure of. */
function previewOf(
  input: CheckoutInput,
  options: { trial: boolean; totalOverride?: number },
): CheckoutPreview {
  const base = PRICES[input.licensePriceId] ?? 0;
  const seats = (input.addOns ?? []).reduce((count, entry) => count + entry.quantity, 0);
  if (input.voucherCode && input.voucherCode.toUpperCase() !== STORY_CODE) {
    throw refusal(422, "CreateSessionCheckout.VoucherInvalid", "this voucher cannot be applied");
  }
  const skipsTrial = input.trial === false;
  if (options.trial && !skipsTrial) {
    return {
      status: "preview",
      dueToday: { currencyCode: "USD", subtotal: 0, discountTotal: 0, total: 0, lines: [] },
      trialEndsAt: TRIAL_ENDS,
    };
  }
  const discount = input.voucherCode ? Math.round(base / 5) : 0;
  const lines = [
    {
      seq: 1,
      type: "BASE",
      label: "Growth",
      description: `1 × ${(base / 100).toFixed(2)} USD`,
      quantity: "1",
      unitAmountDecimal: `${base}`,
      amount: base,
      ...PERIOD,
    },
    ...(seats > 0
      ? [
          {
            seq: 2,
            type: "ADDON",
            label: "Extra seats",
            description: `${seats} × ${(SEAT / 100).toFixed(2)} USD`,
            quantity: `${seats}`,
            unitAmountDecimal: `${SEAT}`,
            amount: seats * SEAT,
            ...PERIOD,
          },
        ]
      : []),
    ...(discount > 0
      ? [
          {
            seq: 3,
            type: "DISCOUNT",
            label: "Welcome 20%",
            description: "20% off the base fee",
            quantity: "1",
            unitAmountDecimal: null,
            amount: -discount,
            ...PERIOD,
          },
        ]
      : []),
  ];
  return {
    status: "preview",
    dueToday: {
      currencyCode: "USD",
      subtotal: base + seats * SEAT,
      discountTotal: discount,
      total: options.totalOverride ?? base + seats * SEAT - discount,
      lines,
    },
    trialEndsAt: null,
  };
}

const invoiceOf = (status: string, total: number): SessionInvoice => ({
  ...demoSessionInvoices()[1]!,
  id: "inv_story_activation",
  kind: "ACTIVATION",
  status,
  total,
  subtotal: total,
  paidAt: status === "PAID" ? "2026-10-19T09:00:05.000Z" : null,
  hostedInvoiceUrl: "https://pay.example.test/i/inv_story_activation",
});

/** What a story's checkout makes of the customer: how it ends, once they commit to it. */
export type StoryOutcome =
  | "paid"
  | "requires_action"
  | "failed"
  | "processing"
  | "trial"
  | "needs_payment_method"
  | "already_subscribed"
  | "quota_exceeded"
  | "unavailable"
  | "never";

export interface StoryCheckoutOptions {
  outcome?: StoryOutcome;
  /** The plan has a trial the customer has not skipped. */
  trial?: boolean;
  /** The customer has no billing email yet. */
  noEmail?: boolean;
  /** Every dry run is refused this way. */
  previewRefusal?: "quota_exceeded" | "unavailable" | "already_subscribed";
  /** Calls take this long to answer. */
  delayMs?: number;
  /** The total the server says, whatever its lines add up to: a screen shows this one. */
  totalOverride?: number;
}

/** A session double that sells Growth the way `options` say. */
export function createStoryCheckoutClient(
  options: StoryCheckoutOptions = {},
): MockKaitenSessionClient {
  const { outcome = "paid", trial = false, noEmail = false, previewRefusal } = options;
  const portal: KaitenPortal = demoUnsubscribedPortal();
  if (noEmail) portal.customer = { ...portal.customer, billingEmail: null };
  if (previewRefusal === "already_subscribed") Object.assign(portal, demoPortal());

  return createMockKaitenSessionClient({
    portal,
    delayMs: options.delayMs,
    checkout: (input): CheckoutResult | Promise<CheckoutResult> => {
      if (input.dryRun) {
        if (previewRefusal === "quota_exceeded") {
          throw new QuotaExceededError({
            title: "the instance already uses more than this plan allows",
            status: 422,
            code: "CreateSessionCheckout.QuotaExceeded",
            errors: [
              {
                location: "body.licensePriceId",
                message: "over",
                value: { entitlementSlugs: ["seats", "api-calls"] },
              },
            ],
          });
        }
        if (previewRefusal === "unavailable") {
          throw new ProviderUnavailableError(
            {
              title: "the payment provider could not be reached",
              status: 503,
              code: "CreateSessionCheckout.ProviderUnavailable",
            },
            { retryAfterSeconds: 30 },
          );
        }
        if (previewRefusal === "already_subscribed") {
          throw refusal(409, "CreateSessionCheckout.AlreadySubscribed", "already subscribed");
        }
        return previewOf(input, { trial, totalOverride: options.totalOverride });
      }
      if (outcome === "never") return new Promise<CheckoutResult>(() => {});
      if (outcome === "needs_payment_method" && !input.setupSessionId) {
        return {
          status: "requires_payment_method",
          setupUrl: "https://pay.example.test/setup/cs_story",
          setupSessionId: "cs_story",
          expiresAt: "2026-10-19T10:00:00.000Z",
        };
      }
      const payment: CheckoutPaymentStatus =
        outcome === "trial"
          ? "not_required"
          : outcome === "needs_payment_method"
            ? "paid"
            : outcome;
      const total = previewOf(input, { trial: false }).dueToday.total;
      const invoice =
        payment === "not_required"
          ? null
          : invoiceOf(payment === "paid" ? "PAID" : "PAYMENT_FAILED", total);
      return {
        status: "subscribed",
        subscription: {
          status: payment === "not_required" ? "TRIAL" : "ACTIVE",
          providerKind: "STRIPE",
          collectionMethod: "CHARGE_AUTOMATICALLY",
          currencyCode: "USD",
          billingInterval: "month",
          basePrice: demoCheckoutPrices()[1]!,
          currentPeriodStart: "2026-10-19T09:00:00.000Z",
          currentPeriodEnd: "2026-11-19T09:00:00.000Z",
          trialEndsAt: payment === "not_required" ? TRIAL_ENDS : null,
          cancelAtPeriodEnd: false,
          scheduledChange: null,
        },
        activationInvoice: invoice,
        payment: { status: payment, hostedInvoiceUrl: invoice?.hostedInvoiceUrl ?? null },
      };
    },
  });
}

/**
 * A customer-session provider on `client`, with the browser's popup stubbed: a story must never
 * open a window, and the checkout asks for one when a payment method is needed.
 */
export function KaitenCheckoutStoryProvider({
  client,
  children,
  locale,
}: {
  client: MockKaitenSessionClient;
  children: React.ReactNode;
  locale?: KaitenLocalizationOverrides;
}) {
  const provider = useIsolatedSWRCache();
  React.useEffect(() => {
    const open = window.open;
    window.open = () => ({ opener: window }) as unknown as Window;
    return () => {
      window.open = open;
    };
  }, []);
  return (
    <SWRConfig value={{ provider }}>
      <KaitenProvider
        mode="customer-session"
        sessionClient={client}
        apiUrl={STORYBOOK_API_BASE}
        polling={{ enabled: false }}
        locale={locale}
      >
        <KaitenStyleRoot>{children}</KaitenStyleRoot>
      </KaitenProvider>
    </SWRConfig>
  );
}

function CheckoutShell({
  options,
  locale,
  children,
}: {
  options: StoryCheckoutOptions;
  locale?: KaitenLocalizationOverrides;
  children: React.ReactNode;
}) {
  // Once for the story: a new session client is a new scope, with its own reads.
  const client = React.useMemo(() => createStoryCheckoutClient(options), [options]);
  return (
    <KaitenCheckoutStoryProvider client={client} locale={locale}>
      {children}
    </KaitenCheckoutStoryProvider>
  );
}

/**
 * A decorator for a story whose customer is in the situation `options` script, in `locale`. Call it
 * once, where the story is defined: the options are the identity of the client it builds.
 */
export function checkoutDecorator(
  options: StoryCheckoutOptions = {},
  locale?: KaitenLocalizationOverrides,
) {
  return function Decorator(Story: () => React.JSX.Element) {
    return (
      <CheckoutShell options={options} locale={locale}>
        <Story />
      </CheckoutShell>
    );
  };
}
