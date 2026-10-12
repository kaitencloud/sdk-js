import { expect, test } from "vite-plus/test";

import * as Core from "../src/index.ts";

// The core is a boundary, and a boundary is only worth what it excludes.
// `scripts/check-bundle-size.mjs` proves the built output carries no UI
// dependency; this pins the surface itself, so a styled component cannot slip
// onto the root through a barrel edit and drag its chunk back in.

/** Lives in `@kaitencloud/react-ui`. None of it may appear here. */
const STYLED_SURFACE = [
  "KaitenStyleRoot",
  "useKaitenPortalContainer",
  "themes",
  "KaitenBranding",
  "PricingTable",
  "FeatureComparison",
  "FeatureCatalog",
  "CustomerPortal",
  "CurrentPlan",
  "IncludedFeatures",
  "UsageMeters",
  "AddOns",
  "FlagsSummary",
  "Paywall",
  "PlanBadge",
  "UpgradeButton",
  "CheckoutSummary",
  "EntitlementStatusBar",
  "BillingSummary",
] as const;

const CORE_SURFACE = [
  // Provider
  "KaitenProvider",
  "KaitenScopeProvider",
  "useKaitenAvailable",
  // Client, errors, events
  "KaitenClient",
  "KaitenError",
  "KaitenNetworkError",
  "TransactionIdReusedError",
  "InvalidTransactionIdError",
  "isEvaluationFailure",
  "isEvaluationSuccess",
  "getUsageScope",
  "isPeriodicEntitlement",
  "resolveUsageScope",
  "emitKaitenEvent",
  "kaitenComponentEvents",
  // Hooks
  "useLicense",
  "useInstance",
  "useEntitlement",
  "useUsage",
  "useUsageGroup",
  "useFeatureFlag",
  "useFeatureFlags",
  "useEntitlementCheck",
  "usePaywallTrigger",
  "useReportUsage",
  "useUpgradeOptions",
  "useLicensingSnapshot",
  "usePlans",
  "useCustomer",
  "useEntitlements",
  "useFlags",
  "useAddOns",
  "useCredits",
  "useKaitenBranding",
  "usePortal",
  "useKaitenSessionClient",
  "kaitenKeys",
  "useKaitenScopeKey",
  // Control primitives
  "KaitenLoaded",
  "KaitenLoading",
  "KaitenFailed",
  "Show",
  "Gate",
  "KaitenErrorBoundary",
  // Localization and helpers
  "useLocalization",
  "formatKaitenDate",
  "formatKaitenUsageWindowBound",
  "DEFAULT_CURRENCY_CODE",
  "formatKaitenMoney",
  "pluralize",
  "usageWindowLabel",
  "isCustomerFacing",
  "saleUnitLabel",
  "toSaleUnits",
  "unitLabel",
  "isUnlimited",
  "resolveLicensePrice",
] as const;

test("the root exports exactly the core surface", () => {
  expect(Object.keys(Core).sort()).toEqual([...CORE_SURFACE].sort());
});

test("the root exports no styled component", () => {
  const leaked = STYLED_SURFACE.filter((name) => name in Core);
  expect(leaked).toEqual([]);
});
