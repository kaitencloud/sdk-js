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
  of the period and withdraw it (a trial, or a checkout that waits for its first payment, is
  cancelled at once, with nothing charged, and says so), an add-on stepper, the invoices to pay and to download, a
  voucher check, the payment method, and a note on each limit that says where it comes from.
- **Checkout.** `CheckoutFlow` takes a customer from a plan to a subscription: period, add-ons,
  voucher, trial and billing email; the card, on the provider's page in a popup or, when popups
  are blocked, in place of the page; and every outcome, which is paid, no payment needed,
  further action required, processing and failed, with a plan that waits for its first payment
  said to start once that is confirmed (also to a customer who comes back to the flow before it
  is, with the invoice to pay), as well as the refusals a host cares about
  (already subscribed, over quota with the entitlements named, rate limited, provider
  unavailable). `CheckoutSummary` shows what is due today. The server prices every selection and
  no total is computed in the browser. A voucher code is never left in the page, an address or a
  log.
- **Anonymous checkout.** `AnonymousCheckoutFlow` sells a plan to a visitor with no account: the
  billing period, an email (and a company and a name, if the page asks), the Turnstile security check, what the
  server says is due, a free plan started with one button, the payment provider's page and the way
  back from it, the payment, and what happens next (an email to check, or a page of the host's).
  It draws nothing unless the catalogue says the publishable key may start one, and every refusal
  has words in English, French, Spanish and German. It is a component of its own rather than a mode
  of `CheckoutFlow`, which is a customer's. `collectCompany` and `collectName` each take `false`,
  `"optional"` or `"required"` (`true` is `"required"`); an optional field says so in its label, and
  the name field carries a hint when a company is asked for beside it.
- **A code on a live subscription.** `VoucherEntry` shows what a code gives, with a dry run,
  before the customer applies it to a subscription that is in its trial, active or past due; it
  lists the redemptions in force; a subscription still waiting for its first payment has no field;
  and with no subscription a code is only checked, as before.
- **The trial.** `TrialBanner` shows the trial a customer session's instance is in: a countdown
  to its end, what the end charges and to which card (the server's figure, or that nothing will
  be charged when the server says so, and nothing about the charge when it names none), a prompt
  to add a card when there is none, "Add a card" through the provider's page and back, and
  "Cancel", which asks first and says the trial ends at once with nothing charged, then calls
  `onTrialEnded`.
  It draws nothing outside a trial, and has words in English, French, Spanish and German.
- **Summaries.** `BillingSummary`, `CurrentPlan` and `Paywall` say where a subscription stands
  (running, in its trial, canceled and ending, past due, over, or waiting for the first payment of
  its checkout, whose plan starts once the payment is confirmed), as the portal says it. Billing
  status closes no wall.
- **Usage, as the Kaiten console reads it.** `UsageMeters`, `EntitlementStatusBar`,
  `BillingSummary`, `IncludedFeatures` and the bar of a `Paywall` measure a quota against the
  most its grant lets through, allowance included, and say healthy, watch, near limit, in
  allowance, limit reached or over limit. A bar with an allowance draws it as a hatched band
  and marks the granted value. The headless core's `status` is unchanged.
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

### Public billing details

Show the public billing members the client maps in the customer portal, in English, French, Spanish and German, styled and unstyled:

- Add-on decreases and removals show the scheduled boundary while retaining the quantity held. The panel starts at the scheduled quantity and can replace it or cancel it by sending the held quantity. Older payloads without `pendingQuantity` get no scheduled-decrease promise.
- INCOMPLETE shows the current plan and the actual payable ACTIVATION invoice's hosted page, using the existing settlement polling. No expiry date or purchased-plan price is inferred.
- An ended subscription names the current plan and offers the host's subscription action when checkout is allowed. No fallback reason or free-plan status is guessed.
- Provenance uses `effectiveSource`, and its click/keyboard disclosure shows exception windows, supplied before/after figures and BOOLEAN/CONFIG boost values. Unlimited is not attributed to a voucher without evidence. Catalogue add-on grants show their supplied combination and overage allowance.
- Voucher checks retain and show composite discounts, BOOLEAN/CONFIG values, decimal modifiers and flag variants. A check does not redeem the code.
- Price timing is shown only when supplied; checkout choices follow `displayOrder` when all choices supply it, otherwise retaining the period order. Branding follows the portal's capability and the host's request.

Failed-payment wording no longer assumes that the bank declined a card: the public payment outcome does not expose that cause. Metered add-on rates are quoted separately per sale unit, without multiplying them by add-on quantity or summing them with the flat fee.

All new localization members are optional, with the UI's English fallback, so older custom language packs keep compiling. The public snapshot still has no pending selection, incomplete deadline, cancellation/fallback reason or family `increaseBilling` policy: the portal does not invent those or show a true-up policy.

`useInvoiceSettlement` gains optional `activationSince`: an INCOMPLETE portal uses its current period start to exclude an older, already paid ACTIVATION invoice while the new one is not listed yet. Without the option, existing callers behave as before.
An ACTIVATION becoming VOID also refreshes the actual portal, without declaring payment or inferring an expiry/fallback reason.

Measured after a dependency-order build: the French pack is 7,128 gzip bytes (previous budget 7,050), CustomerPortal with its provider/style root 67,266 (65,550), and react-ui's full import 114,586 (112,550). These three budgets become 7,500, 67,500 and 114,850 respectively, for the added customer-facing copy and public billing rendering/polling. Every other budget and the headless/unstyled dependency checks are retained.

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
