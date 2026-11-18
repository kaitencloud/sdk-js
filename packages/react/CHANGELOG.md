# @kaitencloud/react

## 2.0.0

### Major Changes

- [#20](https://github.com/kaitencloud/sdk-js/pull/20) [`16006f7`](https://github.com/kaitencloud/sdk-js/commit/16006f71e23820a1be1cd6a8d5f39b7451600b5a) Thanks [@tomflenner](https://github.com/tomflenner)! - BREAKING: enforce OpenFeature SDK + official OFREP providers for all flag decisions. Remove direct client evaluation methods/facades, generated client and server OFREP operations, evaluation helpers and React evaluation hooks. Licensing reads no longer evaluate flags and return an empty flag display list. Remove flag conditions from `Show` and `flagKey` from `Gate`, `usePaywallTrigger` and `Paywall`; entitlement gating and management CRUD are unchanged.

  Use `@openfeature/server-sdk` with `@openfeature/ofrep-provider` on your backend. Browser/React integrations use the official Web/React SDK and `@openfeature/ofrep-web-provider` only with an authorized, browser-safe OFREP endpoint; never expose a Kaiten `ksh_` secret. See `MIGRATION-2.md` for removed symbols, context/authentication and failure handling. Already-published 1.x versions and immutable consumer fixtures are not rewritten; there are no compatibility aliases.

  Sync the published OpenAPI contract and regenerate the management clients: add voucher deletion and its webhook payload, plus the assigned license term state on instance detail reads. Direct OFREP evaluation operations remain excluded from both SDKs.

- [#42](https://github.com/kaitencloud/sdk-js/pull/42) [`8f78a9f`](https://github.com/kaitencloud/sdk-js/commit/8f78a9f33a1856df6c0e22b86670ec6bef86119e) Thanks [@Lleios](https://github.com/Lleios)! - BREAKING: a usage report's `value` is typed as a number, the only value the API counts.

  - `@kaitencloud/client`: `ReportUsageInput.value` is a `NumberEntitlementValue` (`{ type: "number", value }`) instead of any `EntitlementValue`. The API has always refused a boolean or configuration value with 422 `InvalidValueType`, so such a report could only fail: it now fails to compile instead of failing on the wire. `behavior` stays required, as the API refuses a report without one with 422 `InvalidBehavior`. Nothing changes on the wire: a report is still sent as the caller wrote it, and a value that arrives untyped, from JavaScript or through a cast, is still refused by the API with its own error. AI credits are reported through `ai.reserve` and `ai.commit`, as before.
  - `@kaitencloud/react`: `useReportUsage` takes the same `ReportUsageInput`, so its `input` is narrowed the same way.

  A host that reported a boolean or configuration value removes that call: it never counted anything.

### Minor Changes

- [#25](https://github.com/kaitencloud/sdk-js/pull/25) [`76107a8`](https://github.com/kaitencloud/sdk-js/commit/76107a82f6987b7f5b2db40c70aafa7985e41110) Thanks [@fuzcap](https://github.com/fuzcap)! - An anonymous checkout names the customer after the buyer's company.

  - `@kaitencloud/client`: `startCheckout` takes an optional `customerName`, at most 255 characters, which the completion names the new customer and its instance after. Kaiten trims it, and names both after the `email` when it is left out. `getCheckoutSession` and `confirmCheckout` read it back as `customerName`, `null` when the start gave none. The mock client does the same.
  - `@kaitencloud/server`: the generated types carry `customerName` on the checkout session draft and on both session reads.
  - `@kaitencloud/react`: `useAnonymousCheckout` sends `selection.company`, trimmed, as the `customerName`; with no company, `selection.name`; with neither, nothing. It used to keep both in the tab and send neither, so every customer was named after an e-mail address.
  - `@kaitencloud/react-ui`: `collectCompany` and `collectName` say that the company, else the name, names the customer.

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

- [#31](https://github.com/kaitencloud/sdk-js/pull/31) [`56c8387`](https://github.com/kaitencloud/sdk-js/commit/56c8387f5d44a772ea78f42737ea2f83b1791d1c) Thanks [@Lleios](https://github.com/Lleios)! - A read that fails no longer shuts the gates of a customer whose data was read, and is made again on its own.

  - `@kaitencloud/react`: one failed read used to be the last a tab made. SWR skips a polling tick while its cache holds an error and leaves it to its error retry to clear it, and the provider had that retry off, so the catalog, the snapshot and the portal were read again only on `refetch`, after a usage report or on a reload. Until then `Show`, `Gate` and `KaitenLoaded` answered as if nothing had ever been read, with the data of the last read still held.
    - A failed read is made again: after 5 seconds for an outage (no answer, a timeout, a 5xx, 408 or 429), then 10, 20, up to every 5 minutes; after 5 minutes for a refusal (any other 4xx), the pace of a poll; never sooner than a `Retry-After`. It is one read per provider and one wait at a time, each wait moved by up to a fifth. A hidden tab and an offline browser wait, and read at once when they are back. A provider that mounts on a read that had already failed, with `initialData` for instance, reads it again too.
    - While the data of an earlier read is held, `Show`, `Gate`, `usePaywallTrigger` and `KaitenLoaded` keep deciding on it, and `KaitenFailed` does not render. The failure is on `error` beside the decision: `GateState.error` and `PaywallTriggerResult.error` can be set without the reason `error`.
    - `staleIfErrorMs`, a new prop of `KaitenProvider` and `KaitenScopeProvider`, says for how long. Once reads have failed for longer, an hour by default, the gates apply `onError` and `KaitenFailed` renders, as when nothing was ever read. `0` applies it at the first failed read, which is what the gates did before; `Infinity` never does.
    - A read the provider makes on its own after a failure does not show as loading: `isLoading` stays `false`, so a `Gate` closed for want of data does not open for the length of each retry. `refetch` and the `retry` of `KaitenFailed` show as loading, as before.
  - `@kaitencloud/react-ui`: `Paywall` follows, through `usePaywallTrigger`. It keeps the wall the last read decided, and its `onError` applies when there is no data to decide on.

  The bundle-size budgets of the scenarios that hold the provider are raised by what this adds, about 0.7 KB gzip.

### Patch Changes

- [#52](https://github.com/kaitencloud/sdk-js/pull/52) [`167e7c2`](https://github.com/kaitencloud/sdk-js/commit/167e7c2dd7c561f921469d0b469ad86d608e6a13) Thanks [@Lleios](https://github.com/Lleios)! - Documentation that contradicted the code now says what it does. No behaviour changes.

  - `@kaitencloud/react`: `useKaitenBranding` and the provider's `hideBranding` no longer call the branding rule server-enforced. Kaiten reports whether the vendor's plan lets the "Powered by Kaiten" mark be removed, on the public catalogue and a customer session's portal, and the SDK applies that answer in the browser. The `branding.bypass_attempted` event goes to the provider's telemetry `transport` when the host set one, never to Kaiten. The `min` option of `usePaywallTrigger` loses a leftover placeholder in its comment.
  - `@kaitencloud/react-ui`: the README's add-ons panel schedules a lower quantity or a removal for the renewal, as the portal's `pendingQuantity` says and the panel shows, where it said such a change took effect at once. It no longer promises a note on billing a higher quantity for the current period, which the portal does not render, since its payload does not carry the add-on family's policy. `VoucherEntry` is described as checking a code and applying it on a live subscription, where one sentence said it only checks one.

- [#37](https://github.com/kaitencloud/sdk-js/pull/37) [`95d9b85`](https://github.com/kaitencloud/sdk-js/commit/95d9b8568449054aa5c84d665dc18c8e1419c13b) Thanks [@Lleios](https://github.com/Lleios)! - A licensing snapshot read with a server credential holds every entitlement the instance has, not only those its licence grants.

  - `@kaitencloud/client`: `getLicensingSnapshot` walked the licence's grants and hung the usage read off them. The usage read answers one row per entitlement the instance has, and an entitlement an attached add-on or the instance's exception grants on its own was dropped: with `seats` from the licence and `sso` from an add-on, the snapshot held `seats` alone.
    - The snapshot is now that effective set. Such an entitlement takes its name, type and presentation from another licence of the catalog that grants it, else its slug names it and its value types it (`NUMBER`, `BOOLEAN`, `CONFIG`). Its value, limit and allowance are its usage row's. A licence grant the read does not return is still there, with nothing consumed, and a failed usage read still leaves the licence's grants alone, with their usage unknown.
    - Each entitlement's layer is read from its row instead of being written as `license`: `effectiveSource` is the row's `source` (`license`, `addon` or `exception`), `source` keeps its 1.0 union (`exception` reads as `license`, as on the portal), and `provenance` is the row's.
    - The snapshot's GraphQL query selects `source`, `provenance` and `limitCapExceededOveragePercent` on each usage row, as the REST read already carried them. On that path an entitlement is now measured against the allowance of the instance's limit, an add-on's included, instead of the licence grant's. A Kaiten release that predates billing does not serve these fields, and against it the snapshot is composed over REST, without the icons and units only the GraphQL catalog carries, and reports the GraphQL failure through `onDegraded`.
    - `normalizeResolvedEntitlements` resolves the same set, and takes a new `definitions` option: grant rows of any licence, read for the name, type and presentation of an entitlement the instance's licence does not grant. A usage row that names no layer, as a server that predates billing answers, adds nothing, so a fixture built without `source` resolves as before.
    - `EntitlementUsage.source` names `exception` in its open union.
  - `@kaitencloud/react`: under `mode="authenticated"`, `Show`, `Gate`, `usePaywallTrigger` and the entitlement hooks see a feature an add-on or an exception grants, which they used to refuse, and a `Gate`'s `source` and `provenance` are those of its usage row.

  The bundle-size budgets of the scenarios that build a `KaitenClient` are raised by what this adds, 0.3 to 0.4 KB gzip.

- [#51](https://github.com/kaitencloud/sdk-js/pull/51) [`6771945`](https://github.com/kaitencloud/sdk-js/commit/677194513aacda47343e5fab977e3c8c4252b961) Thanks [@Lleios](https://github.com/Lleios)! - A callback of the host that throws no longer changes what it was told about.

  - `useCheckout`: an `onSubscribed` that threw reported the subscribed checkout as failed, and sent the customer back to choosing a plan they had just bought. The checkout now stays `subscribed`.
  - `useAnonymousCheckout`: an `onStarted` that threw left the visitor choosing, with the error of the page's callback as the checkout's. An `onSubscribed` that threw was raised from a React effect, so it reached the nearest error boundary and took the completed checkout off the page. The checkout now stays started, and completed.
  - `useReportUsage`, `useCancelSubscription`, `useReactivateSubscription`, `useSetAddonQuantity` and `useValidateVoucher`: an `onSuccess` that threw turned a call that succeeded into a rejection with the host's error, and an `onError` that threw rejected with the host's error in place of the API's. The call now resolves, or rejects with its own error.

  What these callbacks throw is reported with `console.error` and goes no further. So is what `useRedeemVoucher`'s `onApplied` throws, which left the voucher applied but was dropped without a word.

  The `core · everything` bundle budget rises from 33 850 to 34 150 bytes gzip (measured at 33 869, up from 33 799).

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

- Updated dependencies [[`b81cae0`](https://github.com/kaitencloud/sdk-js/commit/b81cae0bcf9ead11ab7edc3b2f8f48613b721bfb), [`b81cae0`](https://github.com/kaitencloud/sdk-js/commit/b81cae0bcf9ead11ab7edc3b2f8f48613b721bfb), [`b81cae0`](https://github.com/kaitencloud/sdk-js/commit/b81cae0bcf9ead11ab7edc3b2f8f48613b721bfb), [`56d7157`](https://github.com/kaitencloud/sdk-js/commit/56d715752b48b06239f59cfbf85e9b6cb0d536bb), [`b81cae0`](https://github.com/kaitencloud/sdk-js/commit/b81cae0bcf9ead11ab7edc3b2f8f48613b721bfb), [`b81cae0`](https://github.com/kaitencloud/sdk-js/commit/b81cae0bcf9ead11ab7edc3b2f8f48613b721bfb), [`76107a8`](https://github.com/kaitencloud/sdk-js/commit/76107a82f6987b7f5b2db40c70aafa7985e41110), [`1ffd653`](https://github.com/kaitencloud/sdk-js/commit/1ffd6531c66e8db3be520b2dad1f4d94716b0f3f), [`95d9b85`](https://github.com/kaitencloud/sdk-js/commit/95d9b8568449054aa5c84d665dc18c8e1419c13b), [`16006f7`](https://github.com/kaitencloud/sdk-js/commit/16006f71e23820a1be1cd6a8d5f39b7451600b5a), [`83e0b3d`](https://github.com/kaitencloud/sdk-js/commit/83e0b3d4da8be8cf2876738763a317669ef5efba), [`80139ae`](https://github.com/kaitencloud/sdk-js/commit/80139ae2d5c55142f4f8ef427e3a97049ebf3efc), [`6771945`](https://github.com/kaitencloud/sdk-js/commit/677194513aacda47343e5fab977e3c8c4252b961), [`6771945`](https://github.com/kaitencloud/sdk-js/commit/677194513aacda47343e5fab977e3c8c4252b961), [`ec868d8`](https://github.com/kaitencloud/sdk-js/commit/ec868d8cb7e245d580a21762123f15f4a4351465), [`8f78a9f`](https://github.com/kaitencloud/sdk-js/commit/8f78a9f33a1856df6c0e22b86670ec6bef86119e), [`8f78a9f`](https://github.com/kaitencloud/sdk-js/commit/8f78a9f33a1856df6c0e22b86670ec6bef86119e)]:
  - @kaitencloud/client@2.0.0

## 1.0.1

### Patch Changes

- [#18](https://github.com/kaitencloud/sdk-js/pull/18) [`6da91b7`](https://github.com/kaitencloud/sdk-js/commit/6da91b7d3f341052a976caf5755d1009a0d81e81) Thanks [@Lleios](https://github.com/Lleios)! - Publish from the Release workflow, with npm provenance, which the 1.0.0 published by hand lacks. The code does not change.

## 1.0.0

First public release, on npm under the Apache License 2.0. This is the headless core of
Kaiten's React SDK: it renders no markup of its own and ships no stylesheet. The styled
components are in `@kaitencloud/react-ui`, which depends on this package and re-exports it.

### What is in it

- **The provider.** `KaitenProvider` in four modes: `authenticated`, a customer's licensing
  snapshot read with a token; `static`, a catalogue the host already holds, with no request;
  `public`, the live catalogue, read with a publishable key; and `customer-session`, one
  customer's portal and billing, read with a customer session your backend mints.
  `KaitenScopeProvider` switches between them when the user signs in.
- **Hooks.** The selectors (`usePlans`, `useCustomer`, `useEntitlements`, `useUsage`,
  `useFlags`, `useAddOns`, `useCredits`, `useLicense`, `useInstance`…), `useEntitlementCheck`
  and `usePaywallTrigger` for gating, `useReportUsage`, `useFeatureFlag`, and `useUpgradeOptions`.
  Under a customer session the state of an entitlement says where its limit comes from
  (`source`, `provenance`).
- **Flags, as an instance.** `useFeatureFlag` and `useFeatureFlags`, given a context, evaluate
  live over OFREP and add the instance the provider is bound to as `kaiten: { instanceSlug }`
  under `mode="authenticated"` with an `instanceId`, so that a flag granted on that instance
  applies. The context you wrote wins, and `instanceId` must be the instance's slug. A
  `customer-session` names no instance: OFREP has no route for a session's `kst_` yet.
- **Control primitives.** `Gate`, `Show`, `KaitenLoaded`, `KaitenLoading`, `KaitenFailed` and
  `KaitenErrorBoundary`. A gate decides on the entitlements, as the server does, and the end of
  a licence is information for a screen to show, not a reason to close it.
- **Billing hooks**, in their own entry, `@kaitencloud/react/billing`, so a host that offers
  neither a checkout nor a portal bundles none of them: `useCheckout` and `useCheckoutPreview`,
  `useInvoices`, `useCancelSubscription` and `useReactivateSubscription`, `useSetAddonQuantity`,
  `usePaymentMethodSession`, `useBillingPortal`, `useValidateVoucher` and `useRedeemVoucher`, which
  previews what a code gives on a subscription that is live and then redeems it. Every amount they
  carry is the server's, from a checkout's `dryRun` or an invoice; none is added up in the
  browser.
- **The anonymous checkout**, `useAnonymousCheckout` in the same entry, for a visitor with no
  account, under a `public` or `static` provider given an `anonymousCheckoutClient`. It draws the
  Cloudflare Turnstile check in the element you give it (the script is loaded once, the first time
  a widget is drawn, and only by this entry), holds one token for each start, starts the checkout,
  reviews what the server says is due, sends the visitor to the payment provider's page and
  sees the checkout through when they are back, and names every refusal. It is available only
  when the catalogue says the publishable key may start an anonymous checkout. It never starts a
  second checkout for a page that came back without the session's token. `previewQuote()` is its
  `dryRun`, and `problem` is the way to branch on a refusal: the classes behind it
  (`TurnstileFailedError`, `TurnstileUnavailableError`, `CheckoutSessionClosedError`,
  `DueTodayChangedError`, `CheckoutTokenMissingError`) are `@kaitencloud/client`'s, reach `error`
  as thrown, and are not re-exported here. A start the API would refuse for its shape is found
  out before a Turnstile token is spent. It names what `useCheckout` names: the price chosen is
  `selection.licensePriceId` (the client sends it to the API as `priceId`) and the page is told
  the instance is subscribed by `onSubscribed`. The hook keeps the visitor's name and company for the page, across the payment
  provider's page, and hands them to `onStarted` and `onSubscribed`; it never sends either to Kaiten.
- **Typed errors.** `QuotaExceededError`, `RateLimitedError`, `BoundaryPendingError`,
  `ProviderUnavailableError` and `TransactionIdReusedError` reach a hook's `error`, `onError`
  and rejections as the classes the client threw, with their fields.
- **Money, prices and language.** `formatKaitenMoney` writes an amount in the number of
  decimals its currency has (euros, yen, Kuwaiti dinars), and a price below one minor unit
  exactly. `formatKaitenPrice` writes a catalogue price as a line: "€49.00/month", "€135.00
  every 3 months", "€2.00 per 1M tokens". English is the default, and
  `@kaitencloud/react/locales` has French, Spanish and German packs.
- **Subpaths.** `@kaitencloud/react/types`, plain types, and `@kaitencloud/react/locales`, plain
  data a Server Component can import. `@kaitencloud/react/internal` is for
  `@kaitencloud/react-ui`, not for a host, and only grows within a major.

### Public billing details

Use the customer portal's branding capability in its licensing snapshot, falling back to the public catalogue only when the portal omits it. An explicit `removable: false` on the portal takes precedence over a catalogue that allows removal.

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

The blessed path, which is the provider, the hooks, the control primitives, the helpers and the
error classes, follows semantic versioning from this release on. So does the billing surface,
meaning `mode="public"`, `mode="customer-session"` and the hooks of `@kaitencloud/react/billing`,
which needs the first Kaiten release with billing. The refusals the billing hooks name, a
checkout's steps, the way a checkout opened the provider's page, and the states of a voucher
code, of a payment being waited on, of a payment-method page and of the Turnstile widget may gain a member in a minor
release, by the rules `STABILITY.md` sets out.
The telemetry, `formatKaitenPrice` and the words of the styled components are experimental, and
may change in a minor release, except in what a published `@kaitencloud/react-ui` imports:
within a major, nothing it imports is removed or retyped, from any entry.
[`STABILITY.md`](STABILITY.md) lists both sides, for this package and for
`@kaitencloud/react-ui`.

### Requirements

- React and React DOM 18 or later. The package is a client module (`"use client"`), except
  `@kaitencloud/react/locales`.
- Node 22.12 or later, as the package declares.
- `@kaitencloud/client` 1.2.0 or later, which the package depends on: the customer-session
  calls and the typed errors are in the client.
- The billing modes need the first Kaiten release with billing, as the
  [README](README.md#kaiten-version) says. `static` and `authenticated` need nothing beyond
  what Kaiten serves today.
