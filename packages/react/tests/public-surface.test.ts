import { readFileSync } from "node:fs";

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
  "InvoiceList",
  "VoucherEntry",
  "Paywall",
  "PlanBadge",
  "UpgradeButton",
  "CheckoutSummary",
  "CheckoutFlow",
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
  "QuotaExceededError",
  "RateLimitedError",
  "BoundaryPendingError",
  "ProviderUnavailableError",
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
  "formatKaitenPrice",
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

// STABILITY.md is what a host reads to know which names it may build on. A name
// that the package exports and the document never mentions is a name nobody decided
// on, and one a release would freeze by accident.
// From the package, or from the workspace root, whichever a runner starts in.
const STABILITY = ["packages/react/STABILITY.md", "STABILITY.md"]
  .map((path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  })
  .find((text) => text !== undefined)!;

test("STABILITY.md names every export of the root", () => {
  const unnamed = Object.keys(Core).filter((name) => !new RegExp(`\\b${name}\\b`).test(STABILITY));
  expect(unnamed).toEqual([]);
});
