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
  // CustomerPortal in a customer session: the plan in each state its subscription is in, what a
  // customer can do to it, the add-ons' stepper, the invoices and a voucher check.
  { name: "customer-portal-session--full", storyId: "flows-customer-portal-session--full" },
  {
    name: "customer-portal-session--cancel-asked",
    storyId: "flows-customer-portal-session--cancel-asked",
  },
  {
    name: "customer-portal-session--cancel-scheduled",
    storyId: "flows-customer-portal-session--cancel-scheduled",
  },
  {
    name: "customer-portal-session--closing-period",
    storyId: "flows-customer-portal-session--closing-period",
  },
  { name: "customer-portal-session--past-due", storyId: "flows-customer-portal-session--past-due" },
  { name: "customer-portal-session--trial", storyId: "flows-customer-portal-session--trial" },
  { name: "customer-portal-session--canceled", storyId: "flows-customer-portal-session--canceled" },
  {
    name: "customer-portal-session--scheduled-change",
    storyId: "flows-customer-portal-session--scheduled-change",
  },
  {
    name: "customer-portal-session--provenance",
    storyId: "flows-customer-portal-session--provenance",
  },
  {
    name: "customer-portal-session--add-on-steppers",
    storyId: "flows-customer-portal-session--add-on-steppers",
  },
  {
    name: "customer-portal-session--add-on-remove-asked",
    storyId: "flows-customer-portal-session--add-on-remove-asked",
  },
  {
    name: "customer-portal-session--add-on-closing-period",
    storyId: "flows-customer-portal-session--add-on-closing-period",
  },
  {
    name: "customer-portal-session--add-on-refused",
    storyId: "flows-customer-portal-session--add-on-refused",
  },
  { name: "customer-portal-session--invoices", storyId: "flows-customer-portal-session--invoices" },
  {
    name: "customer-portal-session--invoices-empty",
    storyId: "flows-customer-portal-session--invoices-empty",
  },
  {
    name: "customer-portal-session--voucher-valid",
    storyId: "flows-customer-portal-session--voucher-valid",
  },
  {
    name: "customer-portal-session--voucher-refused",
    storyId: "flows-customer-portal-session--voucher-refused",
  },
  {
    name: "customer-portal-session--voucher-rate-limited",
    storyId: "flows-customer-portal-session--voucher-rate-limited",
  },
  {
    name: "customer-portal-session--in-french",
    storyId: "flows-customer-portal-session--in-french",
  },
  { name: "customer-portal-session--unbound", storyId: "flows-customer-portal-session--unbound" },
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
  // PaymentMethodCard — the labels of how a customer session pays, and the way to change it.
  { name: "payment-method-card--default", storyId: "flows-paymentmethodcard--default" },
  { name: "payment-method-card--expired", storyId: "flows-paymentmethodcard--expired" },
  {
    name: "payment-method-card--last-payment-failed",
    storyId: "flows-paymentmethodcard--last-payment-failed",
  },
  {
    name: "payment-method-card--no-payment-method",
    storyId: "flows-paymentmethodcard--no-payment-method",
  },
  { name: "payment-method-card--other-brand", storyId: "flows-paymentmethodcard--other-brand" },
  { name: "payment-method-card--provider-down", storyId: "flows-paymentmethodcard--provider-down" },
  { name: "payment-method-card--in-french", storyId: "flows-paymentmethodcard--in-french" },
  // BillingSummary in a customer session — the subscription as the portal says it, in each state.
  { name: "billing-summary-session--running", storyId: "flows-billingsummary-session--running" },
  {
    name: "billing-summary-session--in-a-trial",
    storyId: "flows-billingsummary-session--in-a-trial",
  },
  {
    name: "billing-summary-session--cancellation-scheduled",
    storyId: "flows-billingsummary-session--cancellation-scheduled",
  },
  {
    name: "billing-summary-session--past-due-quarterly",
    storyId: "flows-billingsummary-session--past-due-quarterly",
  },
  { name: "billing-summary-session--over", storyId: "flows-billingsummary-session--over" },
  {
    name: "billing-summary-session--scheduled-change",
    storyId: "flows-billingsummary-session--scheduled-change",
  },
  { name: "billing-summary-session--unbound", storyId: "flows-billingsummary-session--unbound" },
  {
    name: "billing-summary-session--host-money",
    storyId: "flows-billingsummary-session--host-money",
  },
  {
    name: "billing-summary-session--in-french",
    storyId: "flows-billingsummary-session--in-french",
  },
  // Paywall in a customer session — what the subscription adds to a wall, and what it offers.
  { name: "paywall-session--running", storyId: "flows-paywall-session--running" },
  { name: "paywall-session--trial-ending", storyId: "flows-paywall-session--trial-ending" },
  { name: "paywall-session--past-due", storyId: "flows-paywall-session--past-due" },
  { name: "paywall-session--over", storyId: "flows-paywall-session--over" },
  { name: "paywall-session--over-hard", storyId: "flows-paywall-session--over-hard" },
  { name: "paywall-session--never-subscribed", storyId: "flows-paywall-session--never-subscribed" },
  { name: "paywall-session--in-french", storyId: "flows-paywall-session--in-french" },
  // The rest of the checkout and the portal: plain markup, French, dark, and the states that end a flow.
  { name: "checkout-flow--unstyled", storyId: "flows-checkoutflow--unstyled" },
  { name: "checkout-flow--french", storyId: "flows-checkoutflow--french" },
  { name: "checkout-flow--dark", storyId: "flows-checkoutflow--dark" },
  { name: "checkout-summary--unstyled", storyId: "flows-checkoutsummary--unstyled" },
  { name: "checkout-summary--french", storyId: "flows-checkoutsummary--french" },
  { name: "checkout-summary--dark", storyId: "flows-checkoutsummary--dark" },
  {
    name: "customer-portal-session--cancel-afterwards",
    storyId: "flows-customer-portal-session--cancel-afterwards",
  },
  {
    name: "customer-portal-session--invoices-paged",
    storyId: "flows-customer-portal-session--invoices-paged",
  },
  {
    name: "customer-portal-session--invoices-hidden",
    storyId: "flows-customer-portal-session--invoices-hidden",
  },
  { name: "customer-portal-session--unstyled", storyId: "flows-customer-portal-session--unstyled" },
  {
    name: "customer-portal-session--plan-card-alone",
    storyId: "flows-customer-portal-session--plan-card-alone",
  },
  {
    name: "payment-method-card--sent-to-the-provider",
    storyId: "flows-paymentmethodcard--sent-to-the-provider",
  },
  { name: "payment-method-card--not-available", storyId: "flows-paymentmethodcard--not-available" },
  { name: "payment-method-card--unstyled", storyId: "flows-paymentmethodcard--unstyled" },
  {
    name: "paywall-session--cancellation-scheduled",
    storyId: "flows-paywall-session--cancellation-scheduled",
  },
  // Paywall — modal chrome that previously had a11y/focus issues.
  { name: "paywall--soft-near-limit", storyId: "flows-paywall--soft-near-limit" },
  { name: "paywall--hard-over-limit", storyId: "flows-paywall--hard-over-limit" },
];
