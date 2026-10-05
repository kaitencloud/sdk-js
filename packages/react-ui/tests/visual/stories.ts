/**
 * Visual regression — curated allowlist of Storybook stories that are
 * **stable on Linux Chromium** and represent the SDK surface most likely to
 * regress visually (KaitenBranding alignment, PricingTable card layout,
 * FeatureComparison sticky column, Paywall modal chrome).
 *
 * Each entry maps a Playwright snapshot file name → a Storybook `storyId`
 * (the part after `?id=` in the Storybook URL). Story IDs are kebab-case and
 * follow Storybook's `<title>--<name>` convention.
 *
 * Adding a story:
 *   1. Open the story locally, copy the `?id=` value from the URL.
 *   2. Append it here and run `pnpm test:visual:update` to record the baseline.
 *
 * Skipping flakiness:
 *   If a baseline becomes flaky (animation, async data, font loading), prefer
 *   stabilising the story (`parameters.chromatic.disableSnapshot = true` is
 *   *not* used here; we control the list explicitly) rather than raising
 *   `maxDiffPixelRatio` for everyone.
 */
export const STORIES: Array<{ name: string; storyId: string }> = [
  // KaitenBranding — the 3 visual bugs from the initial audit landed here.
  { name: "kaiten-branding--footer", storyId: "shared-kaitenbranding--footer" },
  { name: "kaiten-branding--card", storyId: "shared-kaitenbranding--card" },
  {
    name: "kaiten-branding--inside-card-footer",
    storyId: "shared-kaitenbranding--inside-card-footer",
  },
  // PricingTable — main commercial surface.
  { name: "pricing-table--default", storyId: "elements-pricingtable--default" },
  { name: "pricing-table--four-columns", storyId: "elements-pricingtable--four-columns" },
  { name: "pricing-table--separate-layout", storyId: "elements-pricingtable--separate-layout" },
  // FeatureComparison — sticky header column.
  { name: "feature-comparison--default", storyId: "elements-featurecomparison--default" },
  // CustomerPortal — composite surface, exercises every section. (The old
  // two-columns story went away with the responsive layout refactor; Vertical
  // is the remaining layout variant.)
  { name: "customer-portal--full", storyId: "flows-customerportal--full" },
  { name: "customer-portal--vertical", storyId: "flows-customerportal--vertical" },
  // Paywall — modal chrome that previously had a11y/focus issues.
  { name: "paywall--soft-near-limit", storyId: "flows-paywall--soft-near-limit" },
  { name: "paywall--hard-over-limit", storyId: "flows-paywall--hard-over-limit" },
];
