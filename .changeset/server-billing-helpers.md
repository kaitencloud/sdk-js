---
"@kaitencloud/server": minor
---

`KaitenBilling` reads the invoices of the organization and drains its handoff queue, over a client from `createKaitenClient`.

- `billing.handoff.claim({ limit?, leaseSeconds? })` leases the oldest invoices waiting for the organization's accounting system under one lease, and `billing.handoff.ack(invoiceId, { leaseId?, externalReference? })` records that the ledger booked one. The queue delivers at least once, so a consumer books on the invoice `id`.
- `billing.invoices.list(filters)` is one page of invoices, `listAll(filters)` follows the cursor to the last page, `get(invoiceId)` reads one, and `markPaid(invoiceId, { paidAt?, externalReference?, note? })` records the payment of a manual invoice. Amounts are integer minor units next to the invoice's `currency`.
- A call that fails throws a `KaitenError`, and none is sent again by itself. Write-off, void, recompose and the export stay on the generated `Billing` class.

`KaitenWebhookType` and `KaitenWebhookEvent` name the 109 events of the regenerated contract, billing's among them, and narrow an event to the payload of its type. They follow the contract: an event the API starts to send is a new member, so a `switch` over `event.type` keeps a `default`.
