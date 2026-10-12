"use client";

/**
 * `@kaitencloud/react` — the headless core.
 *
 * The provider, every hook, the control primitives (`Gate`, `Show`,
 * `KaitenLoaded`/`Loading`/`Failed`, `KaitenErrorBoundary`), the DOM events
 * and the rules the styled components apply: everything a host needs to gate
 * its own UI in its own design system, and nothing that draws — no styled
 * component, no class-variance-authority, no tailwind-merge, no stylesheet to
 * import. The components live in `@kaitencloud/react-ui`, which depends on
 * this package and re-exports it, so a host that uses them imports from one
 * place; a host that does not never installs them.
 *
 * `scripts/check-bundle-size.mjs` pins the boundary: a bundle built from this
 * package must not contain any UI-only dependency.
 */

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export {
  KaitenProvider,
  KaitenScopeProvider,
  type CustomerSessionKaitenProviderConfig,
  type KaitenProviderMode,
  type KaitenProviderProps,
  type KaitenScopeProviderProps,
  type StaticKaitenProviderConfig,
  useKaitenAvailable,
} from "./providers/kaiten-provider.tsx";

// ---------------------------------------------------------------------------
// Client, errors, events
// ---------------------------------------------------------------------------

export {
  InvalidTransactionIdError,
  KaitenClient,
  KaitenError,
  KaitenNetworkError,
  TransactionIdReusedError,
  getUsageScope,
  isEvaluationFailure,
  isEvaluationSuccess,
  isPeriodicEntitlement,
  resolveUsageScope,
} from "@kaitencloud/client";
// Raw generated OpenAPI types/operations namespace (advanced use); the curated
// surface is exported through `./types.ts`.
export { KaitenApi } from "@kaitencloud/client";
export { emitKaitenEvent, kaitenComponentEvents } from "./events.ts";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export { useLicense } from "./hooks/use-license.ts";
export { useInstance } from "./hooks/use-instance.ts";
export { useEntitlement } from "./hooks/use-entitlement.ts";
export { useUsage, useUsageGroup, type EntitlementGroupUsageRow } from "./hooks/use-usage.ts";
export { useFeatureFlag } from "./hooks/use-feature-flag.ts";
export { useFeatureFlags } from "./hooks/use-feature-flags.ts";
export {
  useEntitlementCheck,
  type EntitlementCheckOptions,
  type EntitlementCheckResult,
} from "./hooks/use-entitlement-check.ts";
export { usePaywallTrigger, type PaywallTriggerResult } from "./hooks/use-paywall-trigger.ts";
export { useReportUsage, type ReportUsageArgs } from "./hooks/use-report-usage.ts";
export { useUpgradeOptions } from "./hooks/use-upgrade-options.ts";
export { useLicensingSnapshot } from "./hooks/use-licensing-snapshot.ts";
export { usePlans } from "./hooks/use-kaiten-plans.ts";
export { useCustomer } from "./hooks/use-kaiten-customer.ts";
export { useEntitlements } from "./hooks/use-kaiten-entitlements.ts";
export { useFlags } from "./hooks/use-kaiten-flags.ts";
export { useAddOns } from "./hooks/use-kaiten-addons.ts";
export { useCredits } from "./hooks/use-kaiten-credits.ts";
export { useKaitenBranding, type KaitenBrandingState } from "./hooks/use-kaiten-branding.ts";
export { usePortal, useKaitenSessionClient } from "./hooks/use-portal.ts";
export { kaitenKeys } from "./hooks/query-keys.ts";
// The scope every kaitenKeys entry is prefixed with — without it the keys
// above are exported but not constructible by a host.
export { useKaitenScopeKey } from "./hooks/use-kaiten-scope-key.ts";
export type { UseKaitenMutationResult, UseKaitenQueryResult } from "./hooks/use-kaiten-query.ts";

// ---------------------------------------------------------------------------
// Control primitives — they render only what the host gives them
// ---------------------------------------------------------------------------

export {
  KaitenLoaded,
  KaitenLoading,
  KaitenFailed,
  type KaitenFailedProps,
  type KaitenFailedRenderProps,
  Show,
  type ShowProps,
} from "./components/control/control-components.tsx";
export { Gate, type GateProps, type GateState } from "./components/control/gate.tsx";
export {
  KaitenErrorBoundary,
  type KaitenErrorBoundaryProps,
} from "./components/shared/kaiten-error-boundary.tsx";

// ---------------------------------------------------------------------------
// Localization and helpers — the same rules the styled components apply, for
// a host's own UI
// ---------------------------------------------------------------------------

// The strings the provider resolved (`locale` under `localization`, over the
// English defaults). The packs themselves (`fr`, `es`, `de`) live on their own
// entry, `@kaitencloud/react/locales`, so a host bundles the languages it ships
// and no other. There is no `locales` map here on purpose: one reachable from
// the provider put all three in every bundle.
export { useLocalization } from "./localization/context.tsx";
export { formatKaitenDate, formatKaitenUsageWindowBound } from "./localization/date.ts";
export { DEFAULT_CURRENCY_CODE, formatKaitenMoney } from "./localization/money.ts";
export { pluralize } from "./localization/pluralize.ts";
export { usageWindowLabel } from "./lib/entitlement-usage-window.ts";
// Presentation helpers driven by the entitlement definition metadata (GraphQL
// read path): customer-facing visibility + unit labels.
export {
  isCustomerFacing,
  saleUnitLabel,
  toSaleUnits,
  unitLabel,
} from "./lib/entitlement-presentation.ts";
// Predicate for the API's "unlimited" sentinel (a negative numeric limit), so
// consumers can branch their own UI/logic explicitly instead of testing `< 0`.
export { isUnlimited } from "./lib/unlimited.ts";
// Which price a plan is sold at for a billing interval — the rule `PricingTable`
// and `BillingSummary` apply, for a host rendering its own plan cards.
export { resolveLicensePrice } from "./lib/license-price.ts";

// ---------------------------------------------------------------------------
// Types — the whole model, so a headless host never needs a second import
// ---------------------------------------------------------------------------

export type * from "./types.ts";
