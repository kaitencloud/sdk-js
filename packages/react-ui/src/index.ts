// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

"use client";

/**
 * `@kaitencloud/react-ui` — the styled components, on the headless core.
 *
 * Everything here draws: the prebuilt components, the `KaitenStyleRoot` that
 * scopes their stylesheet and tokens, the theme presets and the `appearance`
 * types. The provider, the hooks and the control primitives are
 * `@kaitencloud/react`'s, re-exported below so an app that uses the components
 * imports from one place; a host that gates its own UI depends on the core alone
 * and never installs this package.
 *
 * Import the stylesheet once: `import "@kaitencloud/react-ui/styles.css"`.
 *
 * Stability (see STABILITY.md): the styled components are `@experimental` —
 * their shape may change in a minor release. Every component's `unstyled` mode
 * and the core's hooks are the blessed path.
 */

// ---------------------------------------------------------------------------
// The headless core, re-exported: one implementation, two doors
// ---------------------------------------------------------------------------

export * from "@kaitencloud/react";

// ---------------------------------------------------------------------------
// Style root, appearance
// ---------------------------------------------------------------------------

export {
  KaitenStyleRoot,
  type KaitenStyleRootProps,
  useKaitenPortalContainer,
} from "./style-root/kaiten-style-root.tsx";
export type {
  KaitenAppearance,
  KaitenIcons,
  KaitenIconComponent,
  KaitenIconProps,
  KaitenVariables,
  KaitenZIndex,
} from "./appearance/types.ts";
export { themes } from "./appearance/themes.ts";

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export { KaitenBranding, type KaitenBrandingProps } from "./components/shared/kaiten-branding.tsx";
export {
  CustomerPortal,
  type CustomerPortalProps,
  type CustomerPortalElement,
  CurrentPlan,
  type CurrentPlanProps,
  IncludedFeatures,
  type IncludedFeaturesProps,
  UsageMeters,
  type UsageMetersProps,
  AddOns,
  type AddOnsProps,
  FlagsSummary,
  type FlagsSummaryProps,
  InvoiceList,
  type InvoiceListProps,
  VoucherEntry,
  type VoucherEntryProps,
} from "./components/customer-portal/customer-portal.tsx";
export {
  PaymentMethodCard,
  type PaymentMethodCardProps,
} from "./components/payment-method-card/payment-method-card.tsx";
export { Paywall, type PaywallProps } from "./components/paywall/paywall.tsx";
export { PlanBadge, type PlanBadgeProps } from "./components/plan-badge/plan-badge.tsx";
export {
  UpgradeButton,
  type UpgradeButtonProps,
} from "./components/upgrade-button/upgrade-button.tsx";
export {
  PricingTable,
  type PricingTableProps,
  type PricingPlan,
} from "./components/pricing-table/pricing-table.tsx";
export {
  FeatureComparison,
  type FeatureComparisonProps,
} from "./components/feature-comparison/feature-comparison.tsx";
export {
  CheckoutSummary,
  type CheckoutSummaryProps,
  type CheckoutSummarySelection,
} from "./components/checkout-flow/checkout-summary.tsx";
export { CheckoutFlow, type CheckoutFlowProps } from "./components/checkout-flow/checkout-flow.tsx";
export {
  AnonymousCheckoutFlow,
  type AnonymousCheckoutFlowProps,
} from "./components/anonymous-checkout/anonymous-checkout-flow.tsx";
export {
  EntitlementStatusBar,
  type EntitlementStatusBarProps,
} from "./components/entitlement-status-bar/entitlement-status-bar.tsx";
export {
  FeatureCatalog,
  type FeatureCatalogProps,
  type CatalogFeature,
  type FeatureStage,
} from "./components/feature-catalog/feature-catalog.tsx";
export {
  BillingSummary,
  type BillingSummaryProps,
  type BillingSummaryBilling,
} from "./components/billing-summary/billing-summary.tsx";
