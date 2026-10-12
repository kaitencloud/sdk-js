# @kaitencloud/server

Server SDK for Kaiten — for **Node/TS backends** authenticating with a **secret API token
(Bearer)**. Exposes the **full typed contract** as resource classes generated from the
same OpenAPI snapshot as [`@kaitencloud/client`](../client), so coverage tracks the contract
automatically.

> **In the browser?** Use **[`@kaitencloud/client`](../client)**, which never holds a secret
> there. This package runs on servers only, and its secret token must never reach a browser
> bundle.

## Install

```bash
npm install @kaitencloud/server
```

**Requires Node 20.19 or newer.** This package ships both ESM and CommonJS, so it works
from either module system — `import` and `require` both resolve, and the types follow:

```js
const { createKaitenClient } = require("@kaitencloud/server"); // CommonJS
```

It is the only package here that is dual-built, because it is the only one meant to run on
a backend. The browser package, `@kaitencloud/client`, is **ESM-only and requires Node 22.12+**
when used outside a bundler — 22.12 is the release where Node can `require()` an ES module.
Every bundler handles it regardless of your app's module format.

## Quick start

```ts
import { createKaitenClient, Customers, Licenses } from "@kaitencloud/server";

const client = createKaitenClient({
  baseUrl: process.env.KAITEN_API_URL!, // the URL of your Kaiten API
  token: process.env.KAITEN_API_TOKEN!, // secret key, sent as Bearer
});

const customers = await Customers.listCustomers({ client });
const license = await Licenses.getLicense({ client, path: { licenseSlug: "pro" } });
```

`createKaitenClient({ baseUrl, token, fetch? })` returns a Bearer-authenticated client you
pass to each resource call via `{ client }`. `token` may be a string or a (sync/async)
function, and each factory call yields an independent client — so one process can talk to
the API with several tokens.

`baseUrl` is the URL of your Kaiten API, and it is required: there is no default. The
contract is served under `/api` (`servers: - url: /api`), so that prefix is appended when
your value does not already end with it: `https://kaiten.example.com`,
`https://kaiten.example.com/` and `https://kaiten.example.com/api` all resolve the same way.
A missing or non-absolute value throws.

## Errors

**Failed calls throw.** Errors are normalized to `KaitenError` (the API answered with a
failure status) or `KaitenNetworkError` (the request never got there), both real `Error`
subclasses carrying a `kind` discriminant:

```ts
import { Instances, isThresholdExceeded, KaitenError } from "@kaitencloud/server";

try {
  await Instances.reportEntitlementUsageMetric({
    client,
    path: { instanceSlug, entitlementSlug: "seats" },
    body: { value: { type: "number", value: 1 }, behavior: "append" },
  });
} catch (error) {
  // The increment would cross the license limit: the enforcement signal.
  if (isThresholdExceeded(error)) return denyAndPromptUpgrade();
  if (error instanceof KaitenError) {
    log.warn({ status: error.status, code: error.code, errorId: error.errorId }, error.detail);
  }
  throw error;
}
```

`isThresholdExceeded` recognizes that refusal by its code,
`ReportEntitlementUsageMetric.ThresholdExceeded`. Other operations answer 409 for other
conflicts, such as a slug already taken, so the predicate is safe in a shared error handler.
That refusal is the single most important response this package can return, and the easiest
one to miss.

A usage report sent under an `Idempotency-Key` header is applied once per key, instance and
entitlement over the API's idempotency window, 35 days by default: sent again with the same
`behavior` and value it answers its original result (with `Idempotent-Replayed: true`), and a
key older than the window is forgotten and counts as new. The key is a header of the generated
operation, never a member of its body, and the answer, a `ReportedEntitlementUsage`, names it:
its `transactionId` is the key the report was accepted under, `null` for a report sent without
one. A malformed key is refused with a 422 located at `header.Idempotency-Key`.

```ts
await Instances.reportEntitlementUsageMetric({
  client,
  path: { instanceSlug, entitlementSlug },
  headers: { "Idempotency-Key": `llm-call:${callId}:tokens` },
  body: { value: { type: "number", value: 1_250 }, behavior: "append" },
});
```

Under a key the API already accepted for another `behavior` or value, the report is refused
with a `TransactionIdReusedError` (409 `ReportEntitlementUsageMetric.TransactionIdReused`), a
`KaitenError` whose `transactionId` is the key the request's `Idempotency-Key` header carried
and whose `original` names the report the key was first accepted with. `isTransactionIdReused`
recognizes it. It is a bug in the caller, never a transient failure: retrying it under the
same key loops.

Every `KaitenError` also carries the problem's `code`, a stable machine-readable identifier
such as `License.NotFound`, and its `errorId`, the correlation id of the API's log entry for
the failure: quote it when you report a problem.

## Usage history and exports

The API keeps every usage report it accepts for your organization's usage history retention,
with the counter before and after it and the limit in force. Three generated operations read
that history, and the SDK adds no helper over them:

- `Instances.listUsageReports` pages one instance's entitlement, oldest report first: `afterSeq`
  (the `nextAfterSeq` of the previous page), `limit` (500 at most), `from`, `to`, and
  `transactionId` to find the report sent under a key (the `Idempotency-Key` it carried).
- `Instances.exportUsageReports` streams the same reports as CSV, or as NDJSON with
  `format: "json"`, over at most 366 days.
- `Instances.exportOrganizationUsageReports` streams the reports of the whole organization,
  across instances and entitlements, over at most 31 days. `instanceSlug`, `entitlementSlug`
  or their ids narrow it.

```ts
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { Instances } from "@kaitencloud/server";

// The reports of one entitlement, oldest first, a page at a time.
let afterSeq: number | undefined;
do {
  const { data: page } = await Instances.listUsageReports({
    client,
    throwOnError: true,
    path: { instanceSlug, entitlementSlug: "tokens" },
    query: { from: "2026-10-01T00:00:00Z", afterSeq, limit: 500 },
  });
  for (const report of page.items) {
    console.log(report.reportSeq, report.behavior, report.delta, report.valueAfter);
  }
  afterSeq = page.nextAfterSeq; // absent on the last page
} while (afterSeq !== undefined);

// The same reports as a file: CSV by default, `format: "json"` for NDJSON.
const { data: csv } = await Instances.exportUsageReports({
  client,
  throwOnError: true,
  parseAs: "stream",
  path: { instanceSlug, entitlementSlug: "tokens" },
  query: { from: "2026-10-01T00:00:00Z", format: "csv" },
});
await pipeline(Readable.fromWeb(csv as unknown as ReadableStream), createWriteStream("tokens.csv"));

// Every report of the organization in the range.
const { data: all } = await Instances.exportOrganizationUsageReports({
  client,
  throwOnError: true,
  parseAs: "stream",
  query: { from: "2026-10-01T00:00:00Z", to: "2026-10-15T00:00:00Z", format: "json" },
});
await pipeline(
  Readable.fromWeb(all as unknown as ReadableStream),
  createWriteStream("usage.ndjson"),
);
```

The contract types the body of an export as text; `parseAs: "stream"` returns the stream
itself, so a long range is never held in memory. The file name the API suggests is in the
`Content-Disposition` header of the `response` the call also returns. A `from` before the start
of the retention is refused with a 422, `ListUsageReports.OutsideRetention` or
`ExportUsageReports.OutsideRetention`.

## Invoices and the handoff queue

An organization that collects its own invoices, or that keeps its books elsewhere, reads
them from Kaiten. The invoices a NoOp provider issues wait in a **handoff queue** until the
accounting system books them; Stripe invoices wait there too when the organization's
billing settings ask for it (`handoffStripeInvoices`). `KaitenBilling` is a small set of
helpers over the generated `Billing` class that drains it and reads the invoices. It needs
a token that holds `write:billing` to claim and acknowledge, and `read:billing` to list.

```ts
import { createKaitenClient, KaitenBilling } from "@kaitencloud/server";

const client = createKaitenClient({
  baseUrl: process.env.KAITEN_API_URL!,
  token: process.env.KAITEN_API_TOKEN!,
});
const billing = new KaitenBilling(client);

// Every few minutes: hand the invoices to the ledger.
const claim = await billing.handoff.claim({ limit: 50, leaseSeconds: 900 });
for (const invoice of claim.invoices) {
  const reference = await upsertInLedger(invoice); // idempotent on invoice.id
  await billing.handoff.ack(invoice.id, {
    leaseId: claim.leaseId,
    externalReference: reference,
  });
}

// Then what changed after the handoff: a void, a write-off, a payment.
for await (const invoice of billing.invoices.listAll({ updatedSince: lastSeenUpdatedAt })) {
  await applyChangeInLedger(invoice);
  lastSeenUpdatedAt = invoice.updatedAt;
}
```

- `billing.handoff.claim({ limit?, leaseSeconds? })` leases the oldest invoices of the queue
  under one lease and answers `{ leaseId, leasedUntil, invoices }`, possibly with no invoice.
  `limit` is 1 to 100 (25 when omitted) and `leaseSeconds` 60 to 3600 (900 when omitted);
  anything else is a 422, `ClaimHandoff.InvalidLimit` or `ClaimHandoff.InvalidLeaseSeconds`.
  Two consumers claiming at once get different invoices.
- `billing.handoff.ack(invoiceId, { leaseId?, externalReference? })` records that the ledger
  booked the invoice, under the number it gave it. Acknowledging again is safe. Passing the
  `leaseId` makes the call fail with a 409 `AckHandoff.LeaseMismatch` when another claim has
  taken the invoice since. A different `externalReference` than the one it was acknowledged
  under is a 409 `AckHandoff.ReferenceMismatch`: the invoice is already handed off.
- `billing.invoices.list(filters)` is one page of invoices, newest first, as the contract
  answers it: `{ items, hasMore, nextCursor }`. `listAll(filters)` is the same as an async
  generator that follows `nextCursor` to the last page, and asks for a page only when the
  invoices of the one before are used up. `status` takes several values. With `updatedSince`
  the invoices changed since an instant come **oldest change first**, so keeping the
  `updatedAt` of the last one you read misses none.
- `billing.invoices.get(invoiceId)` is one invoice with its lines, the customer and instance
  as they were when it was composed, its hold and its handoff.
- An invoice read from the list or by id says whether it is `overdue` at that moment, the
  grace period of automatic collection included: it is what the `overdue: true` filter
  selects. The invoice a write answers, and the one an event carries, say `false`, so read it
  from the list or the invoice itself.
- A DRAFT that is held names why in `holdReason`: its usage journal failed a consistency check
  (`LEDGER_SEQUENCE_GAP`, `LEDGER_CHAIN_BREAK`, `LEDGER_COUNTER_MISMATCH`), or its payment
  provider cannot take that many lines (`PROVIDER_ITEM_LIMIT`).
- `billing.invoices.markPaid(invoiceId, { paidAt?, externalReference?, note? })` records
  that a manual invoice was paid, and acknowledges it in the same write when it was still in
  the queue. An invoice a payment provider collects is settled there: a 409
  `MarkInvoicePaid.ProviderManaged`.

**The queue delivers at least once.** An invoice that is not acknowledged before its lease
ends is claimed again, and a claim is not idempotent: when its response is lost, its
invoices stay leased until `leasedUntil`. Book on the invoice `id`, which does not change.

Every amount of an invoice is an integer number of the currency's minor units, next to the
invoice's `currency` (`total: 2900` and `currency: "USD"` is $29.00). The helpers never
convert them. They throw for every failure, as the rest of this package does, and send
nothing again by themselves. Write-off, void, recompose, release-hold and the export are not
wrapped: they are `Billing.writeOffInvoice`, `Billing.voidInvoice`, `Billing.recomposeInvoice`,
`Billing.releaseInvoiceHold` and `Billing.exportInvoices`, which take the same `client`.

## Publishable keys

A web page that shows your plans reads your public catalog with a **publishable key**
(`pk_`), the one credential a browser may hold. It reads that catalog and nothing else, so it
can ship in the page source. Issue one from your backend, with a token that holds
`write:publishable_keys`:

```ts
import { PublishableKeys } from "@kaitencloud/server";

const { data: issued } = await PublishableKeys.createPublishableKey({
  client,
  throwOnError: true,
  body: { label: "Marketing site", allowedOrigins: ["https://www.example.com"] },
});

issued.key; // "pk_…": the key, in this answer only
```

- **The key is shown once.** Kaiten keeps a digest of it. Every other answer carries
  `keyHint`, its last four characters, to tell your keys apart.
- **`allowedOrigins`** are the browser origins that may send the key, each as
  `scheme://host[:port]` with no path: `https`, or `http` for localhost, 50 at most. A request
  from another origin is refused. An empty list allows no browser origin, but a request without
  an `Origin` header, such as server-side rendering, still goes through. Give each site its own
  key, so one that leaks is revoked alone.
- `PublishableKeys.listPublishableKeys` pages the keys, newest first (`includeRevoked` adds the
  revoked ones, `read:publishable_keys`). `updatePublishableKey` changes a live key's `label` or
  `allowedOrigins`, from the next request on; a revoked key answers a 409.
  `revokePublishableKey` ends a key on the next request, for good, and is safe to repeat.
- The page sends the key with [`@kaitencloud/client`](../client), as `authScheme: "publishable"`.
  The API limits a key to 20 requests a second, with a burst of 40, which each API replica
  counts for itself; beyond it the page gets a 429 with a `Retry-After`.

Managing keys is part of billing: an organization that cannot reach it is refused with a 403
`Billing.Disabled` or `Billing.NotEntitled`, or with a 503 `Billing.EntitlementCheckUnavailable`
when whether its plan includes billing could not be checked.

## Webhooks

The contract declares the `com.kaiten.*` events, billing's among them (invoices issued,
paid and handed off, subscriptions started and changed, a trial about to end, payment methods,
vouchers, publishable keys), and this package ships a typed payload for each — but a payload alone says
nothing about **who sent it**. Verify the signature before acting on one; until you do, the
endpoint is unauthenticated and it drives licences and usage.

```ts
import express from "express";
import { verifyKaitenWebhook } from "@kaitencloud/server";

app.post("/kaiten", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = await verifyKaitenWebhook({
      payload: req.body, // the RAW bytes — see below
      headers: req.headers,
      secret: process.env.KAITEN_WEBHOOK_SECRET!, // the endpoint's `whsec_…`
    });
  } catch {
    return res.sendStatus(401);
  }

  switch (event.type) {
    case "com.kaiten.customer.v1.created":
      // narrowed to the customer-created payload here
      break;
    case "com.kaiten.instance.invoice.v1.issued":
      // narrowed to the invoice payload: event.data.total, in minor units, next to
      // event.data.currency
      break;
  }

  res.sendStatus(204);
});
```

`KaitenWebhookType` is the union of the event names the contract declares, and
`KaitenWebhookEvent` the union of their payloads: each name has exactly one payload, and
`isKaitenWebhookOfType(event, "com.kaiten.instance.invoice.v1.issued")` narrows an event to it
as a `switch` on `event.type` does. A release that follows a newer contract adds the events it
declares to both, so keep a `default` that acknowledges the events you do not handle.

> **Pass the raw body.** The signature covers the bytes on the wire, so a body that has been
> parsed and re-serialized — which is exactly what `express.json()` gives you — will not
> verify even when it is genuine: key order, whitespace and Unicode escaping all change the
> bytes. Use `express.raw()`, `await request.text()`, or your framework's raw-body hook.

Kaiten does not sign its webhooks itself: delivery goes through **Svix**, so this implements
the Svix / Standard Webhooks format (`svix-id` / `svix-timestamp` / `svix-signature`, with the
unbranded `webhook-*` names accepted too; HMAC-SHA256 over `id.timestamp.payload`; a 5-minute
timestamp tolerance; several signatures in one header so a secret can be rotated without
dropping deliveries). It is checked against the reference implementation's own golden vector.

Verification uses WebCrypto rather than `node:crypto`, so this package still runs unchanged on
Deno, Bun and edge runtimes.

## Resources

Generated and grouped by tag. The Core API:

`Customers`, `Instances`, `LicenseFamilies`, `Licenses`, `Entitlements`, `EntitlementGroups`,
`Components`, `DeploymentZones`, `MetadataFields`, `Releases`, `ServiceAccounts`, `Connectors`,
`Integrations`, `Featureflags`, `OfrepCore`, `OpenFeature` and `Notifications`.

Billing:

| Class              | What it holds                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `Billing`          | subscriptions, invoices, the handoff queue, settings, health and capabilities                      |
| `Addons`           | add-on families and versions, their prices and entitlements                                        |
| `Vouchers`         | vouchers, their redemptions, and redeeming one on an instance                                      |
| `CustomerSessions` | minting a customer session for a customer's browser, and revoking it                               |
| `PublishableKeys`  | issuing, listing, changing and revoking the `pk_` keys a web page reads the public catalog with    |
| `Public`           | the operations of the browser surface, for which a secret token is the wrong credential: see below |

Organization and user administration belongs to a separate API, under `/api/platform/**`,
with its own credentials; this SDK does not model it (see
[ARCHITECTURE.md](../../ARCHITECTURE.md)).

**`Public` is not called with the token of `createKaitenClient`.** Its operations, the public
catalog and the ten calls of a customer session, are what a browser calls with
[`@kaitencloud/client`](../client). The catalog takes a publishable key and no
`Authorization` header, and the session routes take a customer session (`kst_`): the API
refuses a `ksh_` token on both with `Auth.WrongCredentialKind`. The class is generated because
the contract declares the operations, not because a backend has a use for it. The one case is
a backend that acts for a customer through a session it minted: it builds a client whose
`token` is that session's `kst_`.

### Token lifetime

A token stops being honoured exactly at its `expiresAt`, with no grace period: plan the
renewal of a short-lived token before that instant.

## Development

```bash
vp install
vp run generate   # regenerate from contracts/openapi.yaml
vp check
vp test
vp pack
```

The resource classes are generated and must not be edited by hand; contract parity is
enforced by the OpenAPI drift gate and the `generated-sdk` CI job (which regenerates both
`@kaitencloud/client` and `@kaitencloud/server`).

## License

Apache-2.0. See `LICENSE` and `NOTICE`, and `THIRD_PARTY_NOTICES.md` for the
third-party code this package bundles. The license does not grant permission to use
the Kaiten name or logos: see the
[trademark policy](https://github.com/kaitencloud/sdk-js/blob/main/TRADEMARKS.md).
