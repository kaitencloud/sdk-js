<!--
  Maintainers: every name below must match a real export. Before a release,
  check this document against src/index.ts here and in packages/server.
  tests/compat-1.0.test.ts and tests/compat/consumer-1.0.ts hold code written
  against 1.0 and must keep compiling unchanged: scripts/check-compat-1.0.mjs
  compiles the second against the 1.0.0 tarball and against this tree, and
  checks that every name of the 1.0.0 client and server is still exported,
  but for the ones REMOVED_SINCE_1_0 lists.
-->

# Stability & versioning — `@kaitencloud/client` and `@kaitencloud/server`

> **Status: `1.x`, published.** Both packages follow semantic versioning: nothing
> a 1.0 consumer wrote stops compiling or working in a 1.x release. A change that
> would needs a major release.

This document says what a minor release may add, what it never does, and how
the parts that have to grow — the client interfaces and the enumerations the
API extends — grow without breaking anyone.

## What a minor release may do

- Add exports: functions, classes, types, interfaces.
- Add **optional** members to the types the SDK returns (`Plan`, `PlanPrice`,
  `ResolvedEntitlement`, …) and to the types you pass in (`KaitenClientConfig`,
  `ReportUsageInput`, …).
- Add methods to `KaitenClient`, `KaitenSessionClient` and `KaitenAnonymousCheckoutClient`, and to the server's
  `KaitenBilling`, `KaitenHandoffQueue` and `KaitenInvoices`. You never implement
  those classes: their private fields make them nominal.
- Add an **optional** last parameter to a method, `KaitenClientLike`'s included.
  `getCatalog(options?)` gained one in 1.2. A call without it behaves as before,
  and an implementation written against 1.0, which takes none, still satisfies
  the interface.
- Add members to the **open** unions described below.
- Give a refusal a class of its own. It extends `KaitenError`, as the ones in
  [Errors and retries](#errors-and-retries) do.

## What it never does

- Remove or rename an export or a member, or make an optional member required.
  1.1.0 is the exception: it removed `MeterType` and the `Entitlement.meterType`
  field it typed, which the API never returned, and the changelog says so.
- Add a member, optional or not, to an interface you implement, such as
  `KaitenClientLike`: see below.
- Narrow a type you pass in, or widen a **closed** union the SDK returns, with
  one exception: a correction that names a value the API already sends and the
  client already passed through. `EntitlementType` gained `NUMBER_AI_CREDIT` that
  way in 1.2, and the changelog says so. Code that switched over it
  exhaustively is told about a value it was already receiving.
- Change what an existing call sends or returns for the same input, except to
  fix a defect, which the changelog names.
- Throw something that is not a `KaitenError` where 1.0 threw one. A subclass is a
  `KaitenError`; only its `name` differs.

## How the client interfaces grow

`KaitenClientLike` is the seam you implement — a fake, a cache, an SSR client.
It keeps its five 1.0 methods (`getCatalog`, `getLicensingSnapshot`,
`evaluateFlag`, `evaluateFlags`, `reportUsage`) for all of 1.x: a required
member would break every implementation, and an optional one would let a
consumer call a method an implementation silently lacks.

A new capability is a **separate interface** instead, implemented by whichever
client provides it. The first is `KaitenSessionClientLike`, the customer-session
calls (`getPortal`, `checkout`, …), which `KaitenSessionClient` implements. The
second is `KaitenAnonymousCheckoutClientLike`, the anonymous checkout of a visitor
with no account (`startCheckout`, `getCheckoutSession`, `confirmCheckout`, and
`holdsCheckoutSession` and `forgetCheckoutSession` for the token it keeps), which
`KaitenAnonymousCheckoutClient` implements. An implementation of your own opts into a
capability by implementing its whole interface, and code that needs the capability
takes that interface. The fakes `createMockKaitenSessionClient` and
`createMockKaitenAnonymousCheckoutClient`, of `@kaitencloud/client/testing`, are such
implementations:

```ts
import type { KaitenClientLike, KaitenSessionClientLike } from "@kaitencloud/client";

function mountBilling(client: KaitenClientLike, session?: KaitenSessionClientLike) {
  // Catalog and licensing from `client`; the portal only when a session is there.
}
```

## How enumerations grow

- **Closed unions** that 1.0 published stay as they are for all of 1.x:
  `BillingInterval` (`"month" | "year" | "one_time"`), `ResolvedEntitlement.source`
  (`"license" | "addon" | "credit"`), `ResolvedEntitlement.status`,
  `LicenseTerm.status`, `KaitenAuthScheme` and the other 1.0 enumerations. A
  longer billing period is not a new interval: it is `interval: "month"` with an
  `intervalCount` (`3` for a quarter). `"credit"` is reserved; no Kaiten server
  produces it yet.
- **Open unions** type the values the API may extend: billing models, pricing
  types, subscription and invoice statuses, payment outcomes. They read as
  `"FLAT_FEE" | "USAGE_BASED" | "OVERAGE" | (string & {})`: your editor still
  completes the known values, and a minor release may add one. Handle a value
  you do not know — skip it, or render it neutrally — rather than assuming the
  list is exhaustive. Every enumeration added after 1.0 is open unless it is a
  discriminant, such as `CheckoutResult["status"]`, `CheckoutSessionStart["status"]` and
  `CheckoutConfirmation["status"]`. `CheckoutSession["status"]`,
  `CheckoutSession["trialRefusedReason"]` and `CheckoutBillingPeriod` are open. The
  `source` of a usage row (`EntitlementUsage.source`, `license` or `addon` today) is
  open for that reason, while `ResolvedEntitlement.source`, which 1.0 published, stays
  closed.

## Prices

`PlanPrice.amount` is required, and a 1.0 reader takes `interval: "month"` for a
monthly price. So the lists typed `PlanPrice[]` — `Plan.prices`, `Addon.prices` —
only ever hold prices that shape describes faithfully: the default monthly and
annual flat fees, with integer amounts. Every price, quarterly and semi-annual
fees, usage and overage prices and prices below one minor unit included, is in
`billingPrices`, typed `BillingPrice`, whose `amount` is absent when the price is
not a whole number of minor units. New price shapes will arrive there, never in
`prices`.

## Errors and retries

A call the API refuses rejects with a `KaitenError`, which carries `status`, `code`,
`detail`, `errorId` and, when the API sent a `Retry-After`, `retryAfterSeconds`. Eight
refusals are a **subclass of `KaitenError`**, so `instanceof KaitenError`, `status` and
`code` keep working. `@kaitencloud/client` exports the classes, and `@kaitencloud/server`
a predicate for each of the first four, which narrows to its own `KaitenError`. The other
four are refusals of the anonymous checkout, a browser's: the server has no predicate for them.

| Client class                 | Server predicate        | Status and end of the code   | It carries          |
| ---------------------------- | ----------------------- | ---------------------------- | ------------------- |
| `QuotaExceededError`         | `isQuotaExceeded`       | 422 `*.QuotaExceeded`        | `entitlementSlugs`  |
| `RateLimitedError`           | `isRateLimited`         | 429 `*.RateLimited`          | `retryAfterSeconds` |
| `BoundaryPendingError`       | `isBoundaryPending`     | 409 `*.BoundaryPending`      | `retryAfterSeconds` |
| `ProviderUnavailableError`   | `isProviderUnavailable` | 503 `*.ProviderUnavailable`  | `retryAfterSeconds` |
| `TurnstileFailedError`       |                         | 422 `*.TurnstileFailed`      |                     |
| `TurnstileUnavailableError`  |                         | 503 `*.TurnstileUnavailable` | `retryAfterSeconds` |
| `CheckoutSessionClosedError` |                         | 409 `*.SessionClosed`        | `sessionStatus`     |
| `DueTodayChangedError`       |                         | 409 `*.DueTodayChanged`      |                     |

`QuotaExceededError` is the refusal of `CreateSessionCheckout.QuotaExceeded`, on a
`dryRun` as on a checkout; `entitlementSlugs` is read from the first entry of the
problem's `errors`. `CheckoutSessionClosedError.sessionStatus` is read from the first entry
of the problem's `errors` too, and is absent when the problem does not name it. Every other
refusal (`AlreadySubscribed`, `VoucherInvalid`, `SetupSessionIncomplete`,
`OtherVersionAttached`, `AnonymousCheckoutDisabled`, …) stays a plain `KaitenError`, read by
its `code`. A later minor release may give another refusal a class; it will extend
`KaitenError` too, and the eight above are never removed or retyped.

`KaitenAnonymousCheckoutClient` also raises `CheckoutTokenMissingError`, a `KaitenError`
with status `0` and no `code`, before any request, when it holds no token for the session
a call names.

- **`retryAfterSeconds`** is the `Retry-After` the API sent: a whole number of seconds,
  or an HTTP date, read as the seconds from now. It is absent when there is none. On
  the four classes made to be waited out it is always a number, **60 when the response
  carries no `Retry-After` the client can read**. That is the case of a browser calling
  another origin whose CORS policy does not expose the header; the 60 is a default, not
  the API's word. `@kaitencloud/server` always sees the header and invents nothing.
- **Reads are sent again** after a network failure or a 5xx, at most three attempts. A
  failure that carries a `Retry-After` is waited out: the next attempt waits that long,
  **never more than 30 seconds**. Without one, or when the header could not be read and
  the 60 above is only a default, the wait is a short backoff. The usage report
  under a `transactionId`, sent in the `Idempotency-Key` header, is replayed the same
  way, but after a 500, 502, 503 or 504 and no other 5xx: a 501 or a 505 answers the
  same every time, and is returned as it came. It is replayed only once the client has
  read an echoed key, the `transactionId` of a response to a keyed report: a server
  that ignores the header would count a replay twice, and only the echo says it does
  not. Until then the failure reaches the host after the first attempt, the key sent
  all the same, and the first keyed report of a client is never replayed. The cap is
  part of the behavior: raising or lowering it is a change the changelog names.
- **Writes are never sent again**, whatever the answer: not after a 409, a 422, a 429 or a
  503, nor after a network failure. The one exception is the usage report under a
  `transactionId`, described above. Nothing is sent again after a 429, read, write or
  keyed report.
- **`BoundaryPendingError` is not replayed.** It reaches the host with its delay, and
  the host decides whether to send the call again.

## Outside the guarantee

- **`KaitenApi.*`** (client) and the **generated resource classes** (server:
  `Customers`, `Instances`, …) are generated from the API contract and follow it.
  A contract change can change them in a minor release; the curated surface above
  does not move with them.
- **`KaitenWebhookType` and `KaitenWebhookEvent`** (server) are derived from the
  webhooks the API contract declares. An event the API starts to send is a new member
  of both, so a `switch` over `event.type` keeps a `default` for the events it does
  not handle. The helpers that verify and narrow an event (`verifyKaitenWebhook`,
  `isKaitenWebhookOfType`) are inside the guarantee.
- **What the server's helpers take and return.** `KaitenBilling`, `KaitenHandoffQueue`
  and `KaitenInvoices` have class and method names inside the guarantee. Their inputs
  and outputs (`HandoffClaim`, `Invoice`, `InvoicePayment`, …) are the generated
  contract types, and move with the contract like the resource classes do.
- Members tagged `@internal`, such as `KaitenTransport.callPublic`, are used
  between the SDK's own modules and may change in any release.
