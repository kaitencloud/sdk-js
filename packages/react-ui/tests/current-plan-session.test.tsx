// @vitest-environment jsdom
//
// `CurrentPlan` under `mode="customer-session"`: the plan the bound instance is on, what
// it costs and when it renews, read from the portal Kaiten serves for Initech through the
// real session client and provider. A customer session has no licence, so there is no
// version and no type to show, and the section says what the portal says, no more.

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { KaitenSessionClient } from "@kaitencloud/client";
import { fr } from "@kaitencloud/react/locales";

import {
  BillingSummary,
  CurrentPlan,
  formatKaitenDate,
  type KaitenLocalizationOverrides,
} from "../src/index.ts";
import { KaitenProvider } from "./support/styled-provider.tsx";

import sessionAnswers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

const API = "https://kaiten.test/api";

type PortalName =
  | "portal"
  | "portalCanceling"
  | "portalScheduledChange"
  | "portalPastDue"
  | "portalCustomerWide"
  | "portalNeverSubscribed";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPlan(
  name: PortalName,
  props: { unstyled?: boolean } = {},
  locale?: KaitenLocalizationOverrides,
) {
  const fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify(sessionAnswers[name]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const sessionClient = new KaitenSessionClient({
    apiUrl: API,
    fetch: fetchSpy,
    getCustomerSession: () => ({
      token: `kst_${"s".repeat(43)}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  });
  return render(
    <KaitenProvider
      mode="customer-session"
      sessionClient={sessionClient}
      apiUrl={API}
      polling={{ enabled: false }}
      locale={locale}
    >
      <CurrentPlan {...props} />
    </KaitenProvider>,
  );
}

const priceLine = () => document.querySelector('[data-slot="current-plan-price"]');
// Intl writes a non-breaking space between an amount and its symbol.
const priceText = () => priceLine()?.textContent?.replace(/\s/g, " ");
const renewsOn = `Renews on ${formatKaitenDate("2026-11-01T00:00:00Z")}`;

test("shows the plan, its price and its renewal for a monthly subscription", async () => {
  renderPlan("portal");

  expect(await screen.findByText("Pro")).toBeTruthy();
  expect(priceText()).toBe("€49.00/month");
  expect(screen.getByText(renewsOn)).toBeTruthy();
  expect(screen.getByText("Current plan")).toBeTruthy();
});

test("a customer session has no licence: no version and no type are made up", async () => {
  const { container } = renderPlan("portal");
  await screen.findByText("Pro");

  for (const invented of ["PAID", "TRIAL", "DEVELOPMENT", "COMMUNITY", "undefined", "null"]) {
    expect(within(container).queryByText(invented), invented).toBeNull();
  }
  expect(container.querySelector('[data-slot="badge"]')).toBeNull();
});

test("a quarterly subscription reads every 3 months, and is not renewing while payment is due", async () => {
  renderPlan("portalPastDue");

  expect(await screen.findByText("Pro")).toBeTruthy();
  expect(priceText()).toBe("€135.00 every 3 months");
  expect(priceText()).not.toContain("/month");
  // A past-due subscription is not said to renew.
  expect(screen.queryByText(/Renews on/)).toBeNull();
});

test("a subscription that ends with its period is not said to renew", async () => {
  renderPlan("portalCanceling");

  expect(await screen.findByText("Pro")).toBeTruthy();
  expect(priceText()).toBe("€49.00/month");
  expect(screen.queryByText(/Renews on/)).toBeNull();
});

test("a plan change that is scheduled does not change what is shown today", async () => {
  renderPlan("portalScheduledChange");

  expect(await screen.findByText("Pro")).toBeTruthy();
  expect(priceText()).toBe("€49.00/month");
  expect(screen.getByText(renewsOn)).toBeTruthy();
});

test("an instance that was never subscribed shows its plan and no price", async () => {
  renderPlan("portalNeverSubscribed");

  expect(await screen.findByText("Starter")).toBeTruthy();
  expect(priceLine()).toBeNull();
  expect(screen.queryByText(/Renews on/)).toBeNull();
});

test("a session bound to the customer only has no current plan to show", async () => {
  const { container } = renderPlan("portalCustomerWide");

  await waitFor(() => expect(container.querySelector('[data-slot="card-header"]')).toBeNull());
  expect(screen.queryByText("Current plan")).toBeNull();
  expect(container.textContent).toBe("");
});

test("unstyled: the same plan, price and renewal", async () => {
  const { container } = renderPlan("portal", { unstyled: true });

  expect(await screen.findByText("Pro")).toBeTruthy();
  expect(priceText()).toBe("€49.00/month");
  expect(screen.getByText(renewsOn)).toBeTruthy();
  expect(container.querySelector('[data-slot="current-plan"]')).not.toBeNull();
});

test("in French, the period and the renewal are French", async () => {
  renderPlan("portalPastDue", {}, fr);

  expect(await screen.findByText("Pro")).toBeTruthy();
  expect(priceText()).toBe("135,00 € tous les 3 mois");
  cleanup();

  renderPlan("portal", {}, fr);
  expect(await screen.findByText("Pro")).toBeTruthy();
  expect(priceText()).toBe("49,00 €/mois");
  expect(screen.getByText(/Renouvellement le/)).toBeTruthy();
});

test("the billing summary names the plan the same way", async () => {
  const fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify(sessionAnswers.portal), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const sessionClient = new KaitenSessionClient({
    apiUrl: API,
    fetch: fetchSpy,
    getCustomerSession: () => ({
      token: `kst_${"s".repeat(43)}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  });
  render(
    <KaitenProvider
      mode="customer-session"
      sessionClient={sessionClient}
      apiUrl={API}
      polling={{ enabled: false }}
    >
      <BillingSummary />
    </KaitenProvider>,
  );

  await waitFor(() =>
    expect(document.querySelector('[data-slot="billing-summary-plan"]')?.textContent).toBe("Pro"),
  );
});
