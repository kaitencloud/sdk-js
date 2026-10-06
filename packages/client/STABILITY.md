<!--
  Maintainers: every name below must match a real export. Before a release,
  check this document against src/index.ts here and in packages/server.
  tests/compat-1.0.test.ts holds code written against 1.0 and must keep
  compiling unchanged.
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
- Add methods to `KaitenClient` and `KaitenSessionClient`. You never implement
  those classes: their private fields make them nominal.
- Add members to the **open** unions described below.

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

## How the client interfaces grow

`KaitenClientLike` is the seam you implement — a fake, a cache, an SSR client.
It keeps its five 1.0 methods (`getCatalog`, `getLicensingSnapshot`,
`evaluateFlag`, `evaluateFlags`, `reportUsage`) for all of 1.x: a required
member would break every implementation, and an optional one would let a
consumer call a method an implementation silently lacks.

A new capability is a **separate interface** instead, implemented by whichever
client provides it. The first is `KaitenSessionClientLike`, the customer-session
calls (`getPortal`, `checkout`, …), which `KaitenSessionClient` implements. An
implementation of your own opts into a capability by implementing its whole
interface, and code that needs the capability takes that interface:

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
  discriminant, such as `CheckoutResult["status"]`.

## Prices

`PlanPrice.amount` is required, and a 1.0 reader takes `interval: "month"` for a
monthly price. So the lists typed `PlanPrice[]` — `Plan.prices`, `Addon.prices` —
only ever hold prices that shape describes faithfully: the default monthly and
annual flat fees, with integer amounts. Every price, quarterly and semi-annual
fees, usage and overage prices and prices below one minor unit included, is in
`billingPrices`, typed `BillingPrice`, whose `amount` is absent when the price is
not a whole number of minor units. New price shapes will arrive there, never in
`prices`.

## Outside the guarantee

- **`KaitenApi.*`** (client) and the **generated resource classes** (server:
  `Customers`, `Instances`, …) are generated from the API contract and follow it.
  A contract change can change them in a minor release; the curated surface above
  does not move with them.
- Members tagged `@internal`, such as `KaitenTransport.callPublic`, are used
  between the SDK's own modules and may change in any release.
