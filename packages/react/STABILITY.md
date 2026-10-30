<!--
  Maintainers: every name below must match a real export. On every breaking
  release (any rename/removal in either package's src/index.ts), diff this
  document against those exports before publishing. `tests/public-surface.test.ts`
  here and `tests/public-api.test.ts` in react-ui pin them.
-->

# Stability & versioning — `@kaitencloud/react` and `@kaitencloud/react-ui`

> **Status: `1.x`.** Both packages were first published at 1.0.0, after
> `@kaitencloud/client` 1.2.0, and the guarantees below hold from that release on. The
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
caret range, so upgrading it never forks the provider; the core keeps, within a major,
everything a published UI package uses
([Compatibility with `@kaitencloud/react-ui`](#compatibility-with-kaitencloudreact-ui)).

## Public portal billing details

The styled and unstyled portal read the same public members (§14.4–§14.6 of the billing spec).
`addon-pending-quantity` says a decrease or removal starts at `subscription.currentPeriodEnd`;
the quantity held remains unchanged until then. A missing `pendingQuantity` says nothing about
a scheduled change. The panel may replace a schedule, or cancel it by sending the quantity held.
`addon-billing-timing` and `current-plan-billing-timing` render only known, supplied price timings.
`addon-metered-price` quotes each supplied metered rate per sale unit, with its known timing,
without multiplying it by the quantity held or combining it with the flat fee.

`pending-payment` links only a payable ACTIVATION invoice with an HTTP(S) hosted URL, while the
subscription is INCOMPLETE and invoices are allowed. It uses the existing settlement hook.
An old, paid ACTIVATION is not mistaken for the pending checkout: optional `activationSince`
limits the fallback search to the subscription's current service period.
The current REST contract supplies nullable expiry/cancellation dates and system cancellation
reasons. Supplied values are shown; nulls and unknown reasons have no explanation invented for them.
No deadline, pending licence or selection is synthesized. An ended subscription names the portal's
actual current plan; a subscription action needs the host's handler and checkout capability.
No fallback reason is inferred, and a missing family `increaseBilling` policy
produces no true-up assertion.

Provenance notes open on click, tap or keyboard. They prefer `effectiveSource`, show exception
kind/value/window and the server's `afterBoosts`/`effective` figures, and never calculate access
from those figures. BOOLEAN/CONFIG boosts retain their supplied values. A note's
`data-exception-id` identifies its exception; it displays neither author nor reason.
`voucher-parts` describes supplied voucher validation parts, including flag variants and composite
parts, without redeeming the code. Missing parts have no placeholder.

The added members of `KaitenPortalBillingWords` and `KaitenSubscriptionWords` are optional;
older packs use the UI's English fallback. All four shipped locales supply them. No existing
localization member is removed or made required.

## Versioning policy

- **The _stable_ surface:** standard semver. Patch = fixes; minor = features;
  a breaking change requires a major release, with a migration note in the
  changelog.
- **The _experimental_ surface:** a minor release may change its shape, and the
  changelog says so. Each item graduates to stable (and gains that guarantee) or
  is removed. A name of the core that `@kaitencloud/react-ui` imports is the exception:
  it only grows within a major
  ([Compatibility with `@kaitencloud/react-ui`](#compatibility-with-kaitencloudreact-ui)).
- **`@experimental` JSDoc tag:** anything tagged `@experimental` may change shape
  or be removed in a minor release, with the same exception. Your editor shows the tag
  where it describes the name, and does not strike the name through: it does that for
  `@deprecated` only. This document is the list to go by.

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
  `useReportUsage`, `useFeatureFlag` / `useFeatureFlags` (given a context, they evaluate live and
  add the provider's instance to it as `kaiten.instanceSlug`, the host's own value winning; an
  `instanceId` is that instance's slug), `useLicense`,
  `useInstance`, `useEntitlement`, `useUsage` / `useUsageGroup`, `usePlans`,
  `useCustomer`, `useEntitlements`, `useFlags`, `useAddOns`, `useCredits`,
  `useUpgradeOptions`, `useKaitenAvailable`, `useKaitenBranding`,
  `useLocalization`.
- **Provider & client** — `KaitenProvider` in its four modes (`authenticated` and
  `static`, and `public` and `customer-session`, which
  [need Kaiten billing](#stable-with-kaiten-billing)), `KaitenScopeProvider`,
  `KaitenClient`, the error types (`KaitenError`,
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

## Stable, with Kaiten billing

These are on the blessed path too, with a compatibility note: **they need the first
Kaiten release with billing.** They read the routes billing adds, `/public/catalog`
and `/public/session/*`, which no released Kaiten server serves yet; a server without
billing answers them with an error, which a hook returns in `error`. The README's
[Kaiten version](README.md#kaiten-version) says what needs what. They are written
against the API contract that billing publishes and tested against answers Kaiten's
own code produced, and their shape follows semantic versioning from 1.0.0 on, like
the rest of the blessed path:

- **`mode="public"`** — the public catalog, `GET /public/catalog`, read with a
  publishable key.
- **`mode="customer-session"`** — `CustomerSessionKaitenProviderConfig`, its
  `sessionClient`, `initialData.portal`, and the hooks that read it, `usePortal` and
  `useKaitenSessionClient`. What every other hook answers under this mode — a
  snapshot built from the portal, with no customer, instance, licence or flags, and
  with the bound instance's `currentPlan` and `subscription` — is part of it.
- **The billing pair of `KaitenScopeProvider`** — a `public` or `static`
  `publicConfig`, then a customer session as its `authenticatedConfig`: what a vendor
  mounts for its own customers.
- **The billing hooks** of `@kaitencloud/react/billing`, an entry of its own that the root
  does not reach for: `useCheckout`, `useCheckoutPreview`, `useInvoices`,
  `useInvoiceSettlement`, `useCancelSubscription`, `useReactivateSubscription`,
  `useSetAddonQuantity`, `useBillingPortal`, `usePaymentMethodSession`,
  `useValidateVoucher`, `useRedeemVoucher`, `useAnonymousCheckout` and `isPlausibleEmail`, the rule they apply
  to a billing email, with the types of their options and results. All but
  `useAnonymousCheckout` need `mode="customer-session"`. Every amount they carry is the
  server's, from a checkout's `dryRun` or an invoice, and none is added up. The refusals they
  name, a checkout's steps, and the states of a voucher code, of a redemption, of a payment
  being waited on and of a payment-method page may gain a member in a minor release, by the rules of
  [Unions that grow](#unions-that-grow).
- **The anonymous checkout** — `useAnonymousCheckout`, a visitor's checkout with no account,
  and the `anonymousCheckoutClient` prop (`KaitenAnonymousCheckoutProps`) of a `public` or
  `static` provider, which takes the `KaitenAnonymousCheckoutClient` of
  `@kaitencloud/client` (or a double implementing `KaitenAnonymousCheckoutClientLike`). The
  hook is a headless checkout of its own and not a mode of `useCheckout`: it has other inputs (an
  e-mail, a Turnstile token), other steps (a session to start, review and confirm), and runs
  under another provider mode, so that neither hook's shape has to bend to the other's and a host
  that sells to visitors and one that sells to customers each ship only theirs. It is `available`
  only when the catalogue says the publishable key may start one
  (`capabilities.anonymousCheckout`, with its `turnstileSiteKey`). It starts nothing by itself:
  a start spends a Turnstile token, a `previewQuote` too, and a page that comes back without the
  session's token is `lost` and never starts another checkout, which would create a second
  customer. The Turnstile widget (`turnstile`, with `TurnstileOptions` and `TurnstileWidget`)
  is part of it: its script is loaded once, from Cloudflare, the first time a widget is
  drawn, and only by this entry. It names what `useCheckout` names, with the same words: the price
  chosen is `selection.licensePriceId` (the client sends it to the API as `priceId`) and the page is
  told the instance is subscribed by `onSubscribed`. `start()` stays its own, since it spends a
  Turnstile token and opens a session, which `submit()` does not. Like the other billing hooks it
  needs the first Kaiten release that has the anonymous checkout (`POST /public/checkout-sessions`). Its steps, its refusals
  (`AnonymousCheckoutProblem`), the way it opened the payment provider's page, how a payment is
  waited on and the state of the widget may gain a member in a minor release, by the rules of
  [Unions that grow](#unions-that-grow). The `name` and the `company` it holds are the page's own: Kaiten has no
  member for either, and neither is ever sent. Both are given to `onStarted` and to the outcome
  (`null` when none was typed or it was lost), kept in the tab across the payment provider's page. `problem` is the way to branch on a refusal: the error classes
  behind it are `@kaitencloud/client`'s and are not re-exported by this package. The widget's
  `appearance` offers `always` and `interaction-only`; Cloudflare's `execute`, which needs the page to
  ask for the check, is left out until a call exists to ask.

## Subpath exports

- `@kaitencloud/react/locales` (one pack per language) and `@kaitencloud/react/types` hold the
  stability of what they carry: a type of the blessed path is stable, and one that describes an
  experimental surface, such as the words of a checkout, is experimental with it.
- `@kaitencloud/react/billing` is stable, as the hooks it holds are
  ([above](#stable-with-kaiten-billing)). It is where they are imported from for all of 1.x,
  even if the root re-exports them one day.
- `@kaitencloud/react/internal` is for `@kaitencloud/react-ui`, not for a host: it is not
  documented, and the changelog does not follow it. It only grows within a major, as the next
  section says.

## Compatibility with `@kaitencloud/react-ui`

`@kaitencloud/react-ui` depends on `@kaitencloud/react` with a caret range, so that an app holds
one provider, and a published `@kaitencloud/react-ui` 1.x therefore runs beside every later
`@kaitencloud/react` 1.x. So, within a major, `@kaitencloud/react` neither removes nor retypes
anything that a published `@kaitencloud/react-ui` 1.x imports, from whichever of its entries:
the root, `/billing`, `/types`, `/locales` or `/internal`. That holds for
`@kaitencloud/react/internal`, which only grows within a major, and for a name of the core
listed as experimental, once `@kaitencloud/react-ui` imports it. A shape that has to change is
added beside the old one; the old one is deprecated, and leaves in 2.0.

## Experimental surface

Usable today, but **shape may change** in a minor release (treat as `@experimental`). A name
the core lists here that `@kaitencloud/react-ui` imports only grows within a major (see
[Compatibility with `@kaitencloud/react-ui`](#compatibility-with-kaitencloudreact-ui)): today
`formatKaitenPrice`, `emitKaitenEvent`, `DEFAULT_CURRENCY_CODE`, and the types of words
`KaitenCheckoutWords`, `KaitenAnonymousCheckoutWords`, `KaitenPortalBillingWords`,
`KaitenSubscriptionWords`, `KaitenPaymentMethodWords` and `KaitenTrialBannerWords`.

- **What `@kaitencloud/react-ui` adds.** Its styled components (default,
  non-`unstyled` rendering): `CustomerPortal` (and its sections
  `CurrentPlan`/`IncludedFeatures`/`UsageMeters`/`AddOns`/`FlagsSummary`/`InvoiceList`/`VoucherEntry`/`PaymentMethodCard`),
  `TrialBanner`,
  `PricingTable`, `FeatureComparison`, `CheckoutSummary`, `CheckoutFlow`, `AnonymousCheckoutFlow`,
  `Paywall`, `PlanBadge`,
  `UpgradeButton`, `EntitlementStatusBar`, `FeatureCatalog`, `BillingSummary`,
  `KaitenBranding`. The names it re-exports from the core keep the core's
  guarantee. What it draws from billing needs the first Kaiten release with billing
  as well:
  - **`CheckoutSummary` and `CheckoutFlow`** (`@kaitencloud/react-ui`), a checkout drawn:
    what is due today and a customer's whole checkout. They are `useCheckoutPreview` and
    `useCheckout`, with markup. The amount due is the server's, from a checkout's `dryRun`
    (`dueToday`), and the SDK never adds prices up. `CheckoutSummary` took the items of the
    host's own total before; it takes the selection to price, or a preview that something else
    holds, and its props changed with it.
    `CheckoutItem`, the type of those items, left the exports with them. A pricing table also draws a
    plan's boolean or configuration grant as an included feature (a check and its name) where it
    drew the word "boolean", and omits a boolean that is off.
  - **`AnonymousCheckoutFlow`** (`@kaitencloud/react-ui`), `useAnonymousCheckout` drawn, for a
    visitor with no account, under a `public` or `static` provider given an
    `anonymousCheckoutClient`: the plan and its billing period, an e-mail, the Turnstile check, what
    is due as the server computed it at the start, the payment provider's page for a payment
    method and the way back from it, the payment, and what happens next (a page the host
    gives, or a sentence that makes no promise of e-mail, which Kaiten does not send). It is a component of its own and not a `mode` of `CheckoutFlow`, which is
    a customer's and needs a session, so that a host that sells to one kind of buyer ships
    only that flow. It renders nothing unless the catalogue says the publishable key may start an
    anonymous checkout. The styled flow is the plan, the billing period, the e-mail and, if the
    page asks, the company and the name (`collectCompany` and `collectName`: off, `"optional"`
    or `"required"`, where `true` is `"required"`; the props of a styled component are
    experimental, and a value the flow does not know asks for nothing): it has no field for a voucher code or for add-ons, which a page that
    sells either builds on the hook (`setVoucherCode`, `setAddonQuantity`, and the problems
    `voucher_invalid` and `addon_refused`).
  - **The billing sections of `CustomerPortal`** (`@kaitencloud/react-ui`), under `mode="customer-session"`:
    `InvoiceList` (the customer's invoices, newest first as the API serves them, a link to pay an
    open one and to the PDF of those that have one), `VoucherEntry` (a field for a code: on a live
    subscription it shows what the code gives and applies it when the customer says so, with no
    subscription it only checks it, and a checkout redeems it), the add-ons panel that `AddOns` and `CurrentPlan` open (quantities
    set there and confirmed together, one change per add-on), the cancel and reactivate controls
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
  - **`TrialBanner`** (`@kaitencloud/react-ui`), under `mode="customer-session"`: the trial the
    bound instance is in, from the portal's `trial` block. It counts down to the end, says what the
    end charges and when (the server's figure, never computed by the component; nothing when the end
    charges nothing), the card the charge goes to or a prompt to add one, and offers "Add a card"
    and "Cancel" as the portal allows them (`capabilities.paymentMethods`, `capabilities.unsubscribe`).
    Cancelling asks first and says the trial ends at once with nothing charged. It draws nothing
    outside a trial, and nothing from a server that does not serve the block. It adds no route and
    reads nothing but the portal. `now` fixes the instant it counts from; `trial` draws a trial
    the host holds.
  - **The subscription in `CurrentPlan`, `BillingSummary` and `Paywall`** (`@kaitencloud/react-ui`),
    under `mode="customer-session"`: the status the portal gives (running, in its trial, canceled and
    ending with its period, past due, over, waiting for the first payment of its checkout, or no
    subscription to speak of), when it renews or ends,
    a plan change that is scheduled, and, in `BillingSummary`, the price of the subscription and the
    labels of the payment method (what the host passes in `billing` wins). Billing status closes no
    wall: a `Paywall` says where the subscription stands (`data-subscription`, and a sentence when it
    explains the wall) and offers to "Subscribe" instead of "Upgrade" to a customer who can buy a plan
    by themselves (`capabilities.checkout`). None of them reads the end date of a licence, which billing
    never moves.
  - **The billing half of `PricingTable`** (`@kaitencloud/react-ui`): the price
    passed to `onSelectPlan`, and the "Contact us" link of a plan that is not
    `selfServe`.
- **The words of a checkout**, `KaitenLocalization.checkoutFlow` (typed `KaitenCheckoutWords`).
  An optional section: the provider's English defaults do not carry it, the English lives in
  `@kaitencloud/react-ui`, and a language pack of `@kaitencloud/react/locales` carries its
  own whole. A host's override of one string is merged over them. The section's earlier keys
  (`title`, `description`, `plan`, `addOn`, `total`, `proceedToPayment` and the interval
  names) are gone: they were the words of the previous `CheckoutSummary`, and the keys of the
  present one replace them.
- **The words of an anonymous checkout**, `KaitenLocalization.anonymousCheckout` (typed
  `KaitenAnonymousCheckoutWords`). Optional and carried whole by every language pack, like the
  checkout's; the English is in `@kaitencloud/react-ui`. The company field's words
  (`companyLabel`, `companyHint`, `companyRequired`), the name's hint and the mark of an optional
  field (`optional`) are members of 1.0.0, the first published version: a pack written before
  them is incomplete, and the compiler says so. It says what a customer's checkout does
  not (the form, the security check, the review, the end, each refusal) and leans on
  `checkoutFlow` for the rest, so a host that overrides it overrides both.
- **The words of the portal and of a subscription**, `KaitenLocalization.portalBilling` and
  `KaitenLocalization.subscription` (typed `KaitenPortalBillingWords` and
  `KaitenSubscriptionWords`), `KaitenLocalization.paymentMethodCard`
  (`KaitenPaymentMethodWords`) and `KaitenLocalization.trialBanner` (`KaitenTrialBannerWords`). Optional, like the checkout's: the English is in
  `@kaitencloud/react-ui`, and a language pack carries each section whole.
- **Theming API** — `KaitenStyleRoot`, `useKaitenPortalContainer`, `appearance`
  (`KaitenAppearance`, the `themes.*` presets, the `--ktn-*` variable contract)
  and the prebuilt `kaiten.css`.
- **Telemetry** — `KaitenTelemetryOptions` / `KaitenTelemetryEvent` and the event map.
- **`formatKaitenPrice`** — a price as a line of text: "€49.00/month", "€135.00
  every 3 months", "€2.00 per 1M tokens". The wording of the periods and of the
  units is `localization.price`, in each language pack.
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

This package's own types follow the same rules, with the unions of the next section as
the exception. The results of its hooks
(`EntitlementCheckResult`, `PaywallTriggerResult`, `GateState`,
`UseKaitenQueryResult`…) may gain optional members. The `reason` of
`PaywallTriggerResult` and `GateState` is `PaywallReason`, an open union: a later
billing adds reasons, so a switch over it needs a default, and `GateState.blocked`
already says whether a wall is up. `KaitenProviderMode` and the provider's props
type what you pass in, so a minor release may add a mode, as it may add an optional
prop.

### Unions that grow

These unions of `@kaitencloud/react/billing` are written closed, so that a `switch` narrows
each member to its own fields, and may still gain members:

- `CheckoutProblem` and `AddonQuantityProblem`, the refusals of a checkout and of a change to
  an add-on, told apart by `kind`, and `CheckoutAddonRefusal["reason"]`, why a checkout
  refused each add-on of an `addon_refused`;
- `CheckoutStep`, where a checkout stands, and `CheckoutVoucherState`, where its voucher code
  stands;
- of redeeming a code on a live subscription (`useRedeemVoucher`): `RedeemVoucherStatus`, where the
  redemption stands, and `RedeemVoucherProblem`, the refusals it names;
- `InvoiceSettlement["status"]`, what waiting on an invoice has come to (a checkout's
  `payment.settlement` is one), and `UsePaymentMethodSessionResult["status"]`, where the
  provider's page for a payment method stands;
- `CheckoutSetup["opening"]` (`SetupPageOpening`), how a checkout opened the provider's page
  where the customer saves a payment method: `popup` or `redirect`, and `null` when the page was
  only reloaded back to the checkout;
- of the anonymous checkout: `AnonymousCheckoutStep`, where it stands;
  `AnonymousCheckoutProblem`, the refusals it names; `AnonymousCheckoutSetup["opening"]`, as
  `CheckoutSetup["opening"]` is; `AnonymousCheckoutPayment["settlement"]`, how the wait on the
  first payment stands; and `TurnstileStatus`, where the check's widget stands.

For all of them:

- **A member is only ever added, in a minor release,** and the changelog names it. The
  members of 1.0 keep their names, their meaning and their fields for all of 1.x, short of the
  cases a new refusal or a new state takes from them by the next two points; a member may gain
  an optional field.
- **A new refusal comes out of `other`.** A refusal the hooks do not name is
  `{ kind: "other" }`, with the error itself in `error`, and a reason they do not name is
  `"other"`. A kind or a reason that a minor release adds names what was `other` until
  then, never what another member named: a host that handles `other` handles it already,
  in plainer words.
- **A new state of a wait or of a payment-method page takes its case from the state that held
  it, never from `paid` or `saved`.** An invoice voided while it is waited on, for one, is
  `polling` and then `gave_up` until it has a state of its own. A host that knows only the
  states of 1.0 never takes an unpaid invoice for paid, nor a payment method that was not
  saved for saved.
- **The anonymous checkout follows the same rules.** A step it adds takes its case from the step
  that held it: take one you do not know as a checkout still in progress, with nothing started
  that the visitor has not confirmed, and rely on `canStart`, `quote`, `setup`, `payment` and
  `outcome`. A refusal it adds comes out of `other`. `payment.status` is `not_required` for a checkout that completed with nothing to pay, and `setup` is `null` outside `awaiting_payment_method`. A state of the wait on a payment takes its
  case from `polling` and never from a completed checkout: `outcome` says it completed, and `check()` reads
  the session again. A state of the widget takes its case from `solving`: `canStart` says
  whether a token is in hand.
- **A new state of a redemption takes its case from `idle`, never from `applied`.** A host that
  knows only the states of 1.0 never takes a code that was not redeemed for redeemed: it shows
  the redemption as `redemption` and `applied` say it, and nothing else. A refusal a minor release
  adds comes out of `other`. The code is never in the state: the hook holds it, in memory, between
  `check` and `apply`, and forgets it when the redemption is applied, refused or reset.
- **A new way of opening the provider's page changes nothing else of the checkout.** The hook
  opens the page, waits for the customer and goes on by itself, whichever way it took, and the
  step is `awaiting_payment_method` all the same, with `setup.url` and `resume()`.
- **Keep a `default` branch.** For a refusal, say there what you say for `other`, and read
  `error` (for `useCheckout`, `preview.error` while the customer is choosing). For a step,
  rely on what holds whatever the step: `canSubmit` says whether the customer can subscribe,
  and `setup`, `result` and `payment` what there is to show. For a voucher state, say nothing
  of the code: as far as you know, it is neither applied nor refused. For the wait on an
  invoice, take it as not paid: `invoice` is the invoice as last read, and `check()` reads it
  again. For a payment-method page, take it that nothing was saved: `paymentMethod` is set once
  `saved`, and `start()` opens the page again. For the way a checkout opened the provider's
  page, say what you say when it was reloaded back to the checkout (`opening: null`): the page
  is at `setup.url` to be opened again, and `resume()` goes on once the customer is back. A
  `switch` that ends in an exhaustiveness check (`const unhandled: never = problem`) stops
  compiling when a member is added: that is the warning it is written for, and the addition is
  not a breaking change.
- **`@kaitencloud/react-ui` does the same**: each of its components keeps a fallback for a
  member it does not know, so a published `@kaitencloud/react-ui` reads what a later
  `@kaitencloud/react` 1.x adds.

The other union of `/billing`, the `status` of `CheckoutPreviewState`, is closed, and stays as
it is for all of 1.x.
`CheckoutPayment["status"]` is the client's `CheckoutPaymentStatus`, an open union.

## Practical guidance

- Prefer **`@kaitencloud/react` alone**, or hooks + `unstyled`, for production
  integrations you can't easily re-touch — they're the contract we intend to keep.
- Use the **styled components** to ship fast; expect to revisit them across minor
  releases.
- Watch the changelog; breaking changes to anything here are called out there.
