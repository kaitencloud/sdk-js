// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// The invoices of a customer session, in the customer portal: the real session client, answering
// with what Kaiten answered for Initech. What is held is what a customer reads and can do: the
// invoices as the server lists them, what each totals as the server computed it, a link to pay the
// ones that are open and to the PDF of the ones that have one, and nothing at all when the portal
// says the customer's invoices are not theirs to see.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { fr } from "@kaitencloud/react/locales";

import { CustomerPortal, InvoiceList } from "../src/index.ts";
import { sessionServer } from "../.storybook/session-server.ts";
import { flat, mount } from "./support/session-mount.tsx";
import { KaitenProvider } from "./support/styled-provider.tsx";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rowsOf = (container: HTMLElement) => [...container.querySelectorAll('[data-slot="invoice"]')];

/** The first page of the recorded invoices, with one more kind of each status a customer meets. */
const invoice = (patch: Record<string, unknown>) => ({
  ...structuredClone(answers.invoicesFirstPage.items[1]!),
  ...patch,
});

test("lists the invoices the server lists, newest first, with the totals the server computed", async () => {
  const server = sessionServer();
  const { container } = mount(server, <InvoiceList />);

  await screen.findByText("INV-0002");
  const rows = rowsOf(container);
  expect(rows.map((row) => row.getAttribute("data-status"))).toEqual(["PAID", "PAYMENT_FAILED"]);
  expect(flat(rows[0]!.textContent)).toContain("€106.46");
  expect(flat(rows[1]!.textContent)).toContain("€49.00");
  expect(within(rows[0] as HTMLElement).getByText("Paid")).toBeTruthy();
  expect(within(rows[1] as HTMLElement).getByText("Payment failed")).toBeTruthy();
  // What each covers.
  expect(within(rows[0] as HTMLElement).getByText(/Renewal · /)).toBeTruthy();
});

test("a Pay link only on the invoices that are open, and a PDF link on the ones that have one", async () => {
  const server = sessionServer();
  server.setInvoices([
    invoice({
      id: "pushed",
      status: "PUSHED",
      providerInvoiceNumber: "INV-PUSHED",
      invoicePdfUrl: null,
    }),
    invoice({
      id: "failed",
      status: "PAYMENT_FAILED",
      providerInvoiceNumber: "INV-FAILED",
      invoicePdfUrl: "https://pay.initech.test/i/failed.pdf",
    }),
    invoice({
      id: "paid",
      status: "PAID",
      providerInvoiceNumber: "INV-PAID",
      invoicePdfUrl: "https://pay.initech.test/i/paid.pdf",
    }),
    invoice({
      id: "void",
      status: "VOID",
      providerInvoiceNumber: "INV-VOID",
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
    }),
    invoice({
      id: "manual",
      status: "MANUAL",
      kind: "FINAL",
      providerInvoiceNumber: null,
      externalReference: "ACME-2026-17",
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
    }),
  ]);
  const { container } = mount(server, <InvoiceList />);
  await screen.findByText("INV-PUSHED");

  const pays = screen.getAllByRole("link", { name: /^Pay / });
  expect(pays.map((link) => link.getAttribute("aria-label"))).toEqual([
    "Pay INV-PUSHED",
    "Pay INV-FAILED",
  ]);
  for (const link of pays) {
    expect(link.getAttribute("href")).toMatch(/^https:\/\/pay\.initech\.test\//);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  }
  const pdfs = screen.getAllByRole("link", { name: /^PDF / });
  expect(pdfs.map((link) => link.getAttribute("aria-label"))).toEqual([
    "PDF INV-FAILED",
    "PDF INV-PAID",
  ]);
  for (const link of pdfs) {
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  }
  // Paid, void and billed outside the provider: nothing to pay.
  for (const status of ["PAID", "VOID", "MANUAL"]) {
    const row = container.querySelector(`[data-status="${status}"]`) as HTMLElement;
    expect(within(row).queryByRole("link", { name: /^Pay / }), status).toBeNull();
  }
  // The vendor's own number stands for the provider's on an invoice billed outside one.
  const manual = container.querySelector('[data-status="MANUAL"]') as HTMLElement;
  expect(within(manual).getByText("ACME-2026-17")).toBeTruthy();
  expect(within(manual).getByText("Billed manually")).toBeTruthy();
  expect(within(manual).queryByRole("link")).toBeNull();
});

test("an open invoice looks the same whether it was declined or is waiting for a confirmation", async () => {
  // Nothing in an invoice tells the two apart yet: both read "Payment failed" and offer "Pay".
  const server = sessionServer();
  server.setInvoices([
    invoice({ id: "a", status: "PAYMENT_FAILED", providerInvoiceNumber: "INV-A" }),
  ]);
  mount(server, <InvoiceList />);
  await screen.findByText("INV-A");
  expect(screen.queryByText(/Complete payment/i)).toBeNull();
  expect(screen.getByRole("link", { name: "Pay INV-A" })).toBeTruthy();
});

test("says so when there are no invoices", async () => {
  const server = sessionServer();
  server.setInvoices([]);
  mount(server, <InvoiceList />);
  expect(await screen.findByText("No invoices yet.")).toBeTruthy();
});

test("is absent when the portal says the customer's invoices are not theirs to see", async () => {
  const portal = structuredClone(answers.portal);
  portal.capabilities.invoices = false;
  const server = sessionServer({ portal });
  const { container } = mount(
    server,
    <>
      <CustomerPortal elements={["CurrentPlan", "InvoiceList"]} />
    </>,
  );
  await screen.findByText("Pro");
  expect(screen.queryByText("Invoices")).toBeNull();
  // Not asked for, either: a list that is not shown is not read.
  expect(server.to("GET", "invoices")).toHaveLength(0);
  // And not an empty cell where it would have been.
  expect(container.querySelectorAll('[data-slot="customer-portal"] > div > div')).toHaveLength(1);
});

test("an invoice list is not a thing under any other mode", async () => {
  const { container } = render(
    <KaitenProvider mode="static" catalog={{ plans: [] }}>
      <InvoiceList />
    </KaitenProvider>,
  );
  expect(container.querySelector('[data-slot="invoices"]')).toBeNull();
  expect(container.textContent).toBe("");
});

test("pages: the next page is asked for with the cursor the server gave", async () => {
  const server = sessionServer();
  mount(server, <InvoiceList />);
  await screen.findByText("INV-0002");

  fireEvent.click(screen.getByRole("button", { name: "Show older invoices" }));
  expect(await screen.findByText("ACME-2026-17")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show older invoices" })).toBeNull();
  expect(server.to("GET", "invoices")).toHaveLength(2);
});

test("a read that fails is said, with a way to try again", async () => {
  const server = sessionServer();
  // A refusal the client does not retry on its own, so the first read fails at once.
  const refused = {
    status: 400,
    body: { title: "Bad Request", status: 400, code: "Invoices.Failed" },
  };
  server.script("GET invoices", refused);
  mount(server, <InvoiceList />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByText("INV-0002")).toBeTruthy();
});

test("a customer who goes to pay is waited on: the list is read again once it is paid", async () => {
  const server = sessionServer();
  mount(server, <InvoiceList />);
  await screen.findByText("INV-0001");

  const paid = invoice({
    id: answers.invoicesFirstPage.items[1]!.id,
    status: "PAID",
    providerInvoiceNumber: "INV-0001",
    paidAt: "2026-10-12T10:00:00Z",
  });
  server.setInvoices([answers.invoicesFirstPage.items[0], paid], true);
  // Only the poll's clock is the test's; the link itself is followed by the browser.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  fireEvent.click(screen.getByRole("link", { name: "Pay INV-0001" }));
  await vi.advanceTimersByTimeAsync(5_100);
  vi.useRealTimers();
  await waitFor(() => expect(screen.queryByRole("link", { name: "Pay INV-0001" })).toBeNull());
});

test("in French: the labels and the amounts", async () => {
  const server = sessionServer();
  const { container } = mount(server, <InvoiceList />, fr);
  await screen.findByText("INV-0002");
  expect(screen.getByText("Factures")).toBeTruthy();
  const rows = rowsOf(container);
  expect(flat(rows[0]!.textContent)).toContain("106,46 €");
  expect(within(rows[0] as HTMLElement).getByText("Payée")).toBeTruthy();
  expect(within(rows[1] as HTMLElement).getByText("Paiement échoué")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Payer INV-0001" })).toBeTruthy();
});

test("unstyled: a list with the same links", async () => {
  const server = sessionServer();
  const { container } = mount(server, <InvoiceList unstyled />);
  await screen.findByText("INV-0002");
  expect(container.querySelector('section[data-slot="invoices"] ul')).toBeTruthy();
  expect(screen.getByRole("link", { name: "Pay INV-0001" }).getAttribute("rel")).toBe(
    "noopener noreferrer",
  );
});
