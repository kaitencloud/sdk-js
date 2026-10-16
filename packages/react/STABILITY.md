<!--
  Maintainers: every name below must match a real export. On every breaking
  release (any rename/removal in either package's src/index.ts), diff this
  document against those exports before publishing. `tests/public-surface.test.ts`
  here and `tests/public-api.test.ts` in react-ui pin them.
-->

# Stability & versioning — `@kaitencloud/react` and `@kaitencloud/react-ui`

> **Status: `1.x`, not on npm yet.** Both packages are published with Kaiten
> billing, at 1.0.0, and the guarantees below hold from that release on. The
> _stable_ surface follows semantic versioning: a breaking change to it needs a
> major release. The surface marked _experimental_ has **no stability
> guarantee**: it may change in a minor release. Pin an exact version if you
> build on it, and read the changelog before upgrading.

This document defines what is stable, what is experimental, and how we version —
so you can build on the parts least likely to move. It covers both React
packages: `@kaitencloud/react`, the headless core, and `@kaitencloud/react-ui`,
the styled components built on it. **The split is the boundary**: everything in
the core is on the blessed path below, except the names listed as experimental, and
everything the UI package adds is experimental, except each component's `unstyled`
rendering. The two version independently, and the UI package depends on the core with a
caret range, so upgrading it never forks the provider.

## Versioning policy

- **The _stable_ surface:** standard semver. Patch = fixes; minor = features;
  a breaking change requires a major release, with a migration note in the
  changelog.
- **The _experimental_ surface:** a minor release may change its shape, and the
  changelog says so. Each item graduates to stable (and gains that guarantee) or
  is removed.
- **`@experimental` JSDoc tag:** anything tagged `@experimental` may change shape
  or be removed in a minor release. Your editor strikes it through.

## The blessed path (most stable)

Build on these first — they are the lowest-churn surface and the intended
integration points:

- **The `@kaitencloud/react` package** — it exports this blessed surface
  (provider, hooks, control primitives, helpers), the experimental names listed
  below, and no styled component, so a host on the stable path also gets
  the smallest bundle;
  `scripts/check-bundle-size.mjs` holds it there. `@kaitencloud/react-ui`
  re-exports every one of these names, by identity, so mixing the two imports in
  one app still yields one provider and one context.
- **Headless hooks** — they return data/decisions, you render:
  `useEntitlementCheck`, `usePaywallTrigger`, `useLicensingSnapshot`,
  `useReportUsage`, `useFeatureFlag` / `useFeatureFlags`, `useLicense`,
  `useInstance`, `useEntitlement`, `useUsage` / `useUsageGroup`, `usePlans`,
  `useCustomer`, `useEntitlements`, `useFlags`, `useAddOns`, `useCredits`,
  `useUpgradeOptions`, `useKaitenAvailable`, `useKaitenBranding`,
  `useLocalization`.
- **Provider & client** — `KaitenProvider` in its `authenticated` and `static`
  modes, `KaitenScopeProvider`, `KaitenClient`, the error types (`KaitenError`,
  `KaitenNetworkError`, `TransactionIdReusedError`, `InvalidTransactionIdError`,
  `QuotaExceededError`, `RateLimitedError`, `BoundaryPendingError`,
  `ProviderUnavailableError`, `KaitenThrownError`), and the type guards
  (`isEvaluationSuccess` / `isEvaluationFailure`). A usage report's
  `transactionId` travels in the `Idempotency-Key` header, and the client sends
  such a report again only once it has seen a key echoed (see the client's
  `STABILITY.md`).
- **`unstyled` mode** of every component — you bring the markup/styles, the SDK
  brings the logic. The DOM contract (`data-slot="…"`) is the targeting surface.
- **Headless control primitives** — `Gate` (render-prop gating; `useEntitlementCheck`
  is the hook equivalent), `Show`, `KaitenLoaded`/`KaitenLoading`/`KaitenFailed`.
  The gates decide on the entitlements, as the server does. The end of a licence
  (`LicenseTerm`, `snapshot.licenseTerm`) is information for a screen to show, and
  closes no gate: billing never moves `endLicenseDate`, so a gate that read it would
  lock out a customer whose subscription renewed. Their reading of usage is the core's
  own and stays as it is: `status` is `near_limit` from 80% of the entitled value and
  `over_limit` from the highest usage the API accepts, and `percentageUsed` is a share
  of the entitled value. The styled components of `@kaitencloud/react-ui` do not read
  `status` to colour a quota: they classify usage as the Kaiten console does (see its
  README).
- **Formatting and presentation utilities** — `formatKaitenMoney`,
  `formatKaitenDate`, `formatKaitenUsageWindowBound`, `pluralize`,
  `isCustomerFacing`, `unitLabel`, `saleUnitLabel`, `toSaleUnits`, `isUnlimited`,
  `resolveLicensePrice`. `formatKaitenMoney` and the `formatMoney` of a
  localization take an integer of minor units, or an exact decimal string for a
  price below one minor unit ("0.0002"): a `formatMoney` a host writes must accept
  both. `KaitenLocalization.price` is a required section of a language pack, so a
  pack built whole needs its six strings.
- **The usage-window rule** — `isPeriodicEntitlement`, `getUsageScope`,
  `resolveUsageScope`, `usageWindowLabel`. An entitlement business rule, not a
  rendering detail: both window bounds present means a periodic counter, absent
  means lifetime, and neither answer is available when nobody read them.

## Subpath exports

- `@kaitencloud/react/locales` (one pack per language) and `@kaitencloud/react/types` hold the
  stability of what they carry: a type of the blessed path is stable, and one that describes an
  experimental surface, such as the words of a checkout, is experimental with it.
- `@kaitencloud/react/billing` is experimental, as the hooks it holds are
  ([below](#experimental-until-kaiten-billing-ships)).
- `@kaitencloud/react/internal` is for `@kaitencloud/react-ui` and carries no stability
  promise: it may change in any release.

## Experimental until Kaiten billing ships

These read the routes Kaiten billing adds, which no released Kaiten server
serves yet (the README says which release they need). They are written against the API
contract that billing publishes and tested against answers Kaiten's own code produced,
and they may change, in a minor release, as billing ships:

- **`mode="public"`** — the public catalog, `GET /public/catalog`, read with a
  publishable key.
- **`mode="customer-session"`** — `CustomerSessionKaitenProviderConfig`, its
  `sessionClient`, `initialData.portal`, the hooks that read it (`usePortal`,
  `useKaitenSessionClient`), and a customer session as the
  `authenticatedConfig` of `KaitenScopeProvider`. What every other hook
  answers under this mode — a snapshot built from the portal, with no customer,
  instance, licence or flags, and with the bound instance's `currentPlan` and
  `subscription` — is part of it.
- **The billing hooks** of `@kaitencloud/react/billing`, an entry of its own that the root
  does not reach for: `useCheckout`, `useCheckoutPreview`, `useInvoices`,
  `useInvoiceSettlement`, `useCancelSubscription`, `useReactivateSubscription`,
  `useSetAddonQuantity`, `useBillingPortal`, `usePaymentMethodSession`,
  `useValidateVoucher` and `isPlausibleEmail`, the rule they apply to a billing email, with
  the types of their options and results. They need `mode="customer-session"`. Every amount
  they carry is the server's, from a checkout's `dryRun` or an invoice, and none is added up.
  The `problem` of a checkout and that of `useSetAddonQuantity` are closed lists for now, and
  may grow.
- **`CheckoutSummary` and `CheckoutFlow`** (`@kaitencloud/react-ui`), a checkout drawn:
  what is due today and a customer's whole checkout. They are `useCheckoutPreview` and
  `useCheckout`, with markup. The amount due is the server's, from a checkout's `dryRun`
  (`dueToday`), and the SDK never adds prices up. `CheckoutSummary` took the items of the
  host's own total before; it takes the selection to price, or a preview that something else
  holds, and its props changed with it.
  `CheckoutItem`, the type of those items, left the exports with them. A pricing table also draws a
  plan's boolean or configuration grant as an included feature (a check and its name) where it
  drew the word "boolean", and omits a boolean that is off.
- **The words of a checkout**, `KaitenLocalization.checkoutFlow` (typed `KaitenCheckoutWords`).
  An optional section: the provider's English defaults do not carry it, the English lives in
  `@kaitencloud/react-ui`, and a language pack of `@kaitencloud/react/locales` carries its
  own whole. A host's override of one string is merged over them. The section's earlier keys
  (`title`, `description`, `plan`, `addOn`, `total`, `proceedToPayment` and the interval
  names) are gone: they were the words of the previous `CheckoutSummary`, and the keys of the
  present one replace them.
- **The billing sections of `CustomerPortal`** (`@kaitencloud/react-ui`), under `mode="customer-session"`:
  `InvoiceList` (the customer's invoices, newest first as the API serves them, a link to pay an
  open one and to the PDF of those that have one), `VoucherEntry` (a field that only checks a code,
  which a checkout redeems), the add-on stepper of `AddOns`, the cancel and reactivate controls
  of `CurrentPlan` (its `manage` prop, which `CustomerPortal` sets) and the note on a limit that
  says where it comes from. Their amounts are the server's and nothing in them is added up; a
  voucher code is sent in the body of the check and kept nowhere. `InvoiceList` and `VoucherEntry`
  are elements of `CustomerPortal` under a customer session and nothing under any other mode.
- **`PaymentMethodCard`** (`@kaitencloud/react-ui`), under `mode="customer-session"`: the payment
  method the customer's invoices are charged to, as the labels the provider gave ("Visa •••• 4242",
  its expiry, whether it is expired or its last payment failed, never a number), and to add one,
  replace it on the provider's hosted page, or manage it in the provider's own billing portal.
  It is an element of `CustomerPortal` under a session, and it is not there at all (no element,
  no empty card) when the portal says the provider cannot capture a payment method.
- **The subscription in `CurrentPlan`, `BillingSummary` and `Paywall`** (`@kaitencloud/react-ui`),
  under `mode="customer-session"`: the status the portal gives (running, in its trial, canceled and
  ending with its period, past due, over, or no subscription to speak of), when it renews or ends,
  a plan change that is scheduled, and, in `BillingSummary`, the price of the subscription and the
  labels of the payment method (what the host passes in `billing` wins). Billing status closes no
  wall: a `Paywall` says where the subscription stands (`data-subscription`, and a sentence when it
  explains the wall) and offers to "Subscribe" instead of "Upgrade" to a customer who can buy a plan
  by themselves (`capabilities.checkout`). None of them reads the end date of a licence, which billing
  never moves.
- **The words of the portal and of a subscription**, `KaitenLocalization.portalBilling` and
  `KaitenLocalization.subscription` (typed `KaitenPortalBillingWords` and
  `KaitenSubscriptionWords`), and `KaitenLocalization.paymentMethodCard`
  (`KaitenPaymentMethodWords`). Optional, like the checkout's: the English is in
  `@kaitencloud/react-ui`, and a language pack carries each section whole.
- **The billing half of `PricingTable`** (`@kaitencloud/react-ui`): the price
  passed to `onSelectPlan`, and the "Contact us" link of a plan that is not
  `selfServe`.
- **`formatKaitenPrice`** — a price as a line of text: "€49.00/month", "€135.00
  every 3 months", "€2.00 per 1M tokens". The wording of the periods and of the
  units is `localization.price`, in each language pack.

## Experimental surface

Usable today, but **shape may change** in a minor release (treat as `@experimental`):

- **What `@kaitencloud/react-ui` adds.** Its styled components (default,
  non-`unstyled` rendering): `CustomerPortal` (and its sections
  `CurrentPlan`/`IncludedFeatures`/`UsageMeters`/`AddOns`/`FlagsSummary`/`InvoiceList`/`VoucherEntry`/`PaymentMethodCard`),
  `PricingTable`, `FeatureComparison`, `CheckoutSummary`, `CheckoutFlow`, `Paywall`, `PlanBadge`,
  `UpgradeButton`, `EntitlementStatusBar`, `FeatureCatalog`, `BillingSummary`,
  `KaitenBranding`. The names it re-exports from the core keep the core's
  guarantee.
- **Theming API** — `KaitenStyleRoot`, `useKaitenPortalContainer`, `appearance`
  (`KaitenAppearance`, the `themes.*` presets, the `--ktn-*` variable contract)
  and the prebuilt `kaiten.css`.
- **Telemetry** — `KaitenTelemetryOptions` / `KaitenTelemetryEvent` and the event map.
- **Events, cache keys and small exports** — `emitKaitenEvent` and
  `kaitenComponentEvents` (the `kaiten:*` DOM events), `kaitenKeys` and
  `useKaitenScopeKey` (the cache keys a host can `mutate()`), `KaitenErrorBoundary`
  and `DEFAULT_CURRENCY_CODE`. They are exported and not yet classified: treat them
  as experimental until a release lists them above.

## How the surface grows

The types this package re-exports from `@kaitencloud/client` keep that package's
guarantees, set out in its [STABILITY.md](../client/STABILITY.md):

- the types the SDK returns may gain **optional** members in a minor release;
- `KaitenClientLike`, the interface you implement for the `client` prop, keeps
  its five methods for all of 1.x. A new capability is an interface of its own,
  as `KaitenSessionClientLike` is for the `sessionClient` of a customer session;
- **closed** unions stay as they are (`BillingInterval`,
  `ResolvedEntitlement["source"]`, `LicenseTerm["status"]`…), and **open**
  unions, written `"FLAT_FEE" | "USAGE_BASED" | (string & {})`, may gain a value
  in a minor release. Handle a value you do not know rather than assume the list
  is exhaustive.

This package's own types follow the same rules. The results of its hooks
(`EntitlementCheckResult`, `PaywallTriggerResult`, `GateState`,
`UseKaitenQueryResult`…) may gain optional members. The `reason` of
`PaywallTriggerResult` and `GateState` is `PaywallReason`, an open union: a later
billing adds reasons, so a switch over it needs a default, and `GateState.blocked`
already says whether a wall is up. `KaitenProviderMode` and the provider's props
type what you pass in, so a minor release may add a mode, as it may add an optional
prop.

## Practical guidance

- Prefer **`@kaitencloud/react` alone**, or hooks + `unstyled`, for production
  integrations you can't easily re-touch — they're the contract we intend to keep.
- Use the **styled components** to ship fast; expect to revisit them across minor
  releases.
- Watch the changelog; breaking changes to anything here are called out there.
