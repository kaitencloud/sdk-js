# @kaitencloud/client

Kaiten SDK for the embedded monetization surface: the plan catalog, a customer's
licensing snapshot, entitlement usage and feature flags. It is built for browsers,
where it never holds a secret, and it runs on servers too.

## Install

```bash
npm install @kaitencloud/client
```

## Authentication

This release has no credential for your end users' browsers: publishable keys (`pk_`)
and customer-scoped session tokens are planned, not served. The API accepts a `ksh_`
token, or a JWT from the identity provider its gateway trusts, and both carry rights
over a whole organization.

So call Kaiten from your backend, and send your pages only what they need. On a server,
this client takes a `ksh_` token with `authScheme: "bearer"`, as
[`examples/node`](../../examples/node) does; [`@kaitencloud/server`](../server) covers
the whole API. In a browser, the client refuses to send a `ksh_`, `ksm_` or `sk_`
credential.

`authScheme` is required:

- `"bearer"` sends the credential as `Authorization: Bearer`;
- `"publishable"` sends it as `X-Kaiten-Publishable-Key`, for the publishable keys to
  come: no endpoint accepts them in this release;
- `"none"` sends no credential, for an endpoint in front of Kaiten that authenticates the
  request itself.

### Scopes

The API checks a token's scopes on every call. Give the token the scopes of the calls
you make:

| Call                                                                  | Scopes                                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `components.getCatalog()`                                             | `read:licenses`, `read:entitlements`                                                           |
| `components.getSnapshot()`                                            | `read:licenses`, `read:entitlements`, `read:customers`, `read:instances`, `read:feature_flags` |
| `customers.*`                                                         | `read:customers`                                                                               |
| `instances.*`                                                         | `read:instances`                                                                               |
| `licenses.*`                                                          | `read:licenses`                                                                                |
| `usage.getByInstance()`, `usage.getDetail()`                          | `read:instances`                                                                               |
| `usage.getByGroup()`                                                  | `read:entitlements`                                                                            |
| `usage.report()`                                                      | `write:instances`                                                                              |
| `ai.reserve`, `commit`, `release`, `run`, `refund`                    | `write:instances`                                                                              |
| `ai.listInferences`, `listOrganizationInferences`, `listReservations` | `read:instances`                                                                               |
| `flags.*`                                                             | `read:feature_flags`                                                                           |

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
- `kaiten.ai` — AI credits on a credit entitlement: `reserve`, `commit`, `run` (below)

### AI credits

A call to a model reserves its estimate on an AI credit entitlement, runs, and commits
what it really used, under one `transactionId`. Kaiten prices it; the SDK never
carries credits, and Kaiten never sees a prompt or a completion.

```ts
import { fromOpenAI } from "@kaitencloud/client";

const completion = await kaiten.ai.run(
  {
    instance: "acme-prod",
    entitlement: "chat-credits",
    model: "gpt-4o",
    requestType: "COMPLETION",
    estimate: { inputTokens: 1000, outputTokens: 800 },
    usage: (result) => fromOpenAI(result.usage),
  },
  () => openai.chat.completions.create({ model: "gpt-4o", messages, max_tokens: 800 }),
);
```

A refused reservation throws before the provider is called:
`InsufficientCreditsError`, `ModelNotAuthorizedError`, `UnknownModelError`.
`TransactionIdReusedError` is a caller bug and is never retried,
`NotAnAiCreditPoolError` means the entitlement is not an AI credit pool (a
configuration error, thrown on every call, never a reason to run unmetered), and
`AiUsageUnsupportedError` means the server predates AI reports.
Both phases are retried three times on network errors and 500/502/503/504 under
the same `transactionId` and identical phase/body. AI reports do not send
`Idempotency-Key`, even when it is configured in transport defaults: that header
belongs to numeric usage adjustments and the API rejects it on `ai_usage` reports.
`fromOpenAI` and `fromAnthropic` map a provider's usage onto the disjoint token
fields; omitted usage remains unknown, not zero. Credit amounts, remaining credits
and non-token units retain the API's exact decimal strings; ordinary AI pool reads
still carry `{ type: "number", value: ... }`.

#### Vendor cost, release and failed commits

`commit` takes an optional `vendorCost`: what the provider charged for the call, in
USD, as an exact decimal string such as `"0.0125"`. Kaiten records it beside the cost
it computes from the model catalogue; it never changes the credits charged. It is a
string, never a number, because it is part of the commit's identity: a retry sends
the byte-identical value, and `"0.01"` and `"0.010"` are two different commits. It is
refused on `reserve` and on a `NOT_SENT` commit, validated before anything is sent,
and, when the API predates it, dropped with a warning while the commit goes on. The
SDK never computes a cost: pass the provider's own figure, unchanged. `run` takes a
`vendorCost(result)` reader for the same purpose.

```ts
await kaiten.ai.commit({
  instance: "acme-prod",
  entitlement: "chat-credits",
  transactionId,
  requestStatus: "SUCCESS",
  usage: fromOpenAI(completion.usage),
  vendorCost: costReportedByYourGateway, // a decimal string, or omit it
});
```

The answer's `outcome.rule` names the conversion rule that priced the phase, and its
`specificity`. `outcome.warnings` is an open list of strings (`AiUsageWarning`):
`NO_RESERVATION`, `COUNTER_PRECISION_DEGRADED` and others, plus any the API adds later.

`ai.release({ instance, entitlement, transactionId })` is a `NOT_SENT` commit. For a
transaction that never reserved, the API answers `RELEASED` with `NO_RESERVATION`
and keeps a tombstone: a reserve or commit that arrives later under the same
`transactionId` throws `TransactionIdReusedError`. Release a reserve whose answer
was lost to close it.

A commit that still fails after its retries never fails the call that ran. `run`
hands it to `onCommitError(error, failed)`; `failed.retry()` resends the same commit,
byte for byte, so it can be persisted and settled later. Without the hook it is
logged, and the reservation expires on its own.

You rarely write this by hand: `@kaitencloud/ai-openai`, `@kaitencloud/ai-anthropic`
and `@kaitencloud/ai-vercel` reserve before each bounded provider call.
`@kaitencloud/ai-claude-agent` and `@kaitencloud/ai-copilot` observe post-call usage
only; they cannot stop a model request before it runs. `@kaitencloud/ai-codex`
gates submitted prompts, not each internal model inference.

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

## Data path

`getCatalog` / `getSnapshot` are **GraphQL-first**: one composed query against the
API's `/graphql` endpoint (a backend aggregate in kaiten) returns the customer,
its instances with live usage, and the full plan catalog with presentation metadata.
Against an older API without the GraphQL schema, the client **falls back** to
composing the same shape from existing REST endpoints (licenses, customers,
instances, entitlement usage). Snapshot feature flags are resolved **live via OFREP**
(bulk evaluation with the customer as targeting key) on both paths.

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

### AI catalogue and history reads

The regenerated KTN-201 contract provides explicit read namespaces:

```ts
const page = await kaiten.models.list({ status: "ACTIVE", limit: 50 });
const model = await kaiten.models.get("model-slug");
const rules = await kaiten.licenses.conversionRules.list("license-slug", {
  entitlementSlug: "credits",
});
const rule = await kaiten.licenses.conversionRules.get("license-slug", "rule-id");
const history = await kaiten.ai.listInferences(
  { instance: "acme", entitlement: "credits" },
  {
    status: "COMMITTED",
    cursor: undefined,
    limit: 50,
  },
);
const reservations = await kaiten.ai.listReservations({ instance: "acme", entitlement: "credits" });
const organization = await kaiten.ai.listOrganizationInferences({
  instanceSlug: "acme",
  authorized: "false",
  cursor: undefined,
});
```

Inference rows explain a charge: `pricing` (the rule snapshot that priced it),
`licenseId`/`licenseSlug`, `warnings`, `reportSeq` (the link to the usage journal),
`vendorCost` (`reported`, `computed`, `currency`), `refunds` and `credits.refunded`.
Both listings filter on `authorized`, `modelSlug`, `model`, `requestType`, `status`,
`transactionId` and a `from`/`to` range; the organization listing also on
`instanceSlug` and `entitlementSlug`. A release that closed no reservation is listed
only with `status: "RELEASED"` or its `transactionId`. Against an older API, rows
come without the new members, and `refunds` and `warnings` are filled with `[]`.

```ts
const refund = await kaiten.ai.refund({
  instance: "acme",
  entitlement: "credits",
  transactionId: "req-42",
  credits: "3.5", // omit it to refund everything left
  reason: "duplicate call",
});
```

`refund` generates its idempotency key when you pass none and reuses it on its own
retries; pass `idempotencyKey` to keep a refund safe across restarts. Refusals throw
`AiRefundError` (with its `reason`) or one of its subclasses:
`AiInferenceNotFoundError`, `AiInferenceNotCommittedError`, `NothingToRefundError`,
`RefundExceedsRefundableError` (whose `refundable` is what is left),
`RefundIdempotencyKeyReusedError` and `AiPoolNotGrantedError`.

Pages preserve the server's `nextCursor`, `hasMore` and nullable `items`; callers
choose when to fetch the next page. Credit `reserved` and report `ai` outcomes
are generated contract fields, including nullable unlimited `remaining`.
The full server SDK exposes generated `Models`, `Licenses` and `Instances`
operations for administration as well as reads.

For this feature branch, the snapshots were synced from a local Kaiten checkout
of the commit `.github/kaiten-contract-source.json` names
with `KAITEN_OPENAPI=/path/to/kaiten/app/openapi.yaml` and
`KAITEN_PATH=/path/to/kaiten`, using the standard sync scripts. This does not
add a product-to-workspace dependency; generation reads committed snapshots.
