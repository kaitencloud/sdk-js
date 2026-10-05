import { expect, test } from "vite-plus/test";
import * as Core from "@kaitencloud/react";

import * as UI from "../src/index.ts";

// The styled package is one door onto two things: its own components, and the
// core it is built on. Both promises are pinned here — every core export is on
// this root with the same identity (one provider, one context, one set of
// keys, whichever package a host imports from), and every documented component
// is real.

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

/** Reached through `@kaitencloud/react/internal` only; a host has no business with them. */
const CORE_INTERNALS = ["useKaitenDataContext", "useTrackComponent"] as const;

test("re-exports the whole core, by identity", () => {
  const core = Object.keys(Core) as Array<keyof typeof Core>;
  expect(core.length).toBeGreaterThan(40);
  for (const name of core) {
    expect((UI as Record<string, unknown>)[name], name).toBe(Core[name]);
  }
});

test("exports every styled component and the style root", () => {
  const missing = STYLED_SURFACE.filter((name) => !(name in UI));
  expect(missing).toEqual([]);
});

test("the root is exactly the core plus the styled surface", () => {
  const expected = new Set<string>([...Object.keys(Core), ...STYLED_SURFACE]);
  expect(Object.keys(UI).sort()).toEqual([...expected].sort());
});

test("leaks no core internal", () => {
  const leaked = CORE_INTERNALS.filter((name) => name in UI);
  expect(leaked).toEqual([]);
});
