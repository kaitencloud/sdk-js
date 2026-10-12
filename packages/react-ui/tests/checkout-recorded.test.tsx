// @vitest-environment jsdom
//
// A checkout against the real session client and the answers Kaiten recorded for Initech: a
// preview, a request for a payment method, the subscription with its payment, and the refusals.
// The suites beside it script the answers to say what a server could; this one is held to what it
// did say, through the client that turns it into the types the components read.

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { BillingPrice, Plan } from "@kaitencloud/react";

import { CheckoutFlow } from "../src/index.ts";
import { refusal, sessionServer, type CheckoutScript } from "../.storybook/session-server.ts";
import { mount, press } from "./support/session-mount.tsx";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/billing");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A customer who has never subscribed, has an email, and has a payment method unless said otherwise. */
function server(options: { card?: boolean; checkout?: CheckoutScript } = {}) {
  const { card = true, checkout } = options;
  return sessionServer({
    portal: {
      ...answers.portalNeverSubscribed,
      customer: { ...answers.portalNeverSubscribed.customer, billingEmail: "billing@initech.test" },
      paymentMethod: card ? answers.portal.paymentMethod : null,
    },
    checkout,
  });
}

/** Pro, at the price the recorded subscription was bought at, as the client reads it. */
async function pro(): Promise<Plan> {
  const { subscription } = await sessionServer().client.getPortal();
  const price = subscription!.basePrice as BillingPrice;
  return {
    slug: "pro",
    name: "Pro",
    currencyCode: price.currencyCode,
    billingPrices: [price],
    entitlements: [],
  } as Plan;
}

async function draw(s: ReturnType<typeof server>) {
  mount(s, <CheckoutFlow plan={await pro()} />);
  await screen.findByText("Due today");
}

test("the recorded preview is shown as the server wrote it: its lines, its discount, its total", async () => {
  const s = server();
  await draw(s);

  const summary = within(document.querySelector('[data-slot="checkout-flow"]') as HTMLElement);
  expect(summary.getAllByText("Pro").length).toBeGreaterThan(1);
  expect(summary.getByText("Extra seats")).toBeTruthy();
  // 49.00 + 20.00 - 13.80 is 55.20 in the recording, and it is the recording's own figure that shows.
  expect(summary.getAllByText(/55[.,]20/).length).toBeGreaterThan(0);
  const [preview] = s.to("POST", "checkout");
  expect(preview!.body).toMatchObject({ dryRun: true });
});

test("a customer with a card is subscribed by the recorded answer, and the payment is paid", async () => {
  const s = server();
  await draw(s);

  await press(/^Subscribe/);

  expect(await screen.findByText("You're subscribed")).toBeTruthy();
  expect(await screen.findByText("Payment received.")).toBeTruthy();
  const commit = s.to("POST", "checkout").find((call) => !(call.body as any).dryRun);
  expect(commit!.body).toMatchObject({ licensePriceId: expect.any(String) });
});

test("without a card the customer is sent to the recorded setup page, in a popup", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({ opener: window } as unknown as Window);
  const s = server({ card: false });
  await draw(s);

  await press(/^Subscribe/);

  await screen.findByText(/Save your payment method/);
  expect(open).toHaveBeenCalledWith(
    "https://checkout.stripe.test/c/setup_1",
    "kaiten-setup",
    expect.any(String),
  );
});

test("a payment to confirm is the recorded link, and a trial is nothing due and the day it ends", async () => {
  const action = server({ checkout: { payment: "action" } });
  await draw(action);
  await press(/^Subscribe/);
  const link = await screen.findByRole("link", { name: "Complete payment" });
  expect(link.getAttribute("href")).toBe("https://pay.initech.test/i/1");
  cleanup();

  const trial = server({ checkout: { payment: "trial" } });
  mount(trial, <CheckoutFlow plan={await pro()} />);
  expect(await screen.findByText(/Trial ends on/)).toBeTruthy();
  expect(screen.getAllByText(/0[.,]00 today/).length).toBeGreaterThan(0);
  await press(/^Subscribe/);
  await waitFor(() => expect(screen.getByText(/Trial ends on/)).toBeTruthy());
});

test("the recorded refusals are the sentences a customer reads", async () => {
  const taken = server();
  taken.script("POST checkout", refusal("checkoutAlreadySubscribed"));
  mount(taken, <CheckoutFlow plan={await pro()} portalHref="https://app.test/billing" />);
  expect(await screen.findByText("You already have a subscription.")).toBeTruthy();
  cleanup();

  const down = server();
  down.script("POST checkout", refusal("checkoutProviderUnavailable"));
  mount(down, <CheckoutFlow plan={await pro()} />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("The payment provider can't be reached right now");
  fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Due today")).toBeTruthy();
});
