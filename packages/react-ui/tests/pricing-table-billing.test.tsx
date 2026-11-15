// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// `PricingTable` on a catalog as the billing API serves it, once mapped by
// `@kaitencloud/client`: default prices beside quarterly and metered ones, and
// plans that are not self-serve. What it pins is what a visitor would misread:
// a quarterly price under "/month", a usage price as the plan's price, a
// "Choose plan" button on a plan nobody can buy by themselves.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { PricingTable, type KaitenCatalog, type Plan, type PlanPrice } from "../src/index.ts";
import { KaitenProvider } from "./support/styled-provider.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flat = (
  id: string,
  amount: number,
  interval: "month" | "year",
  over: Partial<PlanPrice> = {},
): PlanPrice => ({
  id,
  amount,
  unitAmountDecimal: `${amount}`,
  currencyCode: "EUR",
  interval,
  billingModel: "FLAT_FEE",
  isDefault: true,
  // The API's display label: never the suffix under the price.
  label: interval === "month" ? "Monthly" : "Annual",
  ...over,
});

const quarterly = flat("lp-pro-q", 13500, "month", { intervalCount: 3, label: "Quarterly" });
const proMonthly = flat("lp-pro-m", 4900, "month");
const proAnnual = flat("lp-pro-y", 49000, "year");

const PLANS: Plan[] = [
  {
    slug: "starter-v1",
    name: "Starter",
    currencyCode: "EUR",
    price: 1900,
    prices: [flat("lp-starter-m", 1900, "month")],
    pricingType: "PAID",
    selfServe: true,
    selfServeCtaUrl: null,
    published: true,
  },
  {
    slug: "pro-v2",
    name: "Pro",
    currencyCode: "EUR",
    price: 4900,
    annualPrice: 49000,
    // Quarterly first, and a second, non-default monthly price: neither is the
    // headline.
    prices: [
      quarterly,
      flat("lp-pro-m2", 3900, "month", { isDefault: false }),
      proMonthly,
      proAnnual,
    ],
    pricingType: "PAID",
    selfServe: true,
    selfServeCtaUrl: null,
    published: true,
  },
  {
    slug: "metered-v1",
    name: "Metered",
    currencyCode: "EUR",
    // A usage price with an interval is still not a monthly price.
    prices: [flat("lp-metered", 200, "month", { billingModel: "USAGE_BASED" })],
    pricingType: "PAID",
    selfServe: true,
    published: true,
  },
  {
    slug: "jp-v1",
    name: "JP",
    currencyCode: "JPY",
    price: 980,
    prices: [flat("lp-jp-m", 980, "month", { currencyCode: "JPY" })],
    pricingType: "PAID",
    selfServe: true,
    published: true,
  },
  {
    slug: "enterprise-v1",
    name: "Enterprise",
    prices: [],
    pricingType: "CUSTOM",
    selfServe: false,
    selfServeCtaUrl: "https://acme.test/contact",
    published: true,
  },
  {
    slug: "solo-v1",
    name: "Solo",
    currencyCode: "EUR",
    price: 900,
    prices: [flat("lp-solo-m", 900, "month")],
    pricingType: "PAID",
    selfServe: false,
    selfServeCtaUrl: null,
    published: true,
  },
];

// Hoisted: the static provider's scope follows the catalog.
const catalog: KaitenCatalog = { plans: PLANS };

function renderTable(props: Partial<Parameters<typeof PricingTable>[0]> = {}) {
  // The priceless Metered plan warns, as it should.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return render(
    <KaitenProvider mode="static" catalog={catalog}>
      <PricingTable showFeatureComparison={false} {...props} />
    </KaitenProvider>,
  );
}

function card(name: string): HTMLElement {
  return screen
    .getByText(name, { selector: '[data-slot="card-title"]' })
    .closest('[data-slot="card"]') as HTMLElement;
}

test("shows the default monthly flat fee, never a quarterly or a metered price", () => {
  renderTable();

  const pro = within(card("Pro"));
  expect(pro.getByText("€49.00")).toBeTruthy();
  expect(pro.getByText("/month")).toBeTruthy();
  expect(pro.queryByText("€135.00")).toBeNull();
  expect(pro.queryByText("€39.00")).toBeNull();
  // The suffix is the interval, not the API's "Monthly" label.
  expect(pro.queryByText("/Monthly")).toBeNull();

  const metered = within(card("Metered"));
  expect(metered.queryByText("€2.00")).toBeNull();
  expect(metered.getByText("Custom")).toBeTruthy();

  expect(within(card("JP")).getByText("¥980")).toBeTruthy();
});

test("the annual toggle shows the annual price", () => {
  renderTable();

  fireEvent.click(screen.getByRole("radio", { name: "Annual" }));

  const pro = within(card("Pro"));
  expect(pro.getByText("€490.00")).toBeTruthy();
  expect(pro.getByText("/year")).toBeTruthy();
});

test("a self-serve plan's action hands back the plan and the price it showed", () => {
  const onSelectPlan = vi.fn();
  renderTable({ onSelectPlan });

  fireEvent.click(within(card("Pro")).getByRole("button"));
  expect(onSelectPlan).toHaveBeenLastCalledWith("pro-v2", PLANS[1], proMonthly);

  fireEvent.click(screen.getByRole("radio", { name: "Annual" }));
  fireEvent.click(within(card("Pro")).getByRole("button"));
  expect(onSelectPlan).toHaveBeenLastCalledWith("pro-v2", PLANS[1], proAnnual);
});

test("a plan that is not self-serve links to its CTA, or offers nothing", () => {
  renderTable();

  const enterprise = within(card("Enterprise"));
  expect(enterprise.getByText("Custom")).toBeTruthy();
  expect(enterprise.queryByRole("button")).toBeNull();
  const contact = enterprise.getByRole("link", { name: "Contact us" });
  expect(contact.getAttribute("href")).toBe("https://acme.test/contact");

  const solo = within(card("Solo"));
  expect(solo.getByText("€9.00")).toBeTruthy();
  expect(solo.queryByRole("button")).toBeNull();
  // The card's one link is the "Powered by Kaiten" mark.
  expect(solo.queryByText("Contact us")).toBeNull();
  expect(solo.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
    "https://kaiten.sh/",
  ]);
});

test("unstyled: the same prices and the same actions", () => {
  const onSelectPlan = vi.fn();
  const { container } = renderTable({ unstyled: true, onSelectPlan });

  const article = (name: string) =>
    within(
      [...container.querySelectorAll("article")].find(
        (candidate) => candidate.querySelector("h3")?.textContent === name,
      )!,
    );

  expect(article("Pro").getByText("€49.00/month")).toBeTruthy();
  expect(article("Pro").queryByText(/135/)).toBeNull();
  expect(article("Enterprise").getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe(
    "https://acme.test/contact",
  );
  expect(article("Solo").queryByRole("button")).toBeNull();

  fireEvent.click(article("Starter").getByRole("button"));
  expect(onSelectPlan).toHaveBeenCalledWith("starter-v1", PLANS[0], PLANS[0]!.prices![0]);
});

test("a plan the catalog says nothing about keeps its select button", () => {
  render(
    <KaitenProvider mode="static" catalog={catalog}>
      <PricingTable
        showFeatureComparison={false}
        plans={[{ slug: "pro", name: "Host plan", price: 7900, currencyCode: "EUR" }]}
      />
    </KaitenProvider>,
  );

  expect(within(card("Host plan")).getByRole("button")).toBeTruthy();
});
