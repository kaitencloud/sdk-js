// @vitest-environment jsdom
//
// How a checkout opened the provider's page, `CheckoutSetup["opening"]`, is a union that grows
// (STABILITY.md, "Unions that grow"): a later `@kaitencloud/react` 1.x may open the page in a way
// this package has never heard of, and a published `@kaitencloud/react-ui` runs beside it.
// `CheckoutFlow` reads nothing of it: the step of a payment method to save is drawn the same,
// whatever the way. Here the real hook runs, and what it hands the component says a way the
// union does not list, as a newer core would.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { CheckoutInput, CheckoutResult } from "@kaitencloud/client";
import { DEMO_SESSION_NOW } from "@kaitencloud/client/testing";

import { CheckoutFlow } from "../src/index.ts";
import {
  FAKE_TIMERS,
  callsOf,
  extraSeats,
  growthPlan,
  line,
  previewOf,
  sessionProvider,
  settle,
  subscribed,
  unsubscribedSession,
} from "./support/checkout.tsx";

/** A way of opening the page that no release of the core names today. */
const UNKNOWN_OPENING = "in_a_side_panel";

/**
 * The openings the component was handed, so that the test knows the double was in place. Emptied
 * before each case: what the styled one was handed proves nothing of the unstyled one.
 */
const handed = vi.hoisted(() => new Set<unknown>());

vi.mock("@kaitencloud/react/billing", async (importOriginal) => {
  const billing = await importOriginal<typeof import("@kaitencloud/react/billing")>();
  return {
    ...billing,
    useCheckout: (...args: Parameters<typeof billing.useCheckout>) => {
      const checkout = billing.useCheckout(...args);
      if (!checkout.setup) return checkout;
      const opening = UNKNOWN_OPENING as unknown as NonNullable<typeof checkout.setup.opening>;
      handed.add(opening);
      return { ...checkout, setup: { ...checkout.setup, opening } };
    },
  };
});

const SETUP_URL = "https://pay.example.test/setup/cs_1";

beforeEach(() => {
  handed.clear();
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(new Date(DEMO_SESSION_NOW));
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/billing");
  vi.spyOn(window, "open").mockReturnValue({ opener: window } as unknown as Window);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A checkout that asks for a payment method, then subscribes once the setup session comes back. */
function needingACard() {
  return unsubscribedSession({
    checkout: (input: CheckoutInput): CheckoutResult =>
      input.dryRun
        ? previewOf(7900, [line(1, "BASE", "Growth", 7900)])
        : input.setupSessionId
          ? subscribed("paid")
          : {
              status: "requires_payment_method",
              setupUrl: SETUP_URL,
              setupSessionId: "cs_1",
              expiresAt: "2026-01-15T10:00:00.000Z",
            },
  });
}

const flow = () => document.querySelector<HTMLElement>('[data-slot="checkout-flow"]')!;

async function press(target: HTMLElement) {
  await act(async () => fireEvent.click(target));
  await settle();
}

test.each([
  ["styled", false],
  ["unstyled", true],
] as const)(
  "%s: a way of opening the page it does not know draws the step all the same",
  async (_rendering, unstyled) => {
    const client = needingACard();
    const Wrapper = sessionProvider(client);
    render(
      <Wrapper>
        <CheckoutFlow plan={growthPlan()} addOns={[extraSeats]} unstyled={unstyled} />
      </Wrapper>,
    );
    await settle();
    await press(screen.getByRole("button", { name: /^Subscribe/ }));

    expect([...handed]).toEqual([UNKNOWN_OPENING]);
    const root = within(flow());
    expect(root.getByText(/Save your payment method in the window we opened/)).toBeTruthy();
    expect(root.getByRole("link", { name: "Open the page again" }).getAttribute("href")).toBe(
      SETUP_URL,
    );

    // The customer is back: the checkout goes on with the setup session, as for any opening.
    await press(root.getByRole("button", { name: "I've saved my payment method" }));
    const commits = (callsOf(client, "checkout") as CheckoutInput[]).filter(
      (input) => !input.dryRun,
    );
    expect(commits.at(-1)).toMatchObject({ setupSessionId: "cs_1" });
    expect(within(flow()).getByText("You're subscribed")).toBeTruthy();
  },
);
