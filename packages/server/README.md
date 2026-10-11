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

A usage report sent with a `transactionId` is applied once per key, instance and entitlement
over the API's idempotency window, 35 days by default: sent again with the same `behavior` and
value it answers its original result, and a key older than the window is forgotten and counts
as new. Under a key the API already accepted for another `behavior` or value, the report is
refused with a `TransactionIdReusedError` (409
`ReportEntitlementUsageMetric.TransactionIdReused`), a `KaitenError` whose `transactionId` is
the key it was sent with and whose `original` names the report the key was first accepted
with. `isTransactionIdReused` recognizes it. It is a bug in the caller, never a transient
failure: retrying it under the same key loops.

Every `KaitenError` also carries the problem's `code`, a stable machine-readable identifier
such as `License.NotFound`, and its `errorId`, the correlation id of the API's log entry for
the failure: quote it when you report a problem.

## Usage history and exports

The API keeps every usage report it accepts for your organization's usage history retention,
with the counter before and after it and the limit in force. Three generated operations read
that history, and the SDK adds no helper over them:

- `Instances.listUsageReports` pages one instance's entitlement, oldest report first: `afterSeq`
  (the `nextAfterSeq` of the previous page), `limit` (500 at most), `from`, `to`, and
  `transactionId` to find the report sent under a key.
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

## Webhooks

The contract declares 55 `com.kaiten.*` events and this package ships a typed payload for
each — but a payload alone says nothing about **who sent it**. Verify the signature before
acting on one; until you do, the endpoint is unauthenticated and it drives licences and usage.

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
  }

  res.sendStatus(204);
});
```

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

Generated and grouped by tag: `Customers`, `Instances`, `Licenses`, `LicenseFamilies`,
`Entitlements`, `EntitlementGroups`, `Components`, `DeploymentZones`, `MetadataFields`,
`Releases`, `ServiceAccounts`, `Connectors`, `Integrations`, `Notifications`,
`Featureflags`, `OfrepCore`, `OpenFeature`.

These cover the Core API. Organization and user administration belongs to a separate API,
under `/api/platform/**`, with its own credentials; this SDK does not model it (see
[ARCHITECTURE.md](../../ARCHITECTURE.md)).

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
