// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// What a plan card's action looks like. Every "Select plan" opens a checkout, so every
// one is a primary button, and the highlighted plan is told apart by the brand gradient
// laid over it, not by being the only primary one. A link to sales is not a purchase and
// stays a secondary button, which the grey fill tells from the purple ones.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { PricingTable, type KaitenCatalog, type Plan } from "../src/index.ts";
import { KaitenProvider } from "./support/styled-provider.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const paid = (slug: string, name: string, over: Partial<Plan> = {}): Plan => ({
  slug,
  name,
  currencyCode: "EUR",
  price: 4900,
  pricingType: "PAID",
  selfServe: true,
  selfServeCtaUrl: null,
  published: true,
  ...over,
});

const sold = (slug: string, name: string, over: Partial<Plan> = {}): Plan => ({
  slug,
  name,
  prices: [],
  pricingType: "CUSTOM",
  selfServe: false,
  selfServeCtaUrl: "https://acme.test/contact",
  published: true,
  ...over,
});

function renderTable(plans: Plan[], props: Partial<Parameters<typeof PricingTable>[0]> = {}) {
  // A plan with no price warns, as it should.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const catalog: KaitenCatalog = { plans };
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

const select = (name: string) => within(card(name)).getByRole("button");
const contact = (name: string) => within(card(name)).getByRole("link", { name: "Contact us" });

const fill = (element: HTMLElement) => ({
  primary: element.classList.contains("bg-primary"),
  secondary: element.classList.contains("bg-secondary"),
  gradient: element.classList.contains("ktn-cta-gradient"),
});

test("a plan's Select plan is a primary button, highlighted or not, and a link to sales is secondary", () => {
  renderTable([paid("starter", "Starter"), paid("pro", "Pro"), sold("enterprise", "Enterprise")], {
    highlightPlan: "pro",
  });

  const starter = select("Starter");
  expect(starter.textContent).toBe("Select plan");
  expect(starter.getAttribute("data-variant")).toBe("default");
  expect(fill(starter)).toEqual({ primary: true, secondary: false, gradient: false });

  const pro = select("Pro");
  expect(pro.textContent).toBe("Choose plan");
  expect(pro.getAttribute("data-variant")).toBe("default");
  expect(fill(pro)).toEqual({ primary: true, secondary: false, gradient: true });

  const enterprise = contact("Enterprise");
  expect(enterprise.getAttribute("data-slot")).toBe("button");
  expect(fill(enterprise)).toEqual({ primary: false, secondary: true, gradient: false });
});

test("every plan of a table with no highlighted one has a primary select button and no gradient", () => {
  renderTable([paid("starter", "Starter"), paid("team", "Team"), paid("scale", "Scale")]);

  for (const name of ["Starter", "Team", "Scale"]) {
    const button = select(name);
    expect(button.textContent).toBe("Select plan");
    expect(button.getAttribute("data-variant")).toBe("default");
    expect(fill(button)).toEqual({ primary: true, secondary: false, gradient: false });
  }
});

test("a plan the catalog marks as highlighted is told apart by the gradient alone", () => {
  renderTable([paid("starter", "Starter"), paid("pro", "Pro", { highlighted: true })]);

  const [starter, pro] = [select("Starter"), select("Pro")];
  expect(starter.getAttribute("data-variant")).toBe(pro.getAttribute("data-variant"));
  expect(fill(starter).gradient).toBe(false);
  expect(fill(pro).gradient).toBe(true);
});

test("a plan sold by contact keeps the grey button, and the gradient when it is the highlighted one", () => {
  renderTable([
    sold("enterprise", "Enterprise"),
    sold("partner", "Partner", { highlighted: true }),
  ]);

  expect(fill(contact("Enterprise"))).toEqual({
    primary: false,
    secondary: true,
    gradient: false,
  });
  expect(fill(contact("Partner"))).toEqual({ primary: false, secondary: true, gradient: true });
});

test("a plan the catalog says nothing about is offered a primary select button too", () => {
  renderTable([{ slug: "host", name: "Host plan", price: 7900, currencyCode: "EUR" }]);

  const button = select("Host plan");
  expect(button.getAttribute("data-variant")).toBe("default");
  expect(fill(button).primary).toBe(true);
});

test("unstyled: the select button and the link are the browser's own, with no variant", () => {
  const { container } = renderTable(
    [paid("starter", "Starter"), paid("pro", "Pro"), sold("enterprise", "Enterprise")],
    { unstyled: true, highlightPlan: "pro" },
  );

  const actions = [...container.querySelectorAll("article button, article a")];
  expect(actions.map((action) => action.textContent)).toEqual([
    "Select plan",
    "Choose plan",
    "Contact us",
  ]);
  for (const action of actions) {
    expect(action.getAttribute("class")).toBeNull();
    expect(action.getAttribute("data-slot")).toBeNull();
    expect(action.getAttribute("data-variant")).toBeNull();
  }
});
