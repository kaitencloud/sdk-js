# @kaitencloud/react-ui

## 2.0.0

### Major Changes

- [#20](https://github.com/kaitencloud/sdk-js/pull/20) [`16006f7`](https://github.com/kaitencloud/sdk-js/commit/16006f71e23820a1be1cd6a8d5f39b7451600b5a) Thanks [@tomflenner](https://github.com/tomflenner)! - BREAKING: enforce OpenFeature SDK + official OFREP providers for all flag decisions. Remove direct client evaluation methods/facades, generated client and server OFREP operations, evaluation helpers and React evaluation hooks. Licensing reads no longer evaluate flags and return an empty flag display list. Remove flag conditions from `Show` and `flagKey` from `Gate`, `usePaywallTrigger` and `Paywall`; entitlement gating and management CRUD are unchanged.

  Use `@openfeature/server-sdk` with `@openfeature/ofrep-provider` on your backend. Browser/React integrations use the official Web/React SDK and `@openfeature/ofrep-web-provider` only with an authorized, browser-safe OFREP endpoint; never expose a Kaiten `ksh_` secret. See `MIGRATION-2.md` for removed symbols, context/authentication and failure handling. Already-published 1.x versions and immutable consumer fixtures are not rewritten; there are no compatibility aliases.

  Sync the published OpenAPI contract and regenerate the management clients: add voucher deletion and its webhook payload, plus the assigned license term state on instance detail reads. Direct OFREP evaluation operations remain excluded from both SDKs.

### Minor Changes

- [#46](https://github.com/kaitencloud/sdk-js/pull/46) [`12902b8`](https://github.com/kaitencloud/sdk-js/commit/12902b8f355a2a5ac9a750fe8e5925a61fc03389) Thanks [@Lleios](https://github.com/Lleios)! - The stylesheet no longer restyles a host's own markup placed inside a style root.

  Only the preflight was limited to the elements the SDK renders. The utilities applied to anything under `.kaiten`, so an app that runs Tailwind or shadcn, and has the same class names (`bg-primary`, `rounded-lg`, `text-sm`, `p-4`), saw its own elements take Kaiten's tokens under a `KaitenStyleRoot` and behind a `Paywall`. The root also declared Tailwind's theme variables, a text colour and a `code` font, which that markup inherited.

  - Every utility applies only to elements the SDK rendered, as the preflight does. Its specificity is unchanged, so what the README says about which side wins on Kaiten's elements still holds.
  - The style root declares the `--ktn-*` tokens, `position: relative` and `width: 100%`, and nothing else. Tailwind's theme variables (`--spacing`, `--text-*`, …) are inlined into the SDK's utilities, so a host's own utilities read the host's theme inside a root.
  - The SDK's text colour is declared on the outermost element of each component, not on the root. Host text inside a root keeps the colour of the host's page. A component set in a section that has its own text colour no longer inherits it: it reads `--ktn-foreground`. Give such a section a style root of its own, or set `--ktn-foreground` on it.
  - The rule that gave every `<code>` under a root the SDK's mono font is gone. The SDK's own `code` keeps that font.
  - An SDK component placed in the content of a `Paywall` keeps its reset and its styling behind the wall.
  - `<KaitenBranding unstyled />` rendered by itself is reset like the other components: its link loses the browser's underline.

  When upgrading, look at your own markup inside a style root. An element that had taken Kaiten's colours, radii or sizes goes back to yours, and one that relied on the SDK's stylesheet for a class your own CSS does not define loses that styling.

  The `ktn-host` class is no longer rendered: the root of a `Paywall` carries `ktn-shell`. The style root no longer carries the `w-full` class.

- [#41](https://github.com/kaitencloud/sdk-js/pull/41) [`b78a901`](https://github.com/kaitencloud/sdk-js/commit/b78a901bf3d010a059afd806532f02fd28096d3c) Thanks [@Lleios](https://github.com/Lleios)! - A paywall says why it is up when the usage could not be read or there is too little quota left, a usage nobody could read is no longer drawn as zero, and a wall that comes up no longer clears the content under it.

  - `@kaitencloud/react`: `usePaywallTrigger`, and so `Gate` and `Paywall`, gave the reason `not_entitled`, and offered to change plan, in two cases where the plan does include the feature.
    - A quota whose usage could not be read (`usageUnavailable`) now gives the reason `usage_unavailable`, with `metered: false` and no `recommendedAction`. It follows `onError`, as a failed read does: `"block"`, the default, keeps the wall up; `"allow"` lets the customer through. It used to block whatever `onError` said.
    - A quota with some left, but less than the `min` asked for (95 of 100 with `min: 10`), now gives the reason `insufficient_quota`, whose `recommendedAction` falls back to adding quota. A quota with nothing left is still `over_limit`.
    - `PaywallReason` names both, and the trigger's result carries `remaining`, what the quota has left. A `switch` over the reason with a default, as the open union asks, needs no change.
    - The language packs (English, French, German, Spanish) gain `paywall.usageUnavailable`, `paywall.usageUnavailableDescription`, `paywall.insufficientQuota` and `paywall.insufficientQuotaDescription`.
  - `@kaitencloud/react-ui`:
    - `Paywall` titles the two new reasons ("Usage unavailable", "Not enough quota") and says what they mean: that the usage could not be read, with no figures and no upgrade button; and how much the action needs against how much is left ("This needs 10, and 5 are left."), with "Add quota". A feature the plan does not include says so (`paywall.flagDisabledDescription`) instead of "You've used 0 of 1 allowed".
    - `UsageMeters` and `EntitlementStatusBar` say "Usage unavailable" for a quota whose usage could not be read, as `BillingSummary` does, instead of "0 / limit", a 0% badge and an empty bar. Unstyled too.
    - `Paywall` in `mode="hard"` keeps a refusal behind the wall, no longer the warning before the limit: at `near_limit` it shows the inline wall with its dismiss button, as `soft` does, where it used to lock the content from 80% with no way out. Its modal is for `over_limit`, `insufficient_quota` and `not_entitled`, and its upgrade button closes it before calling `onUpgrade`, so a checkout opened from there is not left under it.
    - A wall coming up or down no longer unmounts the content it covers: the content stays in the same elements, which are only made `inert`, so a form being filled when a read crosses the threshold keeps what was typed. With no wall up, those two elements take no part in the layout (`display: contents`). And the wall takes the focus only when it was inside the content it covers; a focus elsewhere on the page stays where it is.

### Patch Changes

- [#25](https://github.com/kaitencloud/sdk-js/pull/25) [`76107a8`](https://github.com/kaitencloud/sdk-js/commit/76107a82f6987b7f5b2db40c70aafa7985e41110) Thanks [@fuzcap](https://github.com/fuzcap)! - An anonymous checkout names the customer after the buyer's company.

  - `@kaitencloud/client`: `startCheckout` takes an optional `customerName`, at most 255 characters, which the completion names the new customer and its instance after. Kaiten trims it, and names both after the `email` when it is left out. `getCheckoutSession` and `confirmCheckout` read it back as `customerName`, `null` when the start gave none. The mock client does the same.
  - `@kaitencloud/server`: the generated types carry `customerName` on the checkout session draft and on both session reads.
  - `@kaitencloud/react`: `useAnonymousCheckout` sends `selection.company`, trimmed, as the `customerName`; with no company, `selection.name`; with neither, nothing. It used to keep both in the tab and send neither, so every customer was named after an e-mail address.
  - `@kaitencloud/react-ui`: `collectCompany` and `collectName` say that the company, else the name, names the customer.

- [#40](https://github.com/kaitencloud/sdk-js/pull/40) [`a516be1`](https://github.com/kaitencloud/sdk-js/commit/a516be113664be258b826269744bb2193f399ca1) Thanks [@Lleios](https://github.com/Lleios)! - Five components no longer show something that is not so.

  - `FeatureComparison` leaves out draft and archived licences, as `PricingTable` does. Under `mode="authenticated"` `usePlans()` returns every licence of the organization, whatever its state, and the table had a column for each. Both components now read the catalogue's `published` flag the same way: only a plan marked `published: false` is left out, so host-supplied plans that do not say stay visible.
  - `FeatureCatalog` names on each feature only the plans that grant it. A plan that listed the entitlement switched off or at `0` ("SSO: false", "Seats: 0") was named under "Available on" all the same. A plan with the unlimited sentinel, or one that lists the entitlement with no value, still counts as granting it. A feature that no plan grants keeps its card, without the "Available on" line. The catalogue also leaves out draft and archived licences.
  - `PlanBadge` names the plan under `mode="customer-session"`. It read the licence alone, which a session never has, and rendered nothing. It now falls back to the plan the portal names, as `BillingSummary` and `CurrentPlan` do, with the neutral variant and no `data-plan-type`, since a session has no licence type.
  - `AddOns`, outside a customer session, renders its "Add" and "Remove" buttons only when `onManageAddon` is passed. Without it a click changed nothing and still emitted `kaiten:addon-added`. With it, a removal no longer emits `kaiten:addon-added`; the event is sent for an addition only, and a host that needs to react to a removal does so in `onManageAddon`.
  - `PricingTable` links "Contact us" to a plan's `selfServeCtaUrl` only when it is an http(s) address, absolute or relative, as `AnonymousCheckoutFlow` already did. A `javascript:` or `data:` address in a host-supplied catalogue (`plans`, `mode="static"`) gave a working link; the card now offers no link, as for a plan with no address. Both components share the check, which now reads a relative address on the server as the browser does on an http(s) page: `AnonymousCheckoutFlow` rendered on the server no longer drops a relative "Contact us" link that the browser then shows.

- [#52](https://github.com/kaitencloud/sdk-js/pull/52) [`167e7c2`](https://github.com/kaitencloud/sdk-js/commit/167e7c2dd7c561f921469d0b469ad86d608e6a13) Thanks [@Lleios](https://github.com/Lleios)! - Documentation that contradicted the code now says what it does. No behaviour changes.

  - `@kaitencloud/react`: `useKaitenBranding` and the provider's `hideBranding` no longer call the branding rule server-enforced. Kaiten reports whether the vendor's plan lets the "Powered by Kaiten" mark be removed, on the public catalogue and a customer session's portal, and the SDK applies that answer in the browser. The `branding.bypass_attempted` event goes to the provider's telemetry `transport` when the host set one, never to Kaiten. The `min` option of `usePaywallTrigger` loses a leftover placeholder in its comment.
  - `@kaitencloud/react-ui`: the README's add-ons panel schedules a lower quantity or a removal for the renewal, as the portal's `pendingQuantity` says and the panel shows, where it said such a change took effect at once. It no longer promises a note on billing a higher quantity for the current period, which the portal does not render, since its payload does not carry the add-on family's policy. `VoucherEntry` is described as checking a code and applying it on a live subscription, where one sentence said it only checks one.

- [#49](https://github.com/kaitencloud/sdk-js/pull/49) [`80139ae`](https://github.com/kaitencloud/sdk-js/commit/80139ae2d5c55142f4f8ef427e3a97049ebf3efc) Thanks [@Lleios](https://github.com/Lleios)! - The READMEs and the doc comments name the Kaiten release the billing features need: 26.11.3. Kaiten serves billing's routes from 26.10.7 on, and reads the publishable key as `Kaiten-Publishable-Key`, the name this version sends, from 26.11.3 on. They used to say that no Kaiten release carried billing yet.

- [#38](https://github.com/kaitencloud/sdk-js/pull/38) [`02ba817`](https://github.com/kaitencloud/sdk-js/commit/02ba817a73b2c01837212224d7a6d7b34ca47406) Thanks [@Lleios](https://github.com/Lleios)! - Prices in 16 currencies show the amount the API bills, no longer 100 times more (1,000 times for the Iraqi dinar).

  - `@kaitencloud/react`: `formatKaitenMoney`, and so the `formatMoney` of every built-in language pack, read a currency's minor-unit exponent from the runtime's `Intl` data. For AFN, ALL, COP, HUF, IDR, IRR, KPW, LAK, LBP, MGA, MMK, PKR, SOS, SYP and YER that data counts no minor unit where the API counts two, and for IQD none where the API counts three: `formatKaitenMoney(4900, "HUF")` wrote `HUF 4,900` for 49 forints. The exponent is now the API's, the one `majorUnitAmount` of `@kaitencloud/client` reads. `Intl` still gives the symbol, the grouping and the decimals shown, and its exponent only for a currency the API does not know. In those 16 currencies, which the locale writes in whole major units, an amount with a fraction of one shows that fraction: 4950 fillér are `HUF 49.5`, not `HUF 50`. Nothing changes for any other currency.
  - `@kaitencloud/react-ui`: the pricing table, the checkout flows, the trial banner, the billing summary and the customer portal follow, through the `formatMoney` of the localization.

  A `formatMoney` a host writes takes the same minor units: read the exponent with `majorUnitAmount`, not from `Intl`.

  The bundle-size budgets of the scenarios that format a price are raised by what this adds, the API's table of minor units, about 0.95 KB gzip. A bundle that imports `formatKaitenMoney` or a language pack without the provider gains about 1.2 KB more, the client's GraphQL documents, which a host with the provider ships already.

- [#51](https://github.com/kaitencloud/sdk-js/pull/51) [`6771945`](https://github.com/kaitencloud/sdk-js/commit/677194513aacda47343e5fab977e3c8c4252b961) Thanks [@Lleios](https://github.com/Lleios)! - The development-only warnings are silent in a production bundle.

  They were guarded by `typeof process !== "undefined" && process.env.NODE_ENV === "production"`. A bundler replaces `process.env.NODE_ENV` only as a whole expression and leaves the `typeof process` check, which is false in a browser, so the guard never saw production: a Vite, webpack or esbuild build printed them to its users' consoles. Each package now reads `process.env.NODE_ENV` through one helper that a bundler can replace and that counts as development where there is no `process` and nothing replaced it.

  - `@kaitencloud/client`: the warning that a customer with several instances, and no `instanceId`, had one chosen for it.
  - `@kaitencloud/react`: the warnings of a redundant nested `KaitenProvider`, of a `hideBranding` the license does not allow, of an entitlement slug that matched nothing, and of a paywall under a provider with no customer. That last one read `process.env.NODE_ENV` with no guard at all, and threw a `ReferenceError` from an effect in a browser that loaded the package without a bundler.
  - `@kaitencloud/react-ui`: the warnings of a missing `KaitenStyleRoot`, of a `PricingTable` plan with no price, and of a hard `Paywall` with no `onUpgrade`.

  The warnings' text stays in a production bundle: minifiers do not inline the helper, so they cannot drop the code behind it. It is never reached there.

  The `react-ui · Paywall + KaitenProvider + KaitenStyleRoot` bundle budget rises from 52 250 to 52 650 bytes gzip (measured at 52 329, up from 52 220): the warning of a paywall under a provider with no customer used to be dropped by bundlers, and stays now that its guard is safe without one.

- [#31](https://github.com/kaitencloud/sdk-js/pull/31) [`56c8387`](https://github.com/kaitencloud/sdk-js/commit/56c8387f5d44a772ea78f42737ea2f83b1791d1c) Thanks [@Lleios](https://github.com/Lleios)! - A read that fails no longer shuts the gates of a customer whose data was read, and is made again on its own.

  - `@kaitencloud/react`: one failed read used to be the last a tab made. SWR skips a polling tick while its cache holds an error and leaves it to its error retry to clear it, and the provider had that retry off, so the catalog, the snapshot and the portal were read again only on `refetch`, after a usage report or on a reload. Until then `Show`, `Gate` and `KaitenLoaded` answered as if nothing had ever been read, with the data of the last read still held.
    - A failed read is made again: after 5 seconds for an outage (no answer, a timeout, a 5xx, 408 or 429), then 10, 20, up to every 5 minutes; after 5 minutes for a refusal (any other 4xx), the pace of a poll; never sooner than a `Retry-After`. It is one read per provider and one wait at a time, each wait moved by up to a fifth. A hidden tab and an offline browser wait, and read at once when they are back. A provider that mounts on a read that had already failed, with `initialData` for instance, reads it again too.
    - While the data of an earlier read is held, `Show`, `Gate`, `usePaywallTrigger` and `KaitenLoaded` keep deciding on it, and `KaitenFailed` does not render. The failure is on `error` beside the decision: `GateState.error` and `PaywallTriggerResult.error` can be set without the reason `error`.
    - `staleIfErrorMs`, a new prop of `KaitenProvider` and `KaitenScopeProvider`, says for how long. Once reads have failed for longer, an hour by default, the gates apply `onError` and `KaitenFailed` renders, as when nothing was ever read. `0` applies it at the first failed read, which is what the gates did before; `Infinity` never does.
    - A read the provider makes on its own after a failure does not show as loading: `isLoading` stays `false`, so a `Gate` closed for want of data does not open for the length of each retry. `refetch` and the `retry` of `KaitenFailed` show as loading, as before.
  - `@kaitencloud/react-ui`: `Paywall` follows, through `usePaywallTrigger`. It keeps the wall the last read decided, and its `onError` applies when there is no data to decide on.

  The bundle-size budgets of the scenarios that hold the provider are raised by what this adds, about 0.7 KB gzip.

- Updated dependencies [[`76107a8`](https://github.com/kaitencloud/sdk-js/commit/76107a82f6987b7f5b2db40c70aafa7985e41110), [`167e7c2`](https://github.com/kaitencloud/sdk-js/commit/167e7c2dd7c561f921469d0b469ad86d608e6a13), [`95d9b85`](https://github.com/kaitencloud/sdk-js/commit/95d9b8568449054aa5c84d665dc18c8e1419c13b), [`16006f7`](https://github.com/kaitencloud/sdk-js/commit/16006f71e23820a1be1cd6a8d5f39b7451600b5a), [`6771945`](https://github.com/kaitencloud/sdk-js/commit/677194513aacda47343e5fab977e3c8c4252b961), [`80139ae`](https://github.com/kaitencloud/sdk-js/commit/80139ae2d5c55142f4f8ef427e3a97049ebf3efc), [`02ba817`](https://github.com/kaitencloud/sdk-js/commit/02ba817a73b2c01837212224d7a6d7b34ca47406), [`b78a901`](https://github.com/kaitencloud/sdk-js/commit/b78a901bf3d010a059afd806532f02fd28096d3c), [`6771945`](https://github.com/kaitencloud/sdk-js/commit/677194513aacda47343e5fab977e3c8c4252b961), [`56c8387`](https://github.com/kaitencloud/sdk-js/commit/56c8387f5d44a772ea78f42737ea2f83b1791d1c), [`8f78a9f`](https://github.com/kaitencloud/sdk-js/commit/8f78a9f33a1856df6c0e22b86670ec6bef86119e)]:
  - @kaitencloud/react@2.0.0

## 1.0.1

### Patch Changes

- [#18](https://github.com/kaitencloud/sdk-js/pull/18) [`6da91b7`](https://github.com/kaitencloud/sdk-js/commit/6da91b7d3f341052a976caf5755d1009a0d81e81) Thanks [@Lleios](https://github.com/Lleios)! - Publish from the Release workflow, with npm provenance, which the 1.0.0 published by hand lacks. The code does not change.
- Updated dependencies [[`6da91b7`](https://github.com/kaitencloud/sdk-js/commit/6da91b7d3f341052a976caf5755d1009a0d81e81)]:
  - @kaitencloud/react@1.0.1

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
