<!--
  Maintainers: every name below must match a real export. On every breaking
  release (any rename/removal in either package's src/index.ts), diff this
  document against those exports before publishing. `tests/public-surface.test.ts`
  here and `tests/public-api.test.ts` in react-ui pin them.
-->

# Stability & versioning — `@kaitencloud/react` and `@kaitencloud/react-ui`

> **Status: `1.x`, not on npm yet.** Both packages are published with Kaiten
> billing, at 1.0.0, and the guarantees below hold from that release on. The
> _stable_ surface follows semantic versioning: a breaking change to it needs a
> major release. The surface marked _experimental_ has **no stability
> guarantee**: it may change in a minor release. Pin an exact version if you
> build on it, and read the changelog before upgrading.

This document defines what is stable, what is experimental, and how we version —
so you can build on the parts least likely to move. It covers both React
packages: `@kaitencloud/react`, the headless core, and `@kaitencloud/react-ui`,
the styled components built on it. **The split is the boundary**: everything in
the core is on the blessed path below, and everything the UI package adds is
experimental, except each component's `unstyled` rendering. The two version independently, and the UI package depends on the
core with a caret range, so upgrading it never forks the provider.

## Versioning policy

- **The _stable_ surface:** standard semver. Patch = fixes; minor = features;
  a breaking change requires a major release, with a migration note in the
  changelog.
- **The _experimental_ surface:** a minor release may change its shape, and the
  changelog says so. Each item graduates to stable (and gains that guarantee) or
  is removed.
- **`@experimental` JSDoc tag:** anything tagged `@experimental` may change shape
  or be removed in a minor release. Your editor strikes it through.

## The blessed path (most stable)

Build on these first — they are the lowest-churn surface and the intended
integration points:

- **The `@kaitencloud/react` package** — it exports this blessed surface
  (provider, hooks, control primitives, helpers), the experimental telemetry types
  listed below, and no styled component, so a host on the stable path also gets
  the smallest bundle;
  `scripts/check-bundle-size.mjs` holds it there. `@kaitencloud/react-ui`
  re-exports every one of these names, by identity, so mixing the two imports in
  one app still yields one provider and one context.
- **Headless hooks** — they return data/decisions, you render:
  `useEntitlementCheck`, `usePaywallTrigger`, `useLicensingSnapshot`,
  `useReportUsage`, `useFeatureFlag` / `useFeatureFlags`, `useLicense`,
  `useInstance`, `useEntitlement`, `useUsage` / `useUsageGroup`, `usePlans`,
  `useCustomer`, `useEntitlements`, `useFlags`, `useAddOns`, `useCredits`,
  `useUpgradeOptions`, `useKaitenAvailable`, `useKaitenBranding`,
  `useLocalization`.
- **Provider & client** — `KaitenProvider` in its `authenticated` and `static`
  modes, `KaitenScopeProvider`, `KaitenClient`, the error types (`KaitenError`,
  `KaitenNetworkError`, `TransactionIdReusedError`, `InvalidTransactionIdError`,
  `KaitenThrownError`), and the type guards (`isEvaluationSuccess` /
  `isEvaluationFailure`).
- **`unstyled` mode** of every component — you bring the markup/styles, the SDK
  brings the logic. The DOM contract (`data-slot="…"`) is the targeting surface.
- **Headless control primitives** — `Gate` (render-prop gating; `useEntitlementCheck`
  is the hook equivalent), `Show`, `KaitenLoaded`/`KaitenLoading`/`KaitenFailed`.
  The gates decide on the entitlements, as the server does. The end of a licence
  (`LicenseTerm`, `snapshot.licenseTerm`) is information for a screen to show, and
  closes no gate: billing never moves `endLicenseDate`, so a gate that read it would
  lock out a customer whose subscription renewed.
- **Formatting and presentation utilities** — `formatKaitenMoney`,
  `formatKaitenDate`, `formatKaitenUsageWindowBound`, `pluralize`,
  `isCustomerFacing`, `unitLabel`, `saleUnitLabel`, `toSaleUnits`, `isUnlimited`,
  `resolveLicensePrice`.
- **The usage-window rule** — `isPeriodicEntitlement`, `getUsageScope`,
  `resolveUsageScope`, `usageWindowLabel`. An entitlement business rule, not a
  rendering detail: both window bounds present means a periodic counter, absent
  means lifetime, and neither answer is available when nobody read them.

## Experimental until Kaiten billing ships

These read the routes Kaiten billing adds, which no released Kaiten server
serves yet. They are written against the API contract that billing publishes and
tested against answers Kaiten's own code produced, and they may change, in a minor
release, as billing ships:

- **`mode="public"`** — the public catalog, `GET /public/catalog`, read with a
  publishable key.
- **`mode="customer-session"`** — `CustomerSessionKaitenProviderConfig`, its
  `sessionClient`, `initialData.portal`, the hooks that read it (`usePortal`,
  `useKaitenSessionClient`), and a customer session as the
  `authenticatedConfig` of `KaitenScopeProvider`. What every other hook
  answers under this mode — a snapshot built from the portal, with no customer,
  instance, licence or flags — is part of it.
- **`CheckoutSummary`** (`@kaitencloud/react-ui`). It shows the total of the
  items it is given, summed in the browser. Billing's rule is the opposite: the
  amount due is the server's, from a checkout's `dryRun` (`dueToday`), and the
  SDK never adds prices up. Until the component is rebuilt on that, its total is
  a summary of the host's own numbers, never an amount to charge, and its props
  will change.
- **The billing half of `PricingTable`** (`@kaitencloud/react-ui`): the price
  passed to `onSelectPlan`, and the "Contact us" link of a plan that is not
  `selfServe`.

## Experimental surface

Usable today, but **shape may change** in a minor release (treat as `@experimental`):

- **What `@kaitencloud/react-ui` adds.** Its styled components (default,
  non-`unstyled` rendering): `CustomerPortal` (and its sections
  `CurrentPlan`/`IncludedFeatures`/`UsageMeters`/`AddOns`/`FlagsSummary`),
  `PricingTable`, `FeatureComparison`, `CheckoutSummary`, `Paywall`, `PlanBadge`,
  `UpgradeButton`, `EntitlementStatusBar`, `FeatureCatalog`, `BillingSummary`,
  `KaitenBranding`. The names it re-exports from the core keep the core's
  guarantee.
- **Theming API** — `KaitenStyleRoot`, `useKaitenPortalContainer`, `appearance`
  (`KaitenAppearance`, the `themes.*` presets, the `--ktn-*` variable contract)
  and the prebuilt `kaiten.css`.
- **Telemetry** — `KaitenTelemetryOptions` / `KaitenTelemetryEvent` and the event map.

## How the surface grows

The types this package re-exports from `@kaitencloud/client` keep that package's
guarantees, set out in its [STABILITY.md](../client/STABILITY.md):

- the types the SDK returns may gain **optional** members in a minor release;
- `KaitenClientLike`, the interface you implement for the `client` prop, keeps
  its five methods for all of 1.x. A new capability is an interface of its own,
  as `KaitenSessionClientLike` is for the `sessionClient` of a customer session;
- **closed** unions stay as they are (`BillingInterval`,
  `ResolvedEntitlement["source"]`, `LicenseTerm["status"]`…), and **open**
  unions, written `"FLAT_FEE" | "USAGE_BASED" | (string & {})`, may gain a value
  in a minor release. Handle a value you do not know rather than assume the list
  is exhaustive.

This package's own types follow the same rules. The results of its hooks
(`EntitlementCheckResult`, `PaywallTriggerResult`, `GateState`,
`UseKaitenQueryResult`…) may gain optional members. The `reason` of
`PaywallTriggerResult` and `GateState` is `PaywallReason`, an open union: a later
billing adds reasons, so a switch over it needs a default, and `GateState.blocked`
already says whether a wall is up. `KaitenProviderMode` and the provider's props
type what you pass in, so a minor release may add a mode, as it may add an optional
prop.

## Practical guidance

- Prefer **`@kaitencloud/react` alone**, or hooks + `unstyled`, for production
  integrations you can't easily re-touch — they're the contract we intend to keep.
- Use the **styled components** to ship fast; expect to revisit them across minor
  releases.
- Watch the changelog; breaking changes to anything here are called out there.
