// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the stories of an anonymous checkout draw: a page for visitors, with a catalogue that says the
// publishable key may start a checkout, the anonymous checkout double, and a stand-in for
// Cloudflare's script.
//
// The double's own model of a checkout (a payment method first, then the payment) is kept, and a
// story scripts the two things it cannot know: what the visitor does on the payment provider's page,
// and how the first payment ends. Nothing opens a window and nothing reaches the network.

import * as React from "react";

import type { BillingPrice, KaitenCatalog, Plan } from "@kaitencloud/client";
import {
  createMockKaitenAnonymousCheckoutClient,
  demoAnonymousCheckoutPlans,
  demoCheckoutPrices,
  type MockCheckoutPlan,
  type MockKaitenAnonymousCheckoutClient,
  type MockKaitenAnonymousCheckoutClientOptions,
} from "@kaitencloud/client/testing";
import { KaitenProvider, type KaitenLocalizationOverrides } from "@kaitencloud/react";

import { KaitenStyleRoot } from "../src/style-root/kaiten-style-root.tsx";
import { growthPlan } from "./checkout-mock.tsx";
import {
  installTurnstileDouble,
  TURNSTILE_TEST_KEYS,
  type TurnstileBehaviour,
} from "./turnstile-double.ts";

export { TURNSTILE_TEST_KEYS };

const [STARTER_PRICE] = demoCheckoutPrices();

const flatFee = (id: string, amount: number): BillingPrice => ({
  ...STARTER_PRICE!,
  id,
  amount,
  unitAmountDecimal: `${amount}`,
});

/** The plans the stories sell: Growth in two periods, free Starter, a trial with no card, a trial with one. */
export const growth = growthPlan({ selfServe: true });
export const starter: Plan = {
  slug: "starter",
  name: "Starter",
  currencyCode: "USD",
  billingPrices: [STARTER_PRICE!],
  entitlements: [],
  selfServe: true,
};
export const lite: Plan = {
  slug: "lite",
  name: "Lite",
  currencyCode: "USD",
  billingPrices: [flatFee("price_lite_monthly", 1900)],
  entitlements: [],
  selfServe: true,
  trialPeriodDays: 14,
};
export const pro: Plan = {
  slug: "pro",
  name: "Pro",
  currencyCode: "USD",
  billingPrices: [flatFee("price_pro_monthly", 4900)],
  entitlements: [],
  selfServe: true,
  trialPeriodDays: 7,
  requiresPaymentMethod: true,
};
export const enterprise: Plan = {
  slug: "enterprise",
  name: "Enterprise",
  currencyCode: "USD",
  billingPrices: [flatFee("price_enterprise_monthly", 99900)],
  entitlements: [],
  selfServe: false,
  selfServeCtaUrl: "https://example.test/contact",
};

const PRO_SALE: MockCheckoutPlan = {
  licenseSlug: "pro",
  priceId: "price_pro_monthly",
  billingPeriod: "MONTHLY",
  currencyCode: "USD",
  amount: 4900,
  trialDays: 7,
  requiresPaymentMethod: true,
};

/** How the first payment of a paid checkout ends, once the visitor saved a payment method. */
export type StoryPayment = "paid" | "processing" | "requires_action" | "failed" | "expired";

export interface StoryAnonymousOptions {
  /** What the security check does. Default: what Cloudflare's test key `1x…AA` does, it passes. */
  widget?: TurnstileBehaviour;
  /** The catalogue says the publishable key cannot start an anonymous checkout. */
  off?: boolean;
  /** Calls take this long to answer. */
  delayMs?: number;
  /** What the visitor does on the payment provider's page: save a payment method and come back, or stay. Default `stays`. */
  visitor?: "saves" | "stays";
  /** How the first payment ends. Default `paid`. */
  payment?: StoryPayment;
  /** Fails a method, or one call of it. */
  fail?: MockKaitenAnonymousCheckoutClientOptions["fail"];
  /** This e-mail already had the trial of Lite. */
  usedTrialEmail?: string;
  /** The page is the one the payment provider sends the visitor back to, naming this session. */
  returnedTo?: string;
  /** The plans of the catalogue. Default: Growth, Starter, Lite and Pro. */
  plans?: Plan[];
}

let latest: MockKaitenAnonymousCheckoutClient | null = null;

/** The client of the story on screen, for a play function that scripts what a visitor cannot. */
export function latestAnonymousClient(): MockKaitenAnonymousCheckoutClient {
  if (latest === null) throw new Error("No anonymous checkout story is mounted.");
  return latest;
}

const sessionOf = (url: unknown) => String(url).split("/").pop() ?? "";

/**
 * The page the visitor lands on in the popup says it is back: what the waiting window hears. The
 * channel keeps no history, so a message sent before the window listens is lost; the page says it
 * again until the window acknowledges it, as a real page that is still loading would not give up
 * after one try, and the story does not depend on how busy the machine is.
 */
function announceReturn(sessionId: string) {
  if (typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel("kaiten:setup-return");
  const say = () => channel.postMessage({ kaiten: "setup-returned", sessionId });
  const stop = () => {
    clearInterval(repeat);
    clearTimeout(giveUp);
    channel.close();
  };
  channel.onmessage = (event: MessageEvent<{ kaiten?: string; sessionId?: string } | null>) => {
    if (event.data?.kaiten === "setup-acknowledged" && event.data.sessionId === sessionId) stop();
  };
  const repeat = setInterval(say, 100);
  const giveUp = setTimeout(stop, 10_000);
  say();
}

/** The double, with the two things a story scripts. */
function scripted(
  base: MockKaitenAnonymousCheckoutClient,
  payment: StoryPayment,
): MockKaitenAnonymousCheckoutClient {
  return {
    ...base,
    async confirmCheckout(sessionId) {
      const result = await base.confirmCheckout(sessionId);
      if (result.status === "awaiting_payment") {
        if (payment === "paid") base.settlePayment(sessionId);
        else if (payment === "requires_action") base.requireAction(sessionId);
        else if (payment === "failed") base.failPayment(sessionId);
        else if (payment === "expired") base.expire(sessionId);
      }
      return result;
    },
  };
}

function Shell({
  options,
  locale,
  children,
}: {
  options: StoryAnonymousOptions;
  locale?: KaitenLocalizationOverrides;
  children: React.ReactNode;
}) {
  const [world] = React.useState(() => {
    // Before the first child renders, so that its effects find the stand-in and the address.
    const undo: (() => void)[] = [installTurnstileDouble(options.widget)];

    const base = createMockKaitenAnonymousCheckoutClient({
      plans: [...demoAnonymousCheckoutPlans(), PRO_SALE],
      delayMs: options.delayMs,
      fail: options.fail,
    });
    const client = scripted(base, options.payment ?? "paid");
    latest = client;

    if (options.usedTrialEmail) {
      void base
        .startCheckout({
          turnstileToken: "seed",
          priceId: "price_lite_monthly",
          email: options.usedTrialEmail,
          returnUrl: "https://shop.example.test/welcome",
        })
        .then((started) => base.confirmCheckout(started.sessionId));
    }

    const open = window.open;
    window.open = (url) => {
      if (options.visitor === "saves") {
        const sessionId = sessionOf(url);
        setTimeout(() => {
          base.completeSetup(sessionId);
          announceReturn(sessionId);
        }, 50);
      }
      return { opener: window } as unknown as Window;
    };
    undo.push(() => {
      window.open = open;
    });

    if (options.returnedTo) {
      const before = window.location.href;
      const url = new URL(before);
      url.searchParams.set("kaiten_checkout_session", options.returnedTo);
      window.history.replaceState(window.history.state, "", url);
      undo.push(() => window.history.replaceState(window.history.state, "", before));
    }

    const catalog: KaitenCatalog = {
      plans: options.plans ?? [growth, starter, lite, pro],
      capabilities: {
        checkout: true,
        paymentMethods: true,
        anonymousCheckout: options.off !== true,
        turnstileSiteKey: options.off === true ? null : TURNSTILE_TEST_KEYS.alwaysPasses,
      },
    };
    return { client, catalog, undo };
  });

  React.useEffect(
    () => () => {
      for (const undo of world.undo.reverse()) undo();
      if (latest === world.client) latest = null;
    },
    [world],
  );

  return (
    <KaitenProvider
      mode="static"
      catalog={world.catalog}
      anonymousCheckoutClient={world.client}
      locale={locale}
    >
      <KaitenStyleRoot>{children}</KaitenStyleRoot>
    </KaitenProvider>
  );
}

/**
 * A decorator for a story whose visitor is in the situation `options` script, in `locale`. Call it
 * once, where the story is defined: the options are the identity of the client it builds.
 */
export function anonymousCheckoutDecorator(
  options: StoryAnonymousOptions = {},
  locale?: KaitenLocalizationOverrides,
) {
  return function Decorator(Story: () => React.JSX.Element) {
    return (
      <Shell options={options} locale={locale}>
        <Story />
      </Shell>
    );
  };
}
