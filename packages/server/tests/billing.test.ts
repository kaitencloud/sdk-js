import { describe, expect, expectTypeOf, test } from "vite-plus/test";

import { createClient, createConfig } from "../src/generated/client/index.ts";
import {
  Billing,
  createKaitenClient,
  KaitenBilling,
  KaitenError,
  KaitenNetworkError,
} from "../src/index.ts";
import type {
  HandoffClaim,
  Invoice,
  InvoiceSummary,
  KaitenHandoffQueue,
  KaitenInvoiceFilters,
  KaitenInvoices,
  PageInvoiceSummary,
} from "../src/index.ts";

// The helpers over the handoff queue and the invoices run against a fetch that
// answers as the billing API does. The answers are typed by the contract, so a
// resync that makes a member required or changes its type stops this file from
// compiling instead of passing on a hand-written guess.

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": status < 400 ? "application/json" : "application/problem+json",
      ...headers,
    },
  });

const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
  json({ title: "Refused", status, code }, status, headers);

/** A billing client whose fetch answers with `answer` and records what it was sent. */
function billingAnswering(answer: (request: Request, nth: number) => Response) {
  const seen: Request[] = [];
  const client = createKaitenClient({
    token: "ksh_ledger",
    baseUrl: "https://example.test",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push(request.clone());
      return answer(request, seen.length - 1);
    },
  });
  return { billing: new KaitenBilling(client), client, seen };
}

const url = (request: Request) => new URL(request.url);

const INVOICE_ID = "5f0c1a52-8c1e-4b7e-9d3a-1c2d3e4f5a6b";

/** A MANUAL ACTIVATION invoice of the NoOp provider, waiting in the handoff queue. */
function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    billingEmail: "ap@initech.test",
    boundaryAt: "2026-10-01T00:00:00Z",
    collectionMethod: "SEND_INVOICE",
    createdAt: "2026-10-01T00:00:00Z",
    currency: "USD",
    customerName: "Initech",
    customerSlug: "initech",
    daysUntilDue: 30,
    discountTotal: 580,
    dueAt: "2026-10-31T00:00:00Z",
    handoff: { claimCount: 1, status: "PENDING" },
    handoffStatus: "PENDING",
    hold: null,
    holdDetail: null,
    holdReason: null,
    id: INVOICE_ID,
    instanceName: "Initech production",
    instanceSlug: "initech-prod",
    issuedAt: "2026-10-01T00:00:00Z",
    kind: "ACTIVATION",
    licenseId: "7a1f0f3e-2b9c-4f61-8a55-0c2f6f7d9e10",
    licenseSlug: "pro-v2",
    lines: [
      {
        addonId: null,
        addonPriceId: null,
        amount: 2900,
        billingModel: "FLAT_FEE",
        billingTiming: "ADVANCE",
        description: "Pro, October",
        discount: null,
        entitlementId: null,
        entitlementSlug: null,
        instanceAddonId: null,
        instanceVoucherId: null,
        label: "Pro",
        licensePriceId: "0b8d6f0e-5d3c-4a8e-9f20-3a4b5c6d7e8f",
        metering: null,
        overage: null,
        provider: null,
        quantity: "1",
        seq: 1,
        serviceFrom: "2026-10-01T00:00:00Z",
        serviceTo: "2026-11-01T00:00:00Z",
        type: "BASE",
        unitAmountDecimal: "2900",
        voucherId: null,
      },
    ],
    overdue: false,
    paidAt: null,
    provider: null,
    providerKind: "NOOP",
    replacedByInvoiceId: null,
    replacesInvoiceId: null,
    serviceFrom: "2026-10-01T00:00:00Z",
    serviceTo: "2026-11-01T00:00:00Z",
    status: "MANUAL",
    subtotal: 3480,
    total: 2900,
    uncollectibleAt: null,
    updatedAt: "2026-10-01T00:00:00Z",
    voidReason: null,
    voidedAt: null,
    ...overrides,
  };
}

function summary(id: string): InvoiceSummary {
  const { lines: _lines, handoff: _handoff, ...rest } = invoice({ id });
  const {
    billingEmail: _email,
    hold: _hold,
    holdDetail: _detail,
    licenseId: _licenseId,
    provider: _provider,
    replacedByInvoiceId: _replacedBy,
    replacesInvoiceId: _replaces,
    uncollectibleAt: _uncollectibleAt,
    voidReason: _voidReason,
    voidedAt: _voidedAt,
    ...kept
  } = rest;
  return kept;
}

describe("billing.handoff.claim", () => {
  const claim = (): HandoffClaim => ({
    invoices: [invoice()],
    leaseId: "9e1b7c52-0f43-4d0a-b1a2-6f3d5c7a8b90",
    leasedUntil: "2026-10-12T09:05:00Z",
  });

  test("leases a batch with the limit and the lease it is given", async () => {
    const { billing, seen } = billingAnswering(() => json(claim()));

    const leased = await billing.handoff.claim({ limit: 2, leaseSeconds: 300 });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(url(seen[0]!).pathname).toBe("/api/billing/handoff/claim");
    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer ksh_ledger");
    expect(await seen[0]!.json()).toEqual({ limit: 2, leaseSeconds: 300 });
    expect(leased).toEqual(claim());
    // The lease to hand back with each acknowledgement, and what it covers.
    expect(leased.leaseId).toBe("9e1b7c52-0f43-4d0a-b1a2-6f3d5c7a8b90");
    expect(leased.invoices.map((entry) => entry.id)).toEqual([INVOICE_ID]);
  });

  test("sends an empty body without arguments, so the API's defaults apply", async () => {
    const { billing, seen } = billingAnswering(() => json(claim()));

    await billing.handoff.claim();

    expect(await seen[0]!.json()).toEqual({});
  });

  test("an empty queue is a claim with no invoices, not an error", async () => {
    const { billing } = billingAnswering(() =>
      json({ ...claim(), invoices: [] satisfies Invoice[] }),
    );

    await expect(billing.handoff.claim({ limit: 100 })).resolves.toMatchObject({ invoices: [] });
  });

  test("a limit outside 1 to 100 is the API's refusal, thrown", async () => {
    const { billing } = billingAnswering(() => problem(422, "ClaimHandoff.InvalidLimit"));

    const error = await billing.handoff.claim({ limit: 0 }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 422, code: "ClaimHandoff.InvalidLimit" });
  });
});

describe("billing.handoff.ack", () => {
  test("acknowledges one invoice with its lease and the number it was booked under", async () => {
    const acknowledged = invoice({
      handoffStatus: "ACKNOWLEDGED",
      handoff: {
        acknowledgedAt: "2026-10-12T09:01:00Z",
        claimCount: 1,
        externalReference: "ERP-1",
        status: "ACKNOWLEDGED",
      },
    });
    const { billing, seen } = billingAnswering(() => json(acknowledged));

    const result = await billing.handoff.ack(INVOICE_ID, {
      leaseId: "9e1b7c52-0f43-4d0a-b1a2-6f3d5c7a8b90",
      externalReference: "ERP-1",
    });

    expect(seen[0]!.method).toBe("POST");
    expect(url(seen[0]!).pathname).toBe(`/api/billing/handoff/${INVOICE_ID}/ack`);
    expect(await seen[0]!.json()).toEqual({
      leaseId: "9e1b7c52-0f43-4d0a-b1a2-6f3d5c7a8b90",
      externalReference: "ERP-1",
    });
    expect(result.handoff).toMatchObject({ status: "ACKNOWLEDGED", externalReference: "ERP-1" });
  });

  test("sends an empty body when it is given neither", async () => {
    const { billing, seen } = billingAnswering(() => json(invoice()));

    await billing.handoff.ack(INVOICE_ID);

    expect(await seen[0]!.json()).toEqual({});
  });

  test("another reference than the one it was acknowledged under is a 409 KaitenError", async () => {
    const { billing } = billingAnswering(() => problem(409, "AckHandoff.ReferenceMismatch"));

    const error = await billing.handoff
      .ack(INVOICE_ID, { externalReference: "ERP-2" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 409, code: "AckHandoff.ReferenceMismatch" });
  });

  test("an invoice another claim took since is a 409 AckHandoff.LeaseMismatch", async () => {
    const { billing } = billingAnswering(() => problem(409, "AckHandoff.LeaseMismatch"));

    await expect(billing.handoff.ack(INVOICE_ID, { leaseId: "stale" })).rejects.toMatchObject({
      status: 409,
      code: "AckHandoff.LeaseMismatch",
    });
  });

  test("an invoice that is not in the queue is a 404", async () => {
    const { billing } = billingAnswering(() => problem(404, "AckHandoff.NotFound"));

    await expect(billing.handoff.ack("missing")).rejects.toMatchObject({
      status: 404,
      code: "AckHandoff.NotFound",
    });
  });

  test("an id is a path segment, whatever it holds", async () => {
    const { billing, seen } = billingAnswering(() => json(invoice()));

    await billing.handoff.ack("a/b c");

    expect(url(seen[0]!).pathname).toBe("/api/billing/handoff/a%2Fb%20c/ack");
  });
});

describe("billing.invoices.list", () => {
  const page = (ids: string[], more?: string): PageInvoiceSummary => ({
    hasMore: more !== undefined,
    items: ids.map(summary),
    ...(more === undefined ? {} : { nextCursor: more }),
  });

  test("filters by status, repeating the parameter, and by the rest of the query", async () => {
    const { billing, seen } = billingAnswering(() => json(page(["a"])));

    await billing.invoices.list({
      status: ["MANUAL", "PAYMENT_FAILED"],
      overdue: true,
      customerSlug: "initech",
      updatedSince: "2026-10-01T00:00:00Z",
      limit: 50,
    });

    expect(seen[0]!.method).toBe("GET");
    const search = url(seen[0]!).searchParams;
    expect(url(seen[0]!).pathname).toBe("/api/invoices");
    expect(search.getAll("status")).toEqual(["MANUAL", "PAYMENT_FAILED"]);
    expect(search.get("overdue")).toBe("true");
    expect(search.get("customerSlug")).toBe("initech");
    expect(search.get("updatedSince")).toBe("2026-10-01T00:00:00Z");
    expect(search.get("limit")).toBe("50");
  });

  test("says which invoices are overdue when read, the ones the overdue filter selects", async () => {
    const { billing, seen } = billingAnswering(() =>
      json({ hasMore: false, items: [{ ...summary("a"), status: "PUSHED", overdue: true }] }),
    );

    const result = await billing.invoices.list({ overdue: true });

    expect(url(seen[0]!).searchParams.get("overdue")).toBe("true");
    expect(result.items[0]).toMatchObject({ id: "a", status: "PUSHED", overdue: true });
  });

  test("asks for nothing it was not asked for", async () => {
    const { billing, seen } = billingAnswering(() => json(page([])));

    await billing.invoices.list();

    expect(url(seen[0]!).search).toBe("");
  });

  test("answers the contract's page, cursor included", async () => {
    const { billing } = billingAnswering(() => json(page(["a", "b"], "next-1")));

    const result = await billing.invoices.list({ status: ["MANUAL"] });

    expect(result.items.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result).toMatchObject({ hasMore: true, nextCursor: "next-1" });
  });

  test("a refusal is thrown, whatever the status", async () => {
    const { billing } = billingAnswering(() => problem(422, "ListInvoices.InvalidFilter"));

    const error = await billing.invoices
      .list({ issuedFrom: "2026-10-02T00:00:00Z", issuedTo: "2026-10-01T00:00:00Z" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 422, code: "ListInvoices.InvalidFilter" });
  });
});

describe("billing.invoices.listAll", () => {
  test("walks the pages in order and stops after the last one", async () => {
    const { billing, seen } = billingAnswering((request) => {
      const cursor = url(request).searchParams.get("cursor");
      if (cursor === null)
        return json({ hasMore: true, nextCursor: "c1", items: ["a", "b"].map(summary) });
      if (cursor === "c1")
        return json({ hasMore: true, nextCursor: "c2", items: ["c", "d"].map(summary) });
      return json({ hasMore: false, items: ["e"].map(summary) });
    });

    const ids: string[] = [];
    for await (const entry of billing.invoices.listAll({ status: ["MANUAL"], limit: 2 })) {
      ids.push(entry.id);
    }

    expect(ids).toEqual(["a", "b", "c", "d", "e"]);
    expect(seen.map((request) => url(request).searchParams.get("cursor"))).toEqual([
      null,
      "c1",
      "c2",
    ]);
    // The filters ride along on every page.
    for (const request of seen) {
      expect(url(request).searchParams.getAll("status")).toEqual(["MANUAL"]);
      expect(url(request).searchParams.get("limit")).toBe("2");
    }
  });

  test("asks for a page only when the invoices of the one before are used up", async () => {
    const { billing, seen } = billingAnswering((request) =>
      url(request).searchParams.get("cursor") === null
        ? json({ hasMore: true, nextCursor: "c1", items: ["a", "b"].map(summary) })
        : json({ hasMore: false, items: ["c"].map(summary) }),
    );

    const iterator = billing.invoices.listAll();
    expect((await iterator.next()).value).toMatchObject({ id: "a" });
    expect((await iterator.next()).value).toMatchObject({ id: "b" });
    expect(seen).toHaveLength(1);
    expect((await iterator.next()).value).toMatchObject({ id: "c" });
    expect(seen).toHaveLength(2);
    expect((await iterator.next()).done).toBe(true);
  });

  test("an empty list is no request beyond the first", async () => {
    const { billing, seen } = billingAnswering(() => json({ hasMore: false, items: [] }));

    const all: InvoiceSummary[] = [];
    for await (const entry of billing.invoices.listAll()) all.push(entry);

    expect(all).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  test("a page that claims more and names no cursor ends the walk instead of looping", async () => {
    const { billing, seen } = billingAnswering(() =>
      json({ hasMore: true, items: ["a"].map(summary) }),
    );

    const ids: string[] = [];
    for await (const entry of billing.invoices.listAll()) ids.push(entry.id);

    expect(ids).toEqual(["a"]);
    expect(seen).toHaveLength(1);
  });

  test("a refusal on a later page throws out of the loop, after the invoices already read", async () => {
    const { billing } = billingAnswering((request) =>
      url(request).searchParams.get("cursor") === null
        ? json({ hasMore: true, nextCursor: "c1", items: ["a"].map(summary) })
        : problem(400, "Invoices.InvalidCursor"),
    );

    const ids: string[] = [];
    const walk = async () => {
      for await (const entry of billing.invoices.listAll()) ids.push(entry.id);
    };

    await expect(walk()).rejects.toMatchObject({ status: 400, code: "Invoices.InvalidCursor" });
    expect(ids).toEqual(["a"]);
  });
});

describe("billing.invoices.get", () => {
  test("reads one invoice by id, lines and amounts as the contract has them", async () => {
    const { billing, seen } = billingAnswering(() => json(invoice()));

    const result = await billing.invoices.get(INVOICE_ID);

    expect(seen[0]!.method).toBe("GET");
    expect(url(seen[0]!).pathname).toBe(`/api/invoices/${INVOICE_ID}`);
    expect(result).toEqual(invoice());
    expect(result.total).toBe(2900);
    expect(result.lines.map((line) => [line.type, line.amount])).toEqual([["BASE", 2900]]);
  });

  test("an unknown invoice is a 404", async () => {
    const { billing } = billingAnswering(() => problem(404, "GetInvoice.NotFound"));

    await expect(billing.invoices.get("nope")).rejects.toMatchObject({
      status: 404,
      code: "GetInvoice.NotFound",
    });
  });
});

describe("a held draft", () => {
  test("names the provider's line limit as its reason, beside the usage journal's", async () => {
    const held = invoice({
      status: "DRAFT",
      issuedAt: null,
      dueAt: null,
      holdReason: "PROVIDER_ITEM_LIMIT",
    });
    const { billing } = billingAnswering(() => json(held));

    const result = await billing.invoices.get(INVOICE_ID);

    expect(result.status).toBe("DRAFT");
    expect(result.holdReason).toBe("PROVIDER_ITEM_LIMIT");
  });
});

describe("billing.invoices.markPaid", () => {
  test("marks an invoice paid with the reference it was booked under", async () => {
    const paid = invoice({ status: "PAID", paidAt: "2026-10-12T00:00:00Z" });
    const { billing, seen } = billingAnswering(() => json(paid));

    const result = await billing.invoices.markPaid(INVOICE_ID, { externalReference: "ERP-1" });

    expect(seen[0]!.method).toBe("POST");
    expect(url(seen[0]!).pathname).toBe(`/api/invoices/${INVOICE_ID}/mark-paid`);
    expect(await seen[0]!.json()).toEqual({ externalReference: "ERP-1" });
    expect(result).toMatchObject({ status: "PAID", paidAt: "2026-10-12T00:00:00Z" });
  });

  test("sends the date and the note it is given, and nothing else", async () => {
    const { billing, seen } = billingAnswering(() => json(invoice()));

    await billing.invoices.markPaid(INVOICE_ID, {
      paidAt: "2026-10-01T00:00:00Z",
      note: "Wire received",
    });

    expect(await seen[0]!.json()).toEqual({
      paidAt: "2026-10-01T00:00:00Z",
      note: "Wire received",
    });
  });

  test("an invoice a provider collects is settled there: a 409 ProviderManaged", async () => {
    const { billing } = billingAnswering(() => problem(409, "MarkInvoicePaid.ProviderManaged"));

    await expect(billing.invoices.markPaid(INVOICE_ID)).rejects.toMatchObject({
      status: 409,
      code: "MarkInvoicePaid.ProviderManaged",
    });
  });
});

describe("the helpers", () => {
  test("throw for every failure, whatever the client was configured to do", async () => {
    // A client built by hand answers `{ error }` and resolves, unless asked to
    // throw: the helpers ask, so a failure is never read as a missing `data`.
    const seen: Request[] = [];
    const client = createClient(
      createConfig({
        baseUrl: "https://example.test/api",
        fetch: async (input, init) => {
          seen.push(input instanceof Request ? input : new Request(input, init));
          return problem(500, "Internal.Error");
        },
      }),
    );
    const billing = new KaitenBilling(client);

    await expect(billing.handoff.claim()).rejects.toBeDefined();
    await expect(billing.invoices.get(INVOICE_ID)).rejects.toBeDefined();
    await expect(billing.invoices.list()).rejects.toBeDefined();
    expect(seen).toHaveLength(3);
  });

  test("raise a KaitenNetworkError when no answer came", async () => {
    const client = createKaitenClient({
      token: "t",
      baseUrl: "https://example.test",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await expect(new KaitenBilling(client).handoff.claim()).rejects.toBeInstanceOf(
      KaitenNetworkError,
    );
  });

  test("never send a call again by themselves", async () => {
    const { billing, seen } = billingAnswering(() =>
      problem(503, "ClaimHandoff.ProviderUnavailable", { "Retry-After": "30" }),
    );

    await expect(billing.handoff.claim()).rejects.toMatchObject({ status: 503 });
    expect(seen).toHaveLength(1);
  });

  test("are bound to the client they are built on, so two tokens stay apart", async () => {
    const a = billingAnswering(() => json({ hasMore: false, items: [] }));
    const b = billingAnswering(() => json({ hasMore: false, items: [] }));

    await a.billing.invoices.list();
    await b.billing.invoices.list();

    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(1);
  });

  test("are the generated operations underneath, with nothing hidden from the generated class", async () => {
    // The generated `Billing` class stays the way to reach every other route
    // (write-off, void, export): the helpers add to it and replace nothing.
    const { client, seen } = billingAnswering(() => json(invoice()));

    await Billing.writeOffInvoice({
      client,
      path: { invoiceId: INVOICE_ID },
      body: { reason: "Customer insolvent" },
    });

    expect(url(seen[0]!).pathname).toBe(`/api/invoices/${INVOICE_ID}/write-off`);
  });
});

describe("the types of the helpers", () => {
  test("amounts are integer minor units next to the currency, as the contract types them", () => {
    expectTypeOf<Invoice["total"]>().toEqualTypeOf<number>();
    expectTypeOf<Invoice["subtotal"]>().toEqualTypeOf<number>();
    expectTypeOf<Invoice["discountTotal"]>().toEqualTypeOf<number>();
    expectTypeOf<Invoice["currency"]>().toEqualTypeOf<string>();
    expectTypeOf<InvoiceSummary["total"]>().toEqualTypeOf<number>();
    expectTypeOf<Invoice["lines"][number]["amount"]>().toEqualTypeOf<number>();
  });

  test("claim, ack, list, get and markPaid answer the contract's types", () => {
    type Answer<T extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<T>>;

    expectTypeOf<Answer<KaitenHandoffQueue["claim"]>>().toEqualTypeOf<HandoffClaim>();
    expectTypeOf<Answer<KaitenHandoffQueue["ack"]>>().toEqualTypeOf<Invoice>();
    expectTypeOf<Answer<KaitenInvoices["get"]>>().toEqualTypeOf<Invoice>();
    expectTypeOf<Answer<KaitenInvoices["markPaid"]>>().toEqualTypeOf<Invoice>();
    expectTypeOf<Answer<KaitenInvoices["list"]>>().toEqualTypeOf<PageInvoiceSummary>();
    expectTypeOf<ReturnType<KaitenInvoices["listAll"]>>().toEqualTypeOf<
      AsyncGenerator<InvoiceSummary, void, undefined>
    >();
  });

  test("an invoice says whether it is overdue, on its read and in the list", () => {
    expectTypeOf<Invoice["overdue"]>().toEqualTypeOf<boolean>();
    expectTypeOf<InvoiceSummary["overdue"]>().toEqualTypeOf<boolean>();
    expectTypeOf<KaitenInvoiceFilters["overdue"]>().toEqualTypeOf<boolean | undefined>();
  });

  test("a draft is held for its usage journal or for its provider's line limit", () => {
    expectTypeOf<Invoice["holdReason"]>().toEqualTypeOf<
      | "LEDGER_SEQUENCE_GAP"
      | "LEDGER_CHAIN_BREAK"
      | "LEDGER_COUNTER_MISMATCH"
      | "PROVIDER_ITEM_LIMIT"
      | null
    >();
    expectTypeOf<InvoiceSummary["holdReason"]>().toEqualTypeOf<Invoice["holdReason"]>();
  });

  test("the filters are the list query of the contract", () => {
    expectTypeOf<NonNullable<KaitenInvoiceFilters["status"]>[number]>().toEqualTypeOf<
      Invoice["status"]
    >();
    expectTypeOf<KaitenInvoiceFilters["updatedSince"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<KaitenInvoiceFilters["cursor"]>().toEqualTypeOf<string | undefined>();
  });
});
