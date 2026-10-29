# @kaitencloud/react

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
