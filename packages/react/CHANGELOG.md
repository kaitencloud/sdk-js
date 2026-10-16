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
- **Control primitives.** `Gate`, `Show`, `KaitenLoaded`, `KaitenLoading`, `KaitenFailed` and
  `KaitenErrorBoundary`. A gate decides on the entitlements, as the server does, and the end of
  a licence is information for a screen to show, not a reason to close it.
- **Billing hooks**, in their own entry, `@kaitencloud/react/billing`, so a host that offers
  neither a checkout nor a portal bundles none of them: `useCheckout` and `useCheckoutPreview`,
  `useInvoices`, `useCancelSubscription` and `useReactivateSubscription`, `useSetAddonQuantity`,
  `usePaymentMethodSession`, `useBillingPortal` and `useValidateVoucher`. Every amount they
  carry is the server's, from a checkout's `dryRun` or an invoice; none is added up in the
  browser.
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

### Stability

The blessed path, which is the provider, the hooks, the control primitives, the helpers and the
error classes, follows semantic versioning from this release on. So does the billing surface,
meaning `mode="public"`, `mode="customer-session"` and the hooks of `@kaitencloud/react/billing`,
which needs the first Kaiten release with billing. The refusals the billing hooks name, a
checkout's steps and the states of a voucher code may gain a member in a minor release, by the
rules `STABILITY.md` sets out. The telemetry, `formatKaitenPrice` and the words of the styled
components are experimental, and may change in a minor release. Within a major, nothing that a
published `@kaitencloud/react-ui` imports is removed or retyped, from any entry.
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
