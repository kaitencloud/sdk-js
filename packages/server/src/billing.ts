// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Helpers over the invoices and the handoff queue of the billing API.
//
// The generated `Billing` class has one static method per route, each taking
// `{ client, path, query, body }` and answering `{ data, response }`. Reading
// the queue and the invoices a few at a time is what an accounting integration
// does all day, so this adds the three things a call over the generated methods
// has to repeat: the client is bound once, a failure always throws, and a list
// can be walked to its last page.
//
// They are thin on purpose. The request and response types are the contract's,
// and nothing here decides what the API does with them.

import type { Client } from "./generated/client/index.ts";
import { Billing } from "./generated/sdk.gen.ts";
import type {
  HandoffBooking,
  HandoffClaim,
  HandoffClaimSize,
  Invoice,
  InvoicePayment,
  InvoiceSummary,
  ListInvoicesData,
  PageInvoiceSummary,
} from "./generated/types.gen.ts";

/**
 * The filters of {@link KaitenInvoices.list}: the statuses, kinds, customer,
 * instance and date ranges the invoice list takes, with its `cursor` and `limit`.
 */
export type KaitenInvoiceFilters = NonNullable<ListInvoicesData["query"]>;

/**
 * The invoices waiting for the organization's accounting system.
 *
 * Invoices a NoOp provider issues, and the Stripe ones when the organization
 * asked for them, wait in a queue the accounting system drains by claiming a
 * batch, booking each invoice and acknowledging it. The queue delivers at least
 * once: an invoice that is not acknowledged before its lease ends is claimed
 * again, so book on the invoice `id`.
 *
 * Reach it as `billing.handoff`. It needs a token that holds `write:billing`.
 */
export class KaitenHandoffQueue {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  /**
   * Leases the oldest invoices of the queue under one lease. Two consumers
   * claiming at once get different invoices.
   *
   * `limit` is 1 to 100 invoices (25 when omitted), `leaseSeconds` 60 to 3600
   * (900 when omitted); anything else is refused with a 422
   * `ClaimHandoff.InvalidLimit` or `ClaimHandoff.InvalidLeaseSeconds`. The claim
   * is not idempotent: when its response is lost, its invoices stay leased until
   * `leasedUntil`.
   */
  async claim(input: HandoffClaimSize = {}): Promise<HandoffClaim> {
    const { data } = await Billing.claimHandoff({
      client: this.#client,
      throwOnError: true,
      body: input,
    });
    return data;
  }

  /**
   * Records that the accounting system booked an invoice of a claim.
   *
   * Pass the claim's `leaseId` to be refused (409 `AckHandoff.LeaseMismatch`)
   * when another claim took the invoice since, and the invoice's number in the
   * accounting system as `externalReference`. Acknowledging again is safe. A
   * different reference than the one the invoice was acknowledged under is
   * refused (409 `AckHandoff.ReferenceMismatch`), which a consumer can take as
   * already handed off.
   */
  async ack(invoiceId: string, input: HandoffBooking = {}): Promise<Invoice> {
    const { data } = await Billing.ackHandoff({
      client: this.#client,
      throwOnError: true,
      path: { invoiceId },
      body: input,
    });
    return data;
  }
}

/**
 * The invoices of the organization: queries and the settlement of a manual one.
 *
 * Amounts are integer numbers of the currency's minor units, next to the
 * invoice's `currency`; the SDK never converts them. Reach it as
 * `billing.invoices`. Reading needs a token that holds `read:billing`, and
 * marking an invoice paid `write:billing`.
 */
export class KaitenInvoices {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  /**
   * One page of invoices, newest first. With `updatedSince` the invoices changed
   * since an instant come oldest change first instead, for an incremental sync.
   *
   * `status` takes several values, sent as a repeated parameter. Pass the
   * previous page's `nextCursor` as `cursor` for the next one; {@link listAll}
   * does that.
   */
  async list(filters: KaitenInvoiceFilters = {}): Promise<PageInvoiceSummary> {
    const { data } = await Billing.listInvoices({
      client: this.#client,
      throwOnError: true,
      query: filters,
    });
    return data;
  }

  /**
   * Every invoice the filters select, page after page, until the last one.
   * `limit` is the size of a page. The generator stops by itself, and requests
   * the next page only when it is asked for the next invoice.
   *
   * ```ts
   * for await (const invoice of billing.invoices.listAll({ status: ["MANUAL"] })) {
   *   console.log(invoice.id, invoice.total, invoice.currency);
   * }
   * ```
   */
  async *listAll(
    filters: Omit<KaitenInvoiceFilters, "cursor"> = {},
  ): AsyncGenerator<InvoiceSummary, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await this.list(cursor === undefined ? filters : { ...filters, cursor });
      yield* page.items;
      // A page that claims more rows and gives no cursor would loop for ever.
      cursor = page.hasMore ? page.nextCursor : undefined;
    } while (cursor !== undefined);
  }

  /**
   * One invoice with its lines, the customer and instance as they were when it
   * was composed, its hold and its handoff. An invoice outlives its instance and
   * customer: it is addressed by id.
   */
  async get(invoiceId: string): Promise<Invoice> {
    const { data } = await Billing.getInvoice({
      client: this.#client,
      throwOnError: true,
      path: { invoiceId },
    });
    return data;
  }

  /**
   * Records that a manual invoice was paid. An invoice still waiting in the
   * handoff queue is acknowledged by the same write. Marking it paid again with
   * the same `externalReference` answers it unchanged; an invoice a payment
   * provider collects is refused (409 `MarkInvoicePaid.ProviderManaged`), since
   * it is settled there.
   */
  async markPaid(invoiceId: string, input: InvoicePayment = {}): Promise<Invoice> {
    const { data } = await Billing.markInvoicePaid({
      client: this.#client,
      throwOnError: true,
      path: { invoiceId },
      body: input,
    });
    return data;
  }
}

/**
 * The billing helpers, over a client from {@link createKaitenClient}.
 *
 * ```ts
 * const billing = new KaitenBilling(client);
 * const claim = await billing.handoff.claim({ limit: 50, leaseSeconds: 900 });
 * for (const invoice of claim.invoices) {
 *   const reference = await bookInTheLedger(invoice); // idempotent on invoice.id
 *   await billing.handoff.ack(invoice.id, { leaseId: claim.leaseId, externalReference: reference });
 * }
 * ```
 *
 * A call that fails throws, as everything built on that client does: a
 * {@link KaitenError} for an answer, a {@link KaitenNetworkError} when none
 * came. Nothing here sends a call again by itself.
 */
export class KaitenBilling {
  /** The handoff queue: claim a batch of invoices, then acknowledge each. */
  readonly handoff: KaitenHandoffQueue;
  /** Invoices: list them, read one, mark a manual one paid. */
  readonly invoices: KaitenInvoices;

  constructor(client: Client) {
    this.handoff = new KaitenHandoffQueue(client);
    this.invoices = new KaitenInvoices(client);
  }
}
