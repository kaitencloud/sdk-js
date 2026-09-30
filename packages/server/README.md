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

Every `KaitenError` also carries the problem's `code`, a stable machine-readable identifier
such as `License.NotFound`, and its `errorId`, the correlation id of the API's log entry for
the failure: quote it when you report a problem.

## Webhooks

The contract declares 49 `com.kaiten.*` events and this package ships a typed payload for
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

Generated and grouped by tag: `Customers`, `Instances`, `Licenses`, `Entitlements`,
`EntitlementGroups`, `Components`, `DeploymentZones`, `MetadataFields`, `Releases`,
`ServiceAccounts`, `Connectors`, `Integrations`, `Featureflags`, `OfrepCore`,
`OpenFeature`.

These cover the Core API. Organization and user administration belongs to a separate API,
under `/api/platform/**`, with its own credentials; this SDK does not model it (see
[ARCHITECTURE.md](../../ARCHITECTURE.md)).

### Token lifetime

A token stops being honoured exactly at its `expires_at`, with no grace period: plan the
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
