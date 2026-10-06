# @kaitencloud/client

Kaiten SDK for the embedded monetization surface: the plan catalog, a customer's
licensing snapshot, entitlement usage and feature flags. It is built for browsers,
where it never holds a secret, and it runs on servers too.

## Install

```bash
npm install @kaitencloud/client
```

## Authentication

The API accepts a `ksh_` token, or a JWT from the identity provider its gateway trusts,
and both carry rights over a whole organization. Call Kaiten with them from your
backend, and send your pages only what they need. On a server, this client takes a
`ksh_` token with `authScheme: "bearer"`, as [`examples/node`](../../examples/node) does;
[`@kaitencloud/server`](../server) covers the whole API. In a browser, the client refuses
to send a `ksh_`, `ksm_` or `sk_` credential.

A browser has one credential of its own: a publishable key (`pk_`), which reads your
public catalog and nothing else. It needs a Kaiten server that serves the public routes
(`/api/public/*`).

A publishable key is `pk_` followed by 43 letters, digits, `-` or `_`.
`assertPublishableKeyShape(key)` throws for anything else (a key cut short by a paste,
or wrapped in quotes) and `isPublishableKeyShape(key)` answers true or false. The
client itself only checks the prefix of the key it sends, as `assertPublishableKey`
always has, so a test key such as `pk_live_abc` still works against a mock server.

`authScheme` is required:

- `"bearer"` sends the credential as `Authorization: Bearer`;
- `"publishable"` sends a publishable key as `X-Kaiten-Publishable-Key`, to
  `GET /public/catalog` only: `getCatalog()` reads it, with no cookie and no fallback,
  and every other call is refused before any request;
- `"none"` sends no credential, for an endpoint in front of Kaiten that authenticates the
  request itself.

### The public catalog

With a publishable key, `getCatalog()` returns the default published version of each
public licence family, its active prices and its public add-ons, and
`catalog.capabilities` says whether the organization takes self-serve checkouts and
payment methods. Each plan says whether it is `selfServe`, and where to send a customer
when it is not (`selfServeCtaUrl`).

Prices come in two lists. `plan.prices`, typed `PlanPrice[]` as in 1.0, holds the
default monthly and annual flat fees only: prices a 1.0 reader cannot misread.
`plan.billingPrices`, typed `BillingPrice[]`, holds every active price, in the API's
order:

- amounts are integers in the currency's minor units, as everywhere in this SDK
  (`4900` EUR is €49.00, `980` JPY is ¥980, `12500` KWD is 12.500 KWD);
- a quarterly or semi-annual fee is `{ interval: "month", intervalCount: 3 }` or `6`;
- a usage or overage price (`billingModel`) has no interval: it is per sale unit of its
  `meteredEntitlementSlug`, `saleUnitFactor` measured units each. Never add it into a
  headline;
- a price below one minor unit, such as `0.0002` cents per token, has no `amount`:
  render it from `unitAmountDecimal`, a decimal string, without converting it to a
  floating-point number.

`plan.price` and `plan.annualPrice` are the default monthly and annual flat fees.

To show a price, `majorUnitAmount(price)` gives its amount in the currency's major units
as an exact decimal string, without going through a floating-point number: `"49"` for a
`4900` EUR fee, `"2"` for `200` EUR per 1M tokens, and `"0.000002"` for a price of
`"0.0002"` per call. `Intl.NumberFormat` formats such a string as it is:

```ts
const amount = majorUnitAmount(price); // "0.000002"
new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: price.currencyCode,
  maximumFractionDigits: 20,
}).format(amount as `${number}`); // "€0.000002", and "€2.00" for "2"
```

A usage price is per sale unit, so the label is "€2.00 per 1M tokens" (`saleUnitSingular`),
or "€0.000002 per call" when the sale unit is one call. The amount is never divided down
to one measured unit and never added to the plan's fee. It returns `undefined` for a
currency the API does not know, rather than guess how many decimals it has.

`getCatalog` takes optional arguments that narrow the read, and send nothing more than
they name:

```ts
await client.getCatalog({ familySlug: "pro" }); // that family's plan, and the add-ons
await client.getCatalog({ include: "none" }); // every plan, without the add-ons
```

`include` is `"addons"` (the default) or `"none"`. An empty `familySlug`, or an
`include` that is neither, throws a `TypeError` before any request. A client with
any other credential composes its catalog from your licences and ignores both.

`catalog.capabilities.checkout` is what the API says about the organization: a plan
of this catalog can be bought alone. It is read from the response, not worked out from
the plans. When it is `false`, show each plan's `selfServeCtaUrl` instead of a
purchase button.

### Customer sessions

A browser acting for one signed-in customer — a customer portal, a checkout — uses a
customer session (`kst_`), which your backend mints with `createCustomerSession` of
[`@kaitencloud/server`](../server) and hands to the page. `KaitenSessionClient` sends
it, given a `getCustomerSession` callback that fetches one:

```ts
import { KaitenSessionClient } from "@kaitencloud/client";

const billing = new KaitenSessionClient({
  apiUrl: "https://kaiten.example.com/api",
  // Your own endpoint, which calls createCustomerSession and returns
  // { token, expiresAt }.
  getCustomerSession: () => fetch("/billing/session", { method: "POST" }).then((r) => r.json()),
});

const portal = await billing.getPortal();
```

It is a class of its own, apart from `KaitenClient`: it holds a different credential,
which it sends as `Authorization: Bearer kst_…` to `/api/public/session/*` and nowhere
else. It calls `getCustomerSession` for its first call and again 60 seconds before the
session expires, once for any number of concurrent calls; when the API refuses a
session (401), it renews it and sends the request once more, and a second refusal
reaches `onAuthError`.

| Call                                                                | Route                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| `getPortal()`                                                       | `GET /public/session/portal`                             |
| `listInvoices({ cursor?, limit? })`                                 | `GET /public/session/invoices`                           |
| `checkout(input)`                                                   | `POST /public/session/checkout`                          |
| `cancelSubscription({ reason? })`, `reactivateSubscription()`       | `POST /public/session/billing/cancel`, `…/reactivate`    |
| `createPortalSession({ returnUrl })`                                | `POST /public/session/billing/portal-session`            |
| `createPaymentMethodSession(…)`, `completePaymentMethodSession(id)` | `POST /public/session/billing/payment-method-session[…]` |
| `validateVoucher({ code, licensePriceId? })`                        | `POST /public/session/vouchers/validate`                 |
| `setAddonQuantity(addonSlug, quantity)`                             | `PUT /public/session/addons/{addonSlug}`                 |

The portal's entitlements are the instance's effective ones — the licence grant with
its add-ons and voucher boosts applied — each with its `source` and its `provenance`.
Every amount and total comes from the server: the SDK never sums prices. A `checkout`
with `dryRun: true` previews what is due today.

A refused call rejects with a `KaitenError` carrying the API's `status` and `code`, such
as `CreateSessionCheckout.AlreadySubscribed`; a 429 or a `*.BoundaryPending` also
carries `retryAfterSeconds`. Reads are retried after a network failure or a 5xx; writes
never are.

### Scopes

The API checks a token's scopes on every call. Give the token the scopes of the calls
you make:

| Call                                         | Scopes                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `components.getCatalog()`                    | `read:licenses`, `read:entitlements`                                                           |
| `components.getSnapshot()`                   | `read:licenses`, `read:entitlements`, `read:customers`, `read:instances`, `read:feature_flags` |
| `customers.*`                                | `read:customers`                                                                               |
| `instances.*`                                | `read:instances`                                                                               |
| `licenses.*`                                 | `read:licenses`                                                                                |
| `usage.getByInstance()`, `usage.getDetail()` | `read:instances`                                                                               |
| `usage.getByGroup()`                         | `read:entitlements`                                                                            |
| `usage.report()`                             | `write:instances`                                                                              |
| `flags.*`                                    | `read:feature_flags`                                                                           |

A call that needs a scope the token lacks is refused with `403` and the code
`Auth.MissingScope`. The two composed reads degrade instead of failing: when the API
refuses the GraphQL query for a missing scope, `getCatalog()` falls back to REST, which
needs only `read:licenses` but loses the presentation fields, and `onDegraded` reports
it; without `read:feature_flags`, the snapshot comes back with no flags.

## Quick start

On your backend:

```ts
import { KaitenClient } from "@kaitencloud/client";

const kaiten = new KaitenClient({
  apiUrl: process.env.KAITEN_API_URL!, // your Kaiten API's URL, /api included
  authScheme: "bearer",
  tokenProvider: () => process.env.KAITEN_API_TOKEN!, // a ksh_ token: it stays on the server
});

const catalog = await kaiten.components.getCatalog();
const snapshot = await kaiten.components.getSnapshot("acme-corp");
```

### Resource namespaces

- `kaiten.components` — embedded monetization: `getCatalog()`, `getSnapshot(customerId, instanceId?)`
- `kaiten.customers` / `kaiten.instances` / `kaiten.licenses` — curated reads
- `kaiten.usage` — entitlement usage (read + report)
- `kaiten.flags` — feature-flag evaluation (`evaluate`, `evaluateAll`)

## Reporting usage

A usage report is not idempotent: `append 500` sent twice counts 1 000. When a
report times out, the client cannot know whether the API counted it, so a report
without a key is sent **exactly once** and never retried.

Give it a `transactionId` and the API applies it once, whatever the number of
times it arrives. The client sends the key in the `Idempotency-Key` request
header; the body is the report alone.

```ts
import { KaitenError, TransactionIdReusedError } from "@kaitencloud/client";

try {
  const usage = await kaiten.reportUsage("acme-production", "tokens", {
    value: { type: "number", value: 1_250 },
    behavior: "append",
    transactionId: `llm-call:${callId}:tokens`, // 1 to 128 of [A-Za-z0-9._:-]
  });
  if (usage.idempotentReplayed) {
    // Already counted: `usage` is that report's original result, not the current gauge.
  }
} catch (error) {
  if (error instanceof TransactionIdReusedError) {
    // A bug in the caller: the key was used for another value. error.original names it.
  }
  throw error;
}
```

- **One key per measurement.** A key is scoped to the instance and the
  entitlement. The API remembers it for 35 days by default, and that window is
  what makes a retry safe: a report sent again under the same key inside it is
  applied once, while a key older than that is forgotten and counts as new. The
  same business event can feed two meters under one key. A correction is a new
  report under a new key, with `behavior: "set"` for an absolute value: under the
  original key it is refused with `TransactionIdReusedError` (409), which is
  never retried.
- **The echo.** A server that honours the key answers with it: the result's
  `transactionId` is the key the report was accepted under, on the first answer
  and on every replay, and `null` for a report sent without one.
- **Retries.** With a key, a report that fails on the network, times out or
  answers a 500, 502, 503 or 504 is retried, up to three attempts, all under the
  same key, **once this client has received an echoed key**. Until then the
  failure surfaces after the first attempt, key sent all the same: a server that
  ignored the header would count the retry a second time, and only an echo says
  that this one does not. So the first keyed report of a client is never retried,
  and a client created for each request never retries. Any other status, a 501
  for one, is returned as it came: asking again gets the same answer. A retry the
  API already applied resolves with `idempotentReplayed: true` and counts
  nothing. The memory is the client's, not the process's: another client keeps
  its own.
- **Older servers.** A server that predates the header ignores it: the report is
  counted every time it arrives, its answer carries no `transactionId`, and the
  client therefore never retries it. Send keys to a server that reads the header
  to get the protection.
- **No generated keys.** The client never makes a key up: without one, the body
  is the one you passed and the request carries no `Idempotency-Key` header.
- **Malformed keys** are refused before anything is sent, with an
  `InvalidTransactionIdError`: the same error the API answers a malformed key
  with (422, located at `header.Idempotency-Key`). An empty string is refused
  too, because the API reads an empty header as no key at all.
- **Browsers.** The header is not one a browser sends on its own: a page that
  reports usage from the browser triggers a preflight, which the API answers by
  allowing `Idempotency-Key`.
- **Dropped metadata.** `metadataDropped: "too_large"` says the report's
  `metadata` was above 4 KiB and was not stored. The report itself was counted.

## Testing without an API — `@kaitencloud/client/testing`

Building or testing a Kaiten integration used to need a Kaiten account and a
reachable API. It doesn't: `@kaitencloud/client/testing` ships a fake client and
a set of licensing fixtures.

```ts
import { createMockKaitenClient } from "@kaitencloud/client/testing";

const client = createMockKaitenClient();
const catalog = await client.getCatalog();
const snapshot = await client.getLicensingSnapshot("acme");
```

No network: the fake implements `KaitenClientLike`, so code that takes a client
reads the fixtures through the same methods it calls on the real one.

### Driving a scenario

```ts
createMockKaitenClient({
  catalog: demoCatalogWithoutPrices(), // no amounts anywhere, as the API returns them
  snapshot: demoSnapshot({ license: null }),
  delayMs: 1500, // hold loading states still
  error: new Error("backend down"), // drive failure states
});
```

It is a **fake, not a stub**. `reportUsage` moves the usage it reports —
`currentValue`, `remaining`, `percentageUsed` and the `near_limit`/`over_limit`
status change together, as the snapshot normalizer does — so a usage meter that
looks right against the fixtures behaves the same against the API.

It echoes the key of a report as a current server does: the result's `transactionId` is the
`transactionId` you passed, `null` without one. It keeps no ledger of keys, so it never answers
a replay and never refuses a reused key: a test of either builds the result, or the error.

```ts
const client = createMockKaitenClient();
await client.reportUsage("acme-production", "seats", {
  value: { type: "number", value: 3 },
  behavior: "append",
});
client.snapshot.entitlements.find((e) => e.slug === "seats");
// → 24 / 25, remaining 1, status "near_limit"
client.usageReports; // every call, for assertions
```

### Fixtures

`demoCustomer` · `demoInstance` · `demoLicense` · `demoPlans` ·
`demoPlansWithoutPrices` · `demoCatalog` · `demoCatalogWithoutPrices` ·
`demoEntitlements` · `demoFlags` · `demoAddOns` · `demoCredits` ·
`demoSnapshot` · `demoSnapshotWithoutPrices`

Each is a **factory**, so one test's mutation cannot reach another, with fixed
ids and timestamps for stable assertions and visual baselines.

They are deliberately not the minimum that type-checks. Amounts are in minor
units (`7900` = $79.00); the metered `tokens` entitlement carries a sale unit
distinct from its base unit (`saleUnitFactor: 1_000_000`, so "$8 per 1M tokens"
is expressible); the catalog contains an **unpublished** license, a draft that is not for sale, so a
pricing page that renders the fixtures exercises its `published` filter;
and the resolved entitlements span every branch a UI must render — healthy, near
limit, over limit, unlimited, boolean, and one internal counter with
`userFacing: false`. The snapshot's `license.slug` matches a priced plan, so
joining the snapshot to the catalog's prices resolves.

### Bringing your own client

Type the client your code takes as `KaitenClientLike` — the five methods a UI
consumes (`getCatalog`, `getLicensingSnapshot`, `evaluateFlag`, `evaluateFlags`,
`reportUsage`) — rather than the `KaitenClient` class. The class has a private
field, so TypeScript types it nominally and no object could satisfy it
structurally; every double would end in `as unknown as KaitenClient`, a cast
that turns a checked substitution into an unchecked one. Implement the interface
instead, for a custom transport, cache or SSR arrangement. `KaitenClient`
implements it, so a real client still fits.

The customer-session calls are a second interface, `KaitenSessionClientLike`, which
`KaitenSessionClient` implements: a double of the session client implements that one.

## Data path

With a publishable key, `getCatalog` reads `GET /public/catalog` and nothing else.
With any other credential, `getCatalog` / `getSnapshot` are **GraphQL-first**: one composed query against the
API's `/graphql` endpoint (a backend aggregate in kaiten) returns the customer,
its instances with live usage, and the full plan catalog with presentation metadata.
Against an older API without the GraphQL schema, the client **falls back** to
composing the same shape from existing REST endpoints (licenses, customers,
instances, entitlement usage). Snapshot feature flags are resolved **live via OFREP**
(bulk evaluation with the customer as targeting key) on both paths.

An entitlement's `limitValue` is what the instance is entitled to: the usage read's
`limit` when it carries one, the licence grant otherwise. A Kaiten server with add-ons
and vouchers answers that read with the instance's effective value — the grant with its
add-ons and boosts applied, which is what its usage gate enforces — and an older server
with the grant itself.

The allowance above it follows the same rule. `limitCapExceededOveragePercent` is the usage
read's when the read carries one (`-1` when the limit is unlimited), the grant's otherwise,
and `maximumAllowedUsage`, `remaining` and `status` are measured against the pair. The REST
usage reads (`usage.getByInstance`, `usage.getDetail`, `reportUsage`) also type what a
current server says of a row: `source`, the layer that grants the entitlement (`license` or
`addon`, and open: handle a value you do not know), and `provenance`, the licence's grant,
the add-ons and the voucher boosts the limit is made of, with the identifiers of the rows
they come from. All three are optional: an older server sends none. They also accept `null`:
the answer to a replayed report (`idempotentReplayed: true`) is rebuilt from the report's
journal entry, which keeps neither the layer nor its arithmetic, so its `source` and
`provenance` are `null`, and the percent is `null` for a flag or a configuration, which has no
value to cap. Check `row.source != null` before reading them. The GraphQL read does not select
them yet, so on that path the percent stays the grant's.

Commerce concepts the backend does not model — add-ons, credits, portal actions,
billing capabilities, branding — are returned as client-side defaults.

A client-side license-key `validate`/`activate` flow was removed: it required a backend
license-key model that Kaiten's managed-SaaS design (instances are bound to a license
server-side) does not have.

## Development

```bash
vp install
vp check
vp test
vp pack
vp run generate-graphql   # regenerate src/graphql/generated/ from the committed schema snapshot
```

`generate-graphql` reads the **committed schema snapshot**, `contracts/schema.graphql` at the repository root, so
building and publishing never need a kaiten checkout. Refreshing that snapshot is the
separate step, run from the repo root:

```bash
node scripts/sync-graphql-schema.mjs          # snapshot <- kaiten (KAITEN_PATH)
vp run @kaitencloud/client#generate-graphql   # types    <- snapshot
```

`node scripts/check-graphql-drift.mjs` guards both links. It matters more here than for
REST: GraphQL is the **primary** read path for `getCatalog` and `getLicensingSnapshot`, and
a failure falls back to the REST fan-out silently — so a schema change can kill the fast
path (and the presentation fields only GraphQL carries) without anything visibly breaking.

The generated OpenAPI client lives in `src/core/generated`; the committed OpenAPI
snapshot it is generated from lives in `contracts/openapi.yaml` at the repository root.

## License

Apache-2.0. See `LICENSE` and `NOTICE`, and `THIRD_PARTY_NOTICES.md` for the
third-party code this package bundles. The license does not grant permission to use
the Kaiten name or logos: see the
[trademark policy](https://github.com/kaitencloud/sdk-js/blob/main/TRADEMARKS.md).
