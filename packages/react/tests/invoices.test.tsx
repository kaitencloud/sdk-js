// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// The customer's invoices, and the wait for the one a checkout left open: every 5 seconds until
// it is paid, for 10 minutes, and then once each time the window takes focus. The session is a
// double whose invoices a test changes, so what is pinned is when the hooks read and what they
// do with what they read.

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { SessionInvoice } from "@kaitencloud/client";

import { KaitenProvider, usePortal } from "../src/index.ts";
import { useInvoiceSettlement, useInvoices } from "../src/billing.ts";
import {
  activationInvoice,
  callsOf,
  demoSessionInvoices,
  FAKE_TIMERS,
  sessionProvider,
  settle,
  unsubscribedSession,
} from "./support/billing.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** `count` invoices, newest first, with the ids `inv_1`… in that order. */
function invoices(count: number): SessionInvoice[] {
  const [template] = demoSessionInvoices();
  return Array.from({ length: count }, (_, index) => ({
    ...template!,
    id: `inv_${index + 1}`,
  }));
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

test("the first page is read with the limit, and the next ones after the last invoice held", async () => {
  const client = unsubscribedSession({ invoices: invoices(5) });
  const view = renderHook(() => useInvoices({ limit: 2 }), { wrapper: sessionProvider(client) });

  await waitFor(() =>
    expect(view.result.current.invoices.map((invoice) => invoice.id)).toEqual(["inv_1", "inv_2"]),
  );
  expect(view.result.current).toMatchObject({ hasMore: true, isLoading: false, error: null });
  expect(callsOf(client, "listInvoices")).toEqual([{ limit: 2 }]);

  act(() => view.result.current.loadMore());
  await waitFor(() => expect(view.result.current.invoices).toHaveLength(4));
  expect(callsOf(client, "listInvoices").at(-1)).toEqual({ cursor: "2", limit: 2 });
  expect(view.result.current.hasMore).toBe(true);

  act(() => view.result.current.loadMore());
  await waitFor(() => expect(view.result.current.invoices).toHaveLength(5));
  expect(view.result.current.invoices.map((invoice) => invoice.id)).toEqual([
    "inv_1",
    "inv_2",
    "inv_3",
    "inv_4",
    "inv_5",
  ]);
  // Nothing after the last one: asking for more asks for nothing.
  expect(view.result.current.hasMore).toBe(false);
  const reads = callsOf(client, "listInvoices").length;
  act(() => view.result.current.loadMore());
  expect(callsOf(client, "listInvoices")).toHaveLength(reads);
});

test("reading again starts over from the first page", async () => {
  const client = unsubscribedSession({ invoices: invoices(3) });
  const view = renderHook(() => useInvoices({ limit: 2 }), { wrapper: sessionProvider(client) });
  await waitFor(() => expect(view.result.current.invoices).toHaveLength(2));
  act(() => view.result.current.loadMore());
  await waitFor(() => expect(view.result.current.invoices).toHaveLength(3));

  // A new invoice has been issued: the list is what the first page says now, and the older ones are asked for again.
  client.setInvoices([{ ...invoices(1)[0]!, id: "inv_new" }, ...invoices(3)]);
  act(() => view.result.current.refetch());
  await waitFor(() =>
    expect(view.result.current.invoices.map((invoice) => invoice.id)).toEqual(["inv_new", "inv_1"]),
  );
  expect(view.result.current.hasMore).toBe(true);
});

test("a page that fails to load leaves the ones that are there, with the error", async () => {
  const client = unsubscribedSession({ invoices: invoices(3) });
  const view = renderHook(() => useInvoices({ limit: 2 }), { wrapper: sessionProvider(client) });
  await waitFor(() => expect(view.result.current.invoices).toHaveLength(2));

  vi.spyOn(client, "listInvoices").mockRejectedValueOnce(new Error("offline"));
  act(() => view.result.current.loadMore());
  await waitFor(() => expect(view.result.current.error?.message).toBe("offline"));
  expect(view.result.current.invoices).toHaveLength(2);
  expect(view.result.current.hasMore).toBe(true);

  // And the next try is the same page again.
  act(() => view.result.current.loadMore());
  await waitFor(() => expect(view.result.current.invoices).toHaveLength(3));
  expect(view.result.current.error).toBeNull();
});

test("disabled, or outside a customer session, it reads nothing", async () => {
  const client = unsubscribedSession();
  const off = renderHook(() => useInvoices({ enabled: false }), {
    wrapper: sessionProvider(client),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(off.result.current).toMatchObject({ invoices: [], isLoading: false, hasMore: false });
  expect(callsOf(client, "listInvoices")).toHaveLength(0);

  const bare = renderHook(() => useInvoices(), {
    wrapper: ({ children }) => (
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        {children}
      </KaitenProvider>
    ),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(bare.result.current).toMatchObject({ invoices: [], isLoading: false, error: null });
});

// ---------------------------------------------------------------------------
// The wait
// ---------------------------------------------------------------------------

/** The settlement of the activation invoice of a checkout whose payment needs the customer. */
function settlement(client: ReturnType<typeof unsubscribedSession>, options = {}) {
  return renderHook(
    () => ({
      settlement: useInvoiceSettlement({ invoiceId: "inv_activation", ...options }),
      portal: usePortal(),
    }),
    {
      wrapper: sessionProvider(client),
    },
  );
}

const reads = (client: ReturnType<typeof unsubscribedSession>) =>
  callsOf(client, "listInvoices").length;

describe("waiting for an invoice", () => {
  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMERS);
  });

  test("it reads every 5 seconds, not at once, and stops at the first paid", async () => {
    const client = unsubscribedSession({ invoices: [activationInvoice("PAYMENT_FAILED")] });
    const view = settlement(client);
    await settle();
    expect(view.result.current.settlement.status).toBe("polling");
    expect(reads(client)).toBe(0);

    await settle(5_000);
    expect(reads(client)).toBe(1);
    await settle(5_000);
    expect(reads(client)).toBe(2);
    expect(view.result.current.settlement).toMatchObject({ status: "polling" });
    expect(view.result.current.settlement.invoice?.status).toBe("PAYMENT_FAILED");

    // The customer pays on the provider's page: the third read sees it.
    client.setInvoices([activationInvoice("PAID")]);
    await settle(5_000);
    expect(reads(client)).toBe(3);
    expect(view.result.current.settlement).toMatchObject({ status: "paid" });
    expect(view.result.current.settlement.invoice?.status).toBe("PAID");

    // And it stops there.
    await settle(60_000);
    expect(reads(client)).toBe(3);
  });

  test("what it waited on is paid, so the portal is read again", async () => {
    const client = unsubscribedSession({ invoices: [activationInvoice("PAYMENT_FAILED")] });
    const view = settlement(client);
    await settle();
    const portalReads = () => callsOf(client, "getPortal").length;
    const before = portalReads();

    client.setInvoices([activationInvoice("PAID")]);
    await settle(5_000);
    expect(view.result.current.settlement.status).toBe("paid");
    expect(portalReads()).toBeGreaterThan(before);
  });

  test("an invoice that is a few pages down is found there", async () => {
    const client = unsubscribedSession({ invoices: [] });
    const older = activationInvoice("PAID", "inv_old");
    const pages: Record<
      string,
      { items: ReturnType<typeof activationInvoice>[]; hasMore: boolean; nextCursor?: string }
    > = {
      first: { items: [activationInvoice("PAID", "inv_new")], hasMore: true, nextCursor: "c1" },
      c1: { items: [activationInvoice("PAID", "inv_mid")], hasMore: true, nextCursor: "c2" },
      c2: { items: [older], hasMore: false },
    };
    const list = vi
      .spyOn(client, "listInvoices")
      .mockImplementation(async (options) => pages[options?.cursor ?? "first"]!);
    const view = settlement(client, { invoiceId: "inv_old" });
    await settle();

    await settle(5_000);
    expect(list).toHaveBeenCalledTimes(3);
    expect(view.result.current.settlement).toMatchObject({ status: "paid" });
    expect(view.result.current.settlement.invoice?.id).toBe("inv_old");
  });

  test("it stops at a failed payment only when asked to", async () => {
    const client = unsubscribedSession({ invoices: [activationInvoice("PAYMENT_FAILED")] });
    const patient = settlement(client);
    await settle(5_000);
    expect(patient.result.current.settlement.status).toBe("polling");
    patient.unmount();

    const impatient = settlement(client, { stopOnFailure: true });
    await settle(5_000);
    expect(impatient.result.current.settlement).toMatchObject({ status: "failed" });
  });

  test("it gives up at ten minutes, and reads once more each time the window takes focus", async () => {
    const client = unsubscribedSession({ invoices: [activationInvoice("PAYMENT_FAILED")] });
    const view = settlement(client);
    await settle();

    await settle(10 * 60_000);
    expect(view.result.current.settlement.status).toBe("gave_up");
    const atGiveUp = reads(client);
    // Every 5 seconds for ten minutes.
    expect(atGiveUp).toBe(120);

    // Time passing reads nothing more.
    await settle(30 * 60_000);
    expect(reads(client)).toBe(atGiveUp);

    // Focus is one read each time, whatever the invoice says.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(reads(client)).toBe(atGiveUp + 1);
    expect(view.result.current.settlement.status).toBe("gave_up");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(reads(client)).toBe(atGiveUp + 2);

    // The customer paid while away, and comes back.
    client.setInvoices([activationInvoice("PAID")]);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(view.result.current.settlement.status).toBe("paid");
    // Paid: focus is not listened to any more.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(reads(client)).toBe(atGiveUp + 3);
  });

  test("focus while it is still reading on its schedule adds nothing", async () => {
    const client = unsubscribedSession({ invoices: [activationInvoice("PAYMENT_FAILED")] });
    settlement(client);
    await settle(5_000);
    expect(reads(client)).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(reads(client)).toBe(1);
  });

  test("without the invoice's id it waits on the newest activation invoice", async () => {
    const renewal = { ...activationInvoice("PAID", "inv_renewal"), kind: "RENEWAL" };
    const client = unsubscribedSession({ invoices: [renewal, activationInvoice("PUSHED")] });
    const view = renderHook(() => useInvoiceSettlement(), { wrapper: sessionProvider(client) });
    await settle(5_000);

    // The renewal that is paid is not the one it waits on.
    expect(view.result.current.status).toBe("polling");
    expect(view.result.current.invoice?.id).toBe("inv_activation");

    client.setInvoices([renewal, activationInvoice("PAID")]);
    await settle(5_000);
    expect(view.result.current.status).toBe("paid");
  });

  test("a read that fails is not the end of the wait", async () => {
    const client = unsubscribedSession({ invoices: [activationInvoice("PAYMENT_FAILED")] });
    const view = settlement(client);
    await settle();
    vi.spyOn(client, "listInvoices").mockRejectedValueOnce(new Error("offline"));

    await settle(5_000);
    expect(view.result.current.settlement.status).toBe("polling");
    client.setInvoices([activationInvoice("PAID")]);
    await settle(5_000);
    expect(view.result.current.settlement.status).toBe("paid");
  });

  test("an invoice that is not in the list yet is not the end of the wait either", async () => {
    const client = unsubscribedSession({ invoices: [] });
    const view = settlement(client);
    await settle(10_000);
    expect(view.result.current.settlement).toMatchObject({ status: "polling", invoice: null });
  });

  test("disabled it waits on nothing, and unmounted it stops", async () => {
    const client = unsubscribedSession({ invoices: [activationInvoice("PAYMENT_FAILED")] });
    const off = settlement(client, { enabled: false });
    await settle(60_000);
    expect(off.result.current.settlement.status).toBe("idle");
    expect(reads(client)).toBe(0);
    off.unmount();

    const on = settlement(client);
    await settle(5_000);
    expect(reads(client)).toBe(1);
    on.unmount();
    await settle(60_000);
    expect(reads(client)).toBe(1);
  });

  test("two reads never overlap: a slow one is waited for", async () => {
    const client = unsubscribedSession({ invoices: [activationInvoice("PAYMENT_FAILED")] });
    const finish: Array<() => void> = [];
    vi.spyOn(client, "listInvoices").mockImplementation(
      () =>
        new Promise((resolve) =>
          finish.push(() =>
            resolve({ items: [activationInvoice("PAYMENT_FAILED")], hasMore: false }),
          ),
        ),
    );
    settlement(client);
    await settle(5_000);
    expect(finish).toHaveLength(1);

    // The next ticks come while the first read is still out.
    await settle(10_000);
    expect(finish).toHaveLength(1);
    await act(async () => finish[0]!());
    await settle(5_000);
    expect(finish).toHaveLength(2);
  });
});
