// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// The payment method card of a customer session, on the real session client and the answers Kaiten
// recorded for Initech: the labels of the card the invoices are charged to, and the ways to add one
// or replace it, through the provider's hosted page and back. A card number is nowhere in what the
// API sends, so nowhere in what the card shows; and where the provider cannot capture one at all,
// the card is not there.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { fr } from "@kaitencloud/react/locales";

import { CustomerPortal, PaymentMethodCard } from "../src/index.ts";
import { sessionServer } from "../.storybook/session-server.ts";
import { mount, press } from "./support/session-mount.tsx";
import { KaitenProvider } from "./support/styled-provider.tsx";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

const at = (url: string) => window.history.replaceState(null, "", url);

beforeEach(() => {
  window.sessionStorage.clear();
  at("/billing?tab=payment");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The recorded portal of an active subscription, with its payment method changed. */
function portalWith(paymentMethod: Record<string, unknown> | null) {
  const portal: Record<string, any> = structuredClone(answers.portal);
  portal.paymentMethod = paymentMethod;
  return portal;
}

const visa = (patch: Record<string, unknown> = {}) => ({
  status: "ACTIVE",
  brand: "visa",
  last4: "4242",
  expMonth: 12,
  expYear: 2030,
  ...patch,
});

test("says the labels of the payment method, and never a number", async () => {
  mount(sessionServer(), <PaymentMethodCard />);

  expect(await screen.findByText("Visa •••• 4242")).toBeTruthy();
  expect(screen.getByText("Expires 12/2030")).toBeTruthy();
  expect(screen.getByText("Payment method")).toBeTruthy();
  // Nothing is wrong with it, so nothing says so.
  expect(screen.queryByText("Expired")).toBeNull();
  expect(screen.queryByText("Failed")).toBeNull();
  expect(screen.getByRole("button", { name: "Update payment method" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Manage in billing portal" })).toBeTruthy();
});

test("an expired card is said, and the way out is the primary action", async () => {
  mount(sessionServer({ portal: portalWith(visa({ status: "EXPIRED" })) }), <PaymentMethodCard />);
  expect(await screen.findByText("Expired")).toBeTruthy();
  expect(
    screen.getByText("This card has expired. Add a new one to keep paying automatically."),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Update payment method" }).getAttribute("data-variant"),
  ).toBe("default");
});

test("a card whose last payment failed is said", async () => {
  mount(sessionServer({ portal: portalWith(visa({ status: "FAILED" })) }), <PaymentMethodCard />);
  expect(await screen.findByText("Failed")).toBeTruthy();
  expect(screen.getByText("Your last payment failed. Update your payment method.")).toBeTruthy();
});

test("the provider gives what it knows: a label it does not give is left out, not made up", async () => {
  mount(
    sessionServer({
      portal: portalWith(visa({ brand: "unknown", expMonth: null, expYear: null })),
    }),
    <PaymentMethodCard />,
  );
  expect(await screen.findByText("Card •••• 4242")).toBeTruthy();
  expect(screen.queryByText(/^Expires/)).toBeNull();
  cleanup();
  mount(
    sessionServer({ portal: portalWith(visa({ brand: "amex", last4: null })) }),
    <PaymentMethodCard />,
  );
  expect(await screen.findByText("American Express")).toBeTruthy();
});

test("is not there at all when the provider cannot capture a payment method", async () => {
  const portal = portalWith(null);
  portal.capabilities.paymentMethods = false;
  const server = sessionServer({ portal });
  const { container } = mount(server, <PaymentMethodCard />);
  await vi.waitFor(() => expect(server.to("GET", "portal")).toHaveLength(1));
  await act(async () => {});
  // No element, and no empty card.
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
  expect(container.textContent).toBe("");
});

test("nor under any other mode", () => {
  const { container } = render(
    <KaitenProvider mode="static" catalog={{ plans: [] }}>
      <PaymentMethodCard />
    </KaitenProvider>,
  );
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
});

test("a customer with none is offered to add one, and sent to the provider's page and back", async () => {
  const navigate = vi.fn();
  const server = sessionServer({ portal: portalWith(null) });
  mount(server, <PaymentMethodCard navigate={navigate} />);

  expect(await screen.findByText("No payment method saved.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Manage in billing portal" })).toBeNull();
  await press("Add a payment method");

  const [call] = server.to("POST", "billing/payment-method-session");
  // Back to the page they were on, minus anything of ours.
  expect(call!.body).toMatchObject({ returnUrl: `${window.location.origin}/billing?tab=payment` });
  // A live subscription has a currency of its own: it is not asked for.
  expect(call!.body).not.toHaveProperty("currency");
  expect(navigate).toHaveBeenCalledExactlyOnceWith("https://checkout.stripe.test/c/setup_2");
});

test("the card is confirmed when the customer is back, and the portal read again", async () => {
  const server = sessionServer({ portal: portalWith(null) });
  mount(server, <PaymentMethodCard navigate={vi.fn()} />);
  await press("Add a payment method");
  expect(screen.queryByText("Visa •••• 4242")).toBeNull();

  // The provider's page sends the customer back to this one, with the setup session.
  cleanup();
  at("/billing?tab=payment&kaiten_setup_session=cs_setup_2");
  mount(server, <PaymentMethodCard navigate={vi.fn()} />);

  expect(await screen.findByText("Visa •••• 4242")).toBeTruthy();
  expect(server.to("POST", "billing/payment-method-session/cs_setup_2/complete")).toHaveLength(1);
  expect(await screen.findByText("Payment method updated.")).toBeTruthy();
  // The parameter is gone, and the rest of the address is not.
  expect(window.location.search).toBe("?tab=payment");
});

test("a page the customer did not finish is said, with a way to check again", async () => {
  const server = sessionServer({ portal: portalWith(null) });
  server.script("POST billing/payment-method-session/*/complete", {
    status: 409,
    body: {
      title: "Conflict",
      status: 409,
      detail: "no payment method was saved on that page",
      code: "CompleteSessionPaymentMethodSession.SessionNotComplete",
    },
  });
  mount(server, <PaymentMethodCard navigate={vi.fn()} />);
  await press("Add a payment method");
  cleanup();
  at("/billing?kaiten_setup_session=cs_setup_2");
  mount(server, <PaymentMethodCard navigate={vi.fn()} />);

  expect(
    await screen.findByText("We haven't received a payment method yet. Add one, or check again."),
  ).toBeTruthy();
  expect(screen.getByRole("alert")).toBeTruthy();

  await press("Try again");
  expect(await screen.findByText("Visa •••• 4242")).toBeTruthy();
  expect(server.to("POST", "billing/payment-method-session/cs_setup_2/complete")).toHaveLength(2);
});

test("a customer with no live subscription says which currency", async () => {
  const portal = portalWith(null);
  portal.subscription = null;
  portal.capabilities.unsubscribe = false;
  const navigate = vi.fn();
  const server = sessionServer({ portal });
  mount(server, <PaymentMethodCard currencyCode="EUR" navigate={navigate} />);
  await press("Add a payment method");
  expect(server.to("POST", "billing/payment-method-session")[0]!.body).toMatchObject({
    currency: "EUR",
  });
});

test("a customer whose subscription ended is set up in the currency they had", async () => {
  const portal = portalWith(null);
  portal.subscription.status = "CANCELED";
  const server = sessionServer({ portal });
  mount(server, <PaymentMethodCard navigate={vi.fn()} />);
  await press("Add a payment method");
  expect(server.to("POST", "billing/payment-method-session")[0]!.body).toMatchObject({
    currency: "EUR",
  });
});

test("a currency the host names does not override a live subscription's", async () => {
  const server = sessionServer();
  mount(server, <PaymentMethodCard currencyCode="USD" navigate={vi.fn()} />);
  await press("Update payment method");
  expect(server.to("POST", "billing/payment-method-session")[0]!.body).not.toHaveProperty(
    "currency",
  );
});

test("a provider that cannot be reached is said", async () => {
  const server = sessionServer();
  server.script("POST billing/payment-method-session", {
    status: 503,
    body: {
      title: "Service Unavailable",
      status: 503,
      detail: "the payment provider could not be reached; retry in a moment",
      code: "CreateSessionPaymentMethodSession.ProviderUnavailable",
    },
    retryAfter: 30,
  });
  mount(server, <PaymentMethodCard navigate={vi.fn()} />);
  await press("Update payment method");
  expect(
    await screen.findByText(
      "The payment provider can't be reached right now. Try again in a moment.",
    ),
  ).toBeTruthy();
});

test("the provider's own billing portal is one press away", async () => {
  const navigate = vi.fn();
  const server = sessionServer();
  mount(server, <PaymentMethodCard navigate={navigate} />);
  await press("Manage in billing portal");

  expect(server.to("POST", "billing/portal-session")[0]!.body).toEqual({
    returnUrl: `${window.location.origin}/billing?tab=payment`,
  });
  expect(navigate).toHaveBeenCalledExactlyOnceWith("https://billing.stripe.test/p/session_1");
});

test("is an element of the portal of a session that can capture a payment method, and only that", async () => {
  mount(sessionServer(), <CustomerPortal />);
  expect(await screen.findByText("Visa •••• 4242")).toBeTruthy();
  cleanup();

  const portal = portalWith(null);
  portal.capabilities.paymentMethods = false;
  const server = sessionServer({ portal });
  mount(server, <CustomerPortal />);
  await screen.findByText("Pro");
  expect(screen.queryByText("Payment method")).toBeNull();
});

test("in French", async () => {
  mount(
    sessionServer({ portal: portalWith(visa({ status: "EXPIRED" })) }),
    <PaymentMethodCard />,
    fr,
  );
  expect(await screen.findByText("Moyen de paiement")).toBeTruthy();
  expect(screen.getByText("Visa •••• 4242")).toBeTruthy();
  expect(screen.getByText("Expire le 12/2030")).toBeTruthy();
  expect(screen.getByText("Expirée")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Mettre à jour le moyen de paiement" })).toBeTruthy();
});

test("unstyled: the same card without a line of the SDK's style", async () => {
  const { container } = mount(sessionServer(), <PaymentMethodCard unstyled />);
  expect(await screen.findByText("Visa •••• 4242")).toBeTruthy();
  expect(container.querySelector('section[data-slot="payment-method-card"]')).toBeTruthy();
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
});
