// @vitest-environment jsdom
//
// The cells of the customer portal's grid. jsdom does not lay anything out (the layout suite does,
// in Chromium: `tests/layout/portal-grid.spec.ts`), so what is held here is what the layout is
// built on: a section that has nothing to say renders nothing, and its cell is the one that the
// stylesheet hides, while every cell that has a card in it is a column that the card fills.

import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { CustomerPortal } from "../src/index.ts";
import { sessionServer } from "../.storybook/session-server.ts";
import { mount } from "./support/session-mount.tsx";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

afterEach(cleanup);

const cellsOf = (container: HTMLElement, unstyled = false) => [
  ...container.querySelectorAll<HTMLElement>(
    unstyled ? '[data-slot="customer-portal"] > div' : '[data-slot="customer-portal"] > div > div',
  ),
];

/** The recorded portal of Initech, with no entitlements and no add-ons: a plan that grants nothing to list. */
const nothingToList = () => {
  const portal: Record<string, any> = structuredClone(answers.portal);
  portal.entitlements = [];
  portal.addOns = [];
  return portal;
};

test("a section with nothing to say leaves an empty cell, which the stylesheet hides", async () => {
  const { container } = mount(sessionServer({ portal: nothingToList() }), <CustomerPortal />);
  await screen.findByText("Invoices");

  const cells = cellsOf(container);
  const empty = cells.filter((cell) => cell.childElementCount === 0);
  // Included features, usage meters and add-ons.
  expect(empty).toHaveLength(3);
  for (const cell of empty) expect(cell.className).toContain("empty:hidden");
  // What remains is what a customer reads.
  expect(
    cells
      .filter((cell) => cell.childElementCount > 0)
      .map((cell) => cell.querySelector('[data-slot="card-title"]')?.textContent),
  ).toEqual(["Current plan", "Payment method", "Voucher", "Invoices"]);
});

test("the cell of a card is a column that the card fills; the invoices have a row of their own", async () => {
  const { container } = mount(sessionServer(), <CustomerPortal />);
  await screen.findByText("Invoices");

  for (const cell of cellsOf(container).filter((each) => each.childElementCount > 0)) {
    expect(cell.className).toContain("flex-col");
    expect(cell.className).toContain("*:data-[slot=card]:flex-1");
  }
  const invoices = cellsOf(container).find(
    (cell) => cell.querySelector('[data-slot="card-title"]')?.textContent === "Invoices",
  );
  expect(invoices).toBeDefined();
  expect(invoices!.className).toContain("basis-full");
});

test("the vertical layout stacks its cells and hides the empty ones too, so that they add no gap", async () => {
  const { container } = mount(
    sessionServer({ portal: nothingToList() }),
    <CustomerPortal layout="vertical" />,
  );
  await screen.findByText("Invoices");

  const grid = container.querySelector('[data-slot="customer-portal"] > div') as HTMLElement;
  expect(grid.className).toContain("flex-col");
  for (const cell of cellsOf(container).filter((each) => each.childElementCount === 0)) {
    expect(cell.className).toContain("empty:hidden");
  }
});

test("the unstyled portal draws no grid at all", async () => {
  const { container } = mount(sessionServer(), <CustomerPortal unstyled />);
  await screen.findByText("Invoices");
  expect(container.querySelector('[data-slot="customer-portal"]')?.className).toBe("ktn-own");
  // Its cells carry no class: the host's stylesheet is the only one that lays them out.
  for (const cell of cellsOf(container, true)) expect(cell.getAttribute("class")).toBeNull();
});
