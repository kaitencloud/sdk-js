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
  // Prices as the billing API serves them, and a plan that is not self-serve.
  { name: "pricing-table--billing-catalog", storyId: "elements-pricingtable--billing-catalog" },
  // The catalogue Kaiten serves for Acme, read by the real client: 8 plans in euros, yen
  // and dinars, a plan sold by contact and one with no default fee. The story id is
  // Storybook's: it splits the "3" of "v3" into a word of its own.
  { name: "pricing-table--billing-v3", storyId: "elements-pricingtable--billing-v-3" },
  // A publishable key used from a page its owner did not allow: an error with a retry.
  {
    name: "pricing-table--origin-not-allowed",
    storyId: "elements-pricingtable--origin-not-allowed",
  },
  // FeatureComparison — sticky header column.
  { name: "feature-comparison--default", storyId: "elements-featurecomparison--default" },
  // CustomerPortal — composite surface, exercises every section. (The old
  // two-columns story went away with the responsive layout refactor; Vertical
  // is the remaining layout variant.)
  { name: "customer-portal--full", storyId: "flows-customerportal--full" },
  { name: "customer-portal--vertical", storyId: "flows-customerportal--vertical" },
  // CheckoutSummary — what is due today, as the server says it.
  {
    name: "checkout-summary--plan-and-add-ons",
    storyId: "flows-checkoutsummary--plan-and-add-ons",
  },
  { name: "checkout-summary--with-a-voucher", storyId: "flows-checkoutsummary--with-a-voucher" },
  {
    name: "checkout-summary--total-of-the-server",
    storyId: "flows-checkoutsummary--total-of-the-server",
  },
  { name: "checkout-summary--free-trial", storyId: "flows-checkoutsummary--free-trial" },
  { name: "checkout-summary--loading", storyId: "flows-checkoutsummary--loading" },
  { name: "checkout-summary--nothing-chosen", storyId: "flows-checkoutsummary--nothing-chosen" },
  { name: "checkout-summary--over-quota", storyId: "flows-checkoutsummary--over-quota" },
  { name: "checkout-summary--provider-down", storyId: "flows-checkoutsummary--provider-down" },
  // CheckoutFlow — a checkout in every state a customer meets, from choosing to the last payment status.
  { name: "checkout-flow--default", storyId: "flows-checkoutflow--default" },
  {
    name: "checkout-flow--add-ons-and-voucher",
    storyId: "flows-checkoutflow--add-ons-and-voucher",
  },
  { name: "checkout-flow--voucher-refused", storyId: "flows-checkoutflow--voucher-refused" },
  { name: "checkout-flow--free-trial", storyId: "flows-checkoutflow--free-trial" },
  {
    name: "checkout-flow--billing-email-needed",
    storyId: "flows-checkoutflow--billing-email-needed",
  },
  { name: "checkout-flow--processing", storyId: "flows-checkoutflow--processing" },
  {
    name: "checkout-flow--saving-a-payment-method",
    storyId: "flows-checkoutflow--saving-a-payment-method",
  },
  { name: "checkout-flow--subscribed", storyId: "flows-checkoutflow--subscribed" },
  {
    name: "checkout-flow--subscribed-with-a-trial",
    storyId: "flows-checkoutflow--subscribed-with-a-trial",
  },
  { name: "checkout-flow--payment-to-confirm", storyId: "flows-checkoutflow--payment-to-confirm" },
  { name: "checkout-flow--payment-processing", storyId: "flows-checkoutflow--payment-processing" },
  { name: "checkout-flow--card-declined", storyId: "flows-checkoutflow--card-declined" },
  { name: "checkout-flow--already-subscribed", storyId: "flows-checkoutflow--already-subscribed" },
  { name: "checkout-flow--over-quota", storyId: "flows-checkoutflow--over-quota" },
  { name: "checkout-flow--provider-down", storyId: "flows-checkoutflow--provider-down" },
  // Paywall — modal chrome that previously had a11y/focus issues.
  { name: "paywall--soft-near-limit", storyId: "flows-paywall--soft-near-limit" },
  { name: "paywall--hard-over-limit", storyId: "flows-paywall--hard-over-limit" },
];
