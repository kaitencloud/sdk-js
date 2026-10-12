import { expect, test } from "vite-plus/test";

import * as Kaiten from "../src/index.ts";

// Guard against the README / STABILITY.md drifting from the real public surface
// (they once documented `useKaiten*` hooks and `<LicenseActivation>` that did not
// exist / were removed). Every identifier the docs promise must be a real export,
// and every removed identifier must stay gone.

const DOCUMENTED_EXPORTS = [
  // Provider & client
  "KaitenProvider",
  "KaitenScopeProvider",
  "KaitenClient",
  "KaitenErrorBoundary",
  // Headless hooks (short, unprefixed names — STABILITY.md "blessed path")
  "useEntitlementCheck",
  "usePaywallTrigger",
  "useLicensingSnapshot",
  "useReportUsage",
  "useFeatureFlag",
  "useFeatureFlags",
  "useLicense",
  "useInstance",
  "useEntitlement",
  "useUsage",
  "usePlans",
  "useCustomer",
  "useEntitlements",
  "useFlags",
  "useAddOns",
  "useCredits",
  "useUpgradeOptions",
  "useKaitenBranding",
  "useLocalization",
  // Control primitives
  "Show",
  "Gate",
  "useKaitenAvailable",
  "KaitenLoaded",
  "KaitenLoading",
  "KaitenFailed",
  // Formatting utilities
  "formatKaitenMoney",
  "formatKaitenDate",
  "formatKaitenUsageWindowBound",
  "pluralize",
  // Entitlement presentation helpers
  "isCustomerFacing",
  "unitLabel",
  // The usage-window rule
  "isPeriodicEntitlement",
  "getUsageScope",
  "resolveUsageScope",
  "usageWindowLabel",
  "saleUnitLabel",
  "toSaleUnits",
  "isUnlimited",
  "resolveLicensePrice",
] as const;

// Identifiers that were removed and must NOT come back without a docs update.
const REMOVED_EXPORTS = [
  // Moved to `@kaitencloud/react-ui` with every styled component: the core
  // renders no element and ships no stylesheet.
  "KaitenStyleRoot",
  "useKaitenPortalContainer",
  "themes",
  "KaitenBranding",
  "PricingTable",
  "CustomerPortal",
  "Paywall",
  "PlanBadge",
  // Moved to `@kaitencloud/react/locales`, one export per language: a map here
  // was reachable from the provider and put every pack in every bundle.
  "locales",
  "LicenseActivation",
  "useGate",
  "useKaitenCustomer",
  "useKaitenEntitlements",
  "useKaitenPlans",
  "useKaitenFlags",
  "useKaitenAddOns",
  "useKaitenCredits",
  // The generated API namespace is the client's: a host that wants the raw
  // operations imports `KaitenApi` from `@kaitencloud/client`, which tracks the
  // contract, rather than through a package that would then freeze it.
  "KaitenApi",
] as const;

test("every documented public identifier is exported from the package root", () => {
  const missing = DOCUMENTED_EXPORTS.filter((name) => !(name in Kaiten));
  expect(missing).toEqual([]);
});

test("removed identifiers are not exported", () => {
  const present = REMOVED_EXPORTS.filter((name) => name in Kaiten);
  expect(present).toEqual([]);
});
