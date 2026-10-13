# @kaitencloud/react-ui

## 1.0.0

First public release, on npm under the Apache License 2.0. These are Kaiten's styled React
components, built on `@kaitencloud/react`, the headless core, which this package depends on and
re-exports: an app that draws with Kaiten's components imports everything from here.

### What is in it

- **Licensing and pricing.** `PricingTable` (annual toggle, add-ons, a "Contact us" link for a
  plan that cannot be bought alone), `FeatureComparison`, `FeatureCatalog`,
  `PlanBadge`, `UpgradeButton`, `EntitlementStatusBar` and `Paywall`, which reads both
  entitlements and feature flags and renders its hard mode as a native modal dialog.
- **The customer portal.** `CustomerPortal`, composed of `CurrentPlan`, `IncludedFeatures`,
  `UsageMeters`, `AddOns`, `FlagsSummary`, `InvoiceList`, `VoucherEntry` and `PaymentMethodCard`,
  each usable alone. Under a customer session it is the customer's own portal: cancel at the end
  of the period and withdraw it, an add-on stepper, the invoices to pay and to download, a
  voucher check, the payment method, and a note on each limit that says where it comes from.
- **Checkout.** `CheckoutFlow` takes a customer from a plan to a subscription: period, add-ons,
  voucher, trial and billing email; the card, on the provider's page in a popup or, when popups
  are blocked, in place of the page; and every outcome, which is paid, no payment needed,
  further action required, processing and failed, as well as the refusals a host cares about
  (already subscribed, over quota with the entitlements named, rate limited, provider
  unavailable). `CheckoutSummary` shows what is due today. The server prices every selection and
  no total is computed in the browser. A voucher code is never left in the page, an address or a
  log.
- **Summaries.** `BillingSummary`, `CurrentPlan` and `Paywall` say where a subscription stands
  (running, in its trial, canceled and ending, past due, over), as the portal says it. Billing
  status closes no wall.
- **Theming.** `KaitenStyleRoot` scopes every style under `.kaiten`, so the host app is not
  touched; `@kaitencloud/react-ui/styles.css` is the precompiled stylesheet, built on the
  `@kaitencloud/theme` tokens, in light and dark. `appearance` and the `themes.*` presets override
  the `--ktn-*` variables and keep a fill's text readable.
- **`unstyled`.** Every component renders without Kaiten's classes when you want to own the
  markup and the CSS; its `data-slot` attributes are the targeting surface.
- **Language.** English is built in, with French, German and Spanish for the billing components
  too. A host overrides one string at a time through `localization`.
- **Accessibility.** Keyboard focus lands on what replaced a control that was pressed, a control
  that waits for its answer stays focusable and says so, and every component has layout and
  accessibility checks.

### Stability

What this package re-exports from `@kaitencloud/react`, and each component's `unstyled`
rendering, follow semantic versioning from this release on. The styled components' default
rendering, `KaitenStyleRoot`, the `appearance` API and the stylesheet are experimental: their
shape may change in a minor release, so pin an exact version if you build on them.
[`STABILITY.md`](../react/STABILITY.md) lists what falls on each side.

### Requirements

- React and React DOM 18 or later, and `@kaitencloud/react` 1.0.0 or later, which comes with it.
- Node 22.12 or later, as the package declares.
- The components that read billing need the first Kaiten release with billing, as the
  [README](README.md#kaiten-version) says.
