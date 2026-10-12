<!--
  Maintainers: every name below must match a real export. On every breaking
  release (any rename/removal in either package's src/index.ts), diff this
  document against those exports before publishing. `tests/public-surface.test.ts`
  here and `tests/public-api.test.ts` in react-ui pin them.
-->

# Stability & versioning — `@kaitencloud/react` and `@kaitencloud/react-ui`

> **Status: `1.x`.** The _stable_ surface below follows semantic versioning: a
> breaking change to it needs a major release. The surface marked _experimental_
> has **no stability guarantee**: it may change in a minor release. Pin an exact
> version if you build on it, and read the changelog before upgrading.

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
- **Provider & client** — `KaitenProvider` (its three modes: `authenticated`,
  `public`, `static`), `KaitenScopeProvider`,
  `KaitenClient`, the error types (`KaitenError`, `KaitenNetworkError`,
  `KaitenThrownError`), and the type guards (`isEvaluationSuccess` / `isEvaluationFailure`).
- **`unstyled` mode** of every component — you bring the markup/styles, the SDK
  brings the logic. The DOM contract (`data-slot="…"`) is the targeting surface.
- **Headless control primitives** — `Gate` (render-prop gating; `useEntitlementCheck`
  is the hook equivalent), `Show`, `KaitenLoaded`/`KaitenLoading`/`KaitenFailed`.
- **Formatting and presentation utilities** — `formatKaitenMoney`,
  `formatKaitenDate`, `formatKaitenUsageWindowBound`, `pluralize`,
  `isCustomerFacing`, `unitLabel`, `saleUnitLabel`, `toSaleUnits`, `isUnlimited`,
  `resolveLicensePrice`.
- **The usage-window rule** — `isPeriodicEntitlement`, `getUsageScope`,
  `resolveUsageScope`, `usageWindowLabel`. An entitlement business rule, not a
  rendering detail: both window bounds present means a periodic counter, absent
  means lifetime, and neither answer is available when nobody read them.

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

## Practical guidance

- Prefer **`@kaitencloud/react` alone**, or hooks + `unstyled`, for production
  integrations you can't easily re-touch — they're the contract we intend to keep.
- Use the **styled components** to ship fast; expect to revisit them across minor
  releases.
- Watch the changelog; breaking changes to anything here are called out there.
