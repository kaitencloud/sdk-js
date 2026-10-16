# @kaitencloud/react

The **headless core** of Kaiten's React SDK: the provider, every hook, and the
control primitives for licensing, entitlements, usage, flags and gating.

It renders no DOM and ships no stylesheet. A host that gates its own buttons in
its own design system installs this package alone. For Kaiten's prebuilt
components — pricing table, customer portal, paywall — install
[`@kaitencloud/react-ui`](../react-ui/README.md), which depends on this package
and re-exports all of it, so an app that draws imports from one place.

## Installation

> **Not on npm yet.** This package is published with Kaiten billing, whose public
> catalogue and customer sessions it reads. Until then it is built from this
> repository, and the line below is how it will install.

```bash
npm install @kaitencloud/react
```

There is nothing to import for its effect: no stylesheet, no side effects.

## Kaiten version

Minimum Kaiten version for the billing features: **the first Kaiten release with billing.** No Kaiten release carries billing yet.

`mode="public"` (the catalogue, read with a publishable key from `GET {apiUrl}/public/catalog`),
`mode="customer-session"` and the hooks of [`@kaitencloud/react/billing`](#billing-hooks) (the
`/public/session/*` routes) need it. A server without billing answers them with an error,
which a hook returns in `error`. `mode="static"` renders a catalogue the host already holds and
makes no request, and `mode="authenticated"` reads what the client composes from the licences
endpoints, so neither asks the server for more than it serves today. What the client asks of
the server is in [its README](../client/README.md#kaiten-version).

## Package status

- Import public APIs from `@kaitencloud/react`.
- Subpath exports: `@kaitencloud/react/billing` (the [billing hooks](#billing-hooks)),
  `@kaitencloud/react/locales` (one pack per language) and `@kaitencloud/react/types`.
  `@kaitencloud/react/internal` exists for `@kaitencloud/react-ui`, not for a host: it is not
  documented here, and only grows within a major so that a published `@kaitencloud/react-ui`
  keeps working.
- The package is a client module (`"use client"`), except `./locales`, which is
  plain data a Server Component can import.

### Stability

What this package exports follows semantic versioning, the billing surface included:
`mode="public"`, `mode="customer-session"` and the hooks of `@kaitencloud/react/billing` are
stable from 1.0.0, and need the first Kaiten release with billing. The exceptions may change in
a minor release: the telemetry types, `formatKaitenPrice`, the words of the styled components,
and a few small exports not yet classified. [`STABILITY.md`](STABILITY.md) lists both sides,
for this package and for `@kaitencloud/react-ui`, and the rules by which the refusals, the steps
and the voucher states of the billing hooks gain a member. The raw generated API (`KaitenApi`) is not exported here:
import it from `@kaitencloud/client`.

### Hook naming

- Selector hooks use short, unprefixed names: `useCustomer`, `useEntitlements`, `usePlans`, `useFlags`, `useAddOns`, `useCredits`. (There is no `useKaiten*`-prefixed variant.)

## Quick start

### Authenticated mode

> **Which credential.** The API accepts a `ksh_` token, which the client refuses to
> send from a browser, or a JWT from the identity provider its gateway trusts, and
> both carry rights over a whole organization: see
> [`@kaitencloud/client`](../client/README.md#authentication), which also lists the
> scopes each read needs. The customer-scoped credential for your end users'
> browsers is a customer session, which Kaiten billing adds: see
> [Customer session](#customer-session). For a pricing page, read the catalog on
> your backend and hand it to [`mode="static"`](#marketing-site-a-static-catalog).

```tsx
import { Gate, KaitenProvider } from "@kaitencloud/react";

function App() {
  return (
    <KaitenProvider
      mode="authenticated"
      apiUrl="https://kaiten.example.com/api"
      accessToken="tmp_15_min_token"
      customerId="cust_123"
      instanceId="inst_456"
    >
      <Gate entitlement="api_calls" flagKey="premium-feature">
        {({ blocked }) => (blocked ? <UpgradePrompt /> : <ApiPlayground />)}
      </Gate>
    </KaitenProvider>
  );
}
```

The provider renders no element of its own — it is context only, so it can sit
at an app's root without joining its layout.

> **Set `apiUrl`.** It defaults to `/api`, resolved against your own app's origin
> — so leaving it out sends every SDK request to _your_ backend rather than
> Kaiten's, and the 404 that comes back surfaces as `KaitenError: Unknown error`.
> Point it at your Kaiten API's base URL, `/api` included.

### Marketing site: a static catalog

A pricing page has no customer and needs no credential — and only a Kaiten server
with billing serves a publishable key (see [Public mode](#public-mode)).
`mode="static"` takes the catalog the host already holds and renders it: no key,
no client, **no request**, no polling.

```tsx
import { KaitenProvider, usePlans } from "@kaitencloud/react";
import type { KaitenCatalog } from "@kaitencloud/react";

// Hoist it: a literal written inside render is a new object every render.
const catalog: KaitenCatalog = {
  plans: [
    {
      slug: "starter",
      name: "Starter",
      price: 1900,
      currencyCode: "EUR",
      features: ["1 instance"],
    },
    {
      slug: "pro",
      name: "Pro",
      price: 7900,
      currencyCode: "EUR",
      highlighted: true,
      features: ["10 instances"],
    },
  ],
};

function MarketingPage() {
  return (
    <KaitenProvider mode="static" catalog={catalog}>
      <Plans />
    </KaitenProvider>
  );
}

function Plans() {
  // No loading state to wait out: the data is the host's own object.
  const { data } = usePlans();
  return <PlanCards plans={data ?? []} />;
}
```

`KaitenCatalog` is plain data, so it crosses a server/client boundary as a prop.
`usePlans()` returns it on the first render, so nothing loads and nothing can
fail — and `@kaitencloud/react-ui`'s `PricingTable`, `FeatureComparison` and
`FeatureCatalog` read it through the same hook. Prices are part of it: until
Kaiten billing, the server models no money, so a static catalog is where a
marketing page's prices live.
`KaitenScopeProvider` accepts a static config as its `publicConfig` (see
[Switching](#switching-from-public-to-signed-in)), so the signed-out half of
an app can be static and the signed-in half live.

What a static provider cannot do, it says: `useReportUsage` and a contextual
`useFeatureFlag` reject with the mode in the message, and `usePaywallTrigger`
(so `Gate`, so `Paywall`) fails open with a development warning — gating needs a
customer, which only `mode="authenticated"` and `mode="customer-session"` have.

#### Fetching the catalog server-side (Next.js App Router, Astro, a build step)

The catalog read is `KaitenClient.getCatalog()`, and `KaitenClient` runs
anywhere `fetch` does. Outside a browser the transport accepts a bearer
credential — the guard that refuses one only fires where a `window` exists — so
a Server Component, an Astro frontmatter or a build script can compose the
catalog with a `ksh_` token and hand the plain result to a static provider:

```tsx
// app/pricing/page.tsx — a Server Component. It never ships to the browser;
// `import "server-only"` (npm) turns importing it from client code into a build error.
import "server-only";
import { KaitenClient } from "@kaitencloud/client";
import { PricingSection } from "./pricing-section";

export default async function PricingPage() {
  const kaiten = new KaitenClient({
    // The base URL, `/api` included: the transport calls `${apiUrl}/graphql` as is.
    apiUrl: process.env.KAITEN_API_URL!,
    authScheme: "bearer",
    tokenProvider: () => process.env.KAITEN_API_TOKEN!, // a read-only ksh_ token
  });
  const catalog = await kaiten.getCatalog();
  return <PricingSection catalog={catalog} />;
}
```

```tsx
// app/pricing/pricing-section.tsx
"use client";
import { KaitenProvider } from "@kaitencloud/react";
import type { KaitenCatalog } from "@kaitencloud/react";

export function PricingSection({ catalog }: { catalog: KaitenCatalog }) {
  return (
    <KaitenProvider mode="static" catalog={catalog}>
      <Plans />
    </KaitenProvider>
  );
}
```

This package is a client module, so the provider is the boundary: the token
stays on the server, the browser receives the catalog it would otherwise have
fetched, and the page arrives as finished HTML — no round-trip, no skeleton.
`tests/ssr.test.tsx` runs exactly this chain, in Node, against a fake API.

### Public mode

> **Served by Kaiten billing.** Public mode reads
> `GET {apiUrl}/public/catalog`, a route of the Kaiten release that ships billing; a
> server without it answers 404. Until then use `mode="static"` above; switching
> is a change of config block, not of components. For fixture data in tests and
> Storybook, `createMockKaitenClient()` from
> [`@kaitencloud/client/testing`](../client/README.md#testing-without-an-api--kaitencloudclienttesting)
> plugs into the `client` prop.

```tsx
<KaitenProvider
  mode="public"
  apiUrl="https://kaiten.example.com/api"
  // `pk_` and 43 characters (32 random bytes, base64url), from the Kaiten console.
  publishableKey={KAITEN_PUBLISHABLE_KEY}
>
  <Plans />
</KaitenProvider>
```

A publishable key is public by design: it ships in your pages, and it grants the
read-only catalog of your organization's public plans and nothing else. The API
checks it against the origins you allowed for it on every request, and refuses it
anywhere but the catalog. The SDK sends it the same way: in the
`X-Kaiten-Publishable-Key` header, never `Authorization`, with no cookie, to
`/public/catalog` only. Anything else a public provider is asked for — a usage
report, a flag evaluated with a context — is refused before any request.

The catalog lists the default version of each plan family the organization made public:

- `prices` holds the plan's default monthly and annual flat fees, which
  `plan.price` and `plan.annualPrice` repeat. A quarterly or semi-annual fee, a
  usage or overage price, or a price in fractions of a minor unit is only in
  `billingPrices`: read `intervalCount` and `billingModel` there before you print
  "/ month".
- `selfServe` says whether a visitor can subscribe to the plan by themselves.
  When it is false, offer `selfServeCtaUrl` ("Contact us" for a `CUSTOM` plan),
  and nothing when it is null. `PricingTable` does both.
- `addOns` and `capabilities` (`checkout`, `paymentMethods`) sit beside `plans`.

### Customer session

> **Served by Kaiten billing.** Like public mode, this mode needs the first Kaiten
> release with billing.

`mode="customer-session"` is one customer, signed in to your application, seen
through a customer session (`kst_`): their subscription, their effective
entitlements, their add-ons and payment method — what a customer portal, a
checkout and the paywalls in front of that customer read. Your backend mints the
session with `CustomerSessions.createCustomerSession` of
[`@kaitencloud/server`](../server/README.md#customer-sessions), behind your own
authentication, and the browser fetches it from there; it never holds a secret.

```tsx
import { KaitenSessionClient } from "@kaitencloud/client";
import { KaitenProvider, usePortal } from "@kaitencloud/react";

// Once, outside render: the provider's scope and cache follow this object.
const sessionClient = new KaitenSessionClient({
  apiUrl: "https://kaiten.example.com/api",
  // Your endpoint, which returns { token, expiresAt }. Called again before the
  // session expires, and once more if the API refuses it.
  getCustomerSession: () => fetch("/billing/session", { method: "POST" }).then((r) => r.json()),
});

function Billing() {
  return (
    <KaitenProvider
      mode="customer-session"
      sessionClient={sessionClient}
      // Optional: the catalog, for `usePlans`, `useUpgradeOptions` and a pricing table.
      apiUrl="https://kaiten.example.com/api"
      publishableKey={KAITEN_PUBLISHABLE_KEY}
    >
      <Usage />
    </KaitenProvider>
  );
}

function Usage() {
  const { data: portal } = usePortal();
  return <p>{portal?.subscription?.status}</p>;
}
```

The provider takes the client rather than building one, so an application that
never offers a portal does not bundle it; add `@kaitencloud/client` to your
dependencies to import it. The session goes in `Authorization: Bearer kst_…`, to
`/public/session/*` only.

- **The licensing snapshot is the portal's.** Its `entitlements` are effective
  — the licence grant with its add-ons and voucher boosts applied — with their
  usage and a `provenance` that says how each layer contributed; `addOns` and
  `capabilities` are the portal's too, and `plans` the catalog's.
  `useEntitlementCheck`, `usePaywallTrigger`, `Gate` and `Paywall` gate on them.
  What they gate on is the core's own reading of usage (`status`, `percentageUsed`);
  the styled components of `@kaitencloud/react-ui` colour and word a quota by the
  Kaiten console's rule instead, which counts the allowance of a soft limit.
- **`useCustomer`, `useInstance` and `useLicense` answer nothing.** The portal
  names the customer, the instance and the licence without the ids, audit fields
  and dates those types carry, so the snapshot leaves them `null` rather than
  invent them. What it does say about the plan is on the snapshot, as it says it:
  `useLicensingSnapshot().data.currentPlan` is the bound instance's plan (`slug`
  and `name`), and `.subscription` its subscription (`status`, `basePrice`,
  `currentPeriodEnd`, `billingInterval` and `intervalCount`, `cancelAtPeriodEnd`,
  `scheduledChange`). Both are `null` on a session bound to the customer only, and
  `undefined` under any other mode. `usePortal()` returns the whole portal, and
  `useUpgradeOptions` finds the current plan by the bound instance's licence.
- **No flags, no usage reports.** Neither is on the session's routes: the
  snapshot has no flags, and `useReportUsage` refuses before any request. Report
  usage from your backend.
- **Writes go through the billing hooks.** A checkout, a cancellation, an
  add-on quantity, the payment method and the provider's portal are hooks of
  [`@kaitencloud/react/billing`](#billing-hooks), which read the portal again
  once a change succeeds. `useKaitenSessionClient()` returns the client itself
  for anything else it can do. Totals always come from the server: a checkout's
  `dryRun` says what is due today.

#### Billing hooks

> **Served by Kaiten billing.** Like the mode they need, they need the first Kaiten
> release with billing. Their refusals, a checkout's steps and the states of a voucher code
> may gain a member in a minor release: keep a `default` branch
> ([STABILITY.md](STABILITY.md#unions-that-grow)).

`@kaitencloud/react/billing` holds what a checkout and a customer portal do, with no
markup of its own: the selection and what it costs, the provider's page for a payment
method and the way back from it, the invoices of a payment that is still open, and the
changes a customer makes to their subscription. It is an entry of its own, so a host that
offers neither bundles none of it. `@kaitencloud/react-ui`'s `CheckoutFlow` is these hooks,
drawn.

| Hook                                                                        | What it does                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `useCheckout`                                                               | A checkout, from choosing a price to being subscribed                           |
| `useCheckoutPreview`                                                        | What is due today for a selection, from the server, after a 300 ms pause        |
| `useInvoices`, `useInvoiceSettlement`                                       | The customer's invoices, paged; the wait for one to be paid                     |
| `useCancelSubscription`, `useReactivateSubscription`, `useSetAddonQuantity` | A change to the subscription; the portal is read again before it resolves       |
| `useBillingPortal`, `usePaymentMethodSession`                               | The provider's billing portal; a hosted page to add or replace a payment method |
| `useValidateVoucher`                                                        | A voucher code checked on its own                                               |

```tsx
import { useCheckout } from "@kaitencloud/react/billing";

function Checkout({ licensePriceId }: { licensePriceId: string }) {
  const checkout = useCheckout({ initial: { licensePriceId } });
  const due = checkout.preview.data?.dueToday;

  if (checkout.step === "subscribed") return <p>Subscribed.</p>;
  return (
    <>
      <button onClick={() => checkout.setAddOnQuantity("extra-seats", 2)}>2 extra seats</button>
      {/* The server's lines and the server's total: nothing is added up here. */}
      {due && <p>{formatKaitenMoney(due.total, due.currencyCode)} today</p>}
      <button disabled={!checkout.canSubmit} onClick={() => void checkout.submit()}>
        Subscribe
      </button>
    </>
  );
}
```

- **The server prices, the SDK never does.** Each selection is priced by a checkout's
  `dryRun`, which is the subscription rolled back: the lines and the total in
  `preview.data` are the server's, the lines need not sum to the total, and a trial is
  nothing due and `trialEndsAt`. A request is made once the selection has stood still for
  300 ms, and the first one at once. Answers that arrive after a newer request are dropped.
  Nothing is asked once the checkout is being made, or is made: the instance is subscribed, and
  the server would refuse a preview.
- **The billing email is for subscribing, not for pricing.** Kaiten prices a `dryRun` without
  one, so `preview` is there as soon as a price is chosen, and an address typed afterwards asks
  nothing more. `needsBillingEmail` says the customer has none, `billingEmailMissing` that
  what was typed cannot be an address yet, and `canSubmit` waits for it. A server that still
  refuses a preview with `billing_email_required` (an older Kaiten) is then sent the address
  with every preview.
- **A voucher code** is typed, sent in the body of the call and nowhere else: not in a URL,
  not in a log, not in what telemetry is told. `preview.voucher` says `applied` or `rejected`
  (`checking` while the server is asked, and while it could not be reached to judge the code);
  a refusal never says why. A rejected code leaves the summary the selection had without it,
  whether the preview refused it or the checkout did after the preview took it: the selection is
  then priced again without the code, and nothing can be submitted until the code is removed.
- **A payment method first.** For a customer with none, `submit()` is answered with the
  provider's setup page: it opens in a popup, or in place of the page when the browser blocks
  popups, and the checkout goes on when the customer is back, to the page loaded with
  `kaiten_setup_session` or to the popup that says it is done. What was chosen is kept in the
  tab's `sessionStorage` meanwhile, voucher code included, and forgotten once the checkout
  is done, or when the page that opened a popup is left. A page sent to the provider's own
  keeps it for the way back, until it expires with the setup page. **Mount `useCheckout` on the page the customer comes back to**: `returnUrl` is
  the current page, minus its fragment and any `kaiten_*` parameter, unless you say another.
- **What became of the payment.** The instance is subscribed whatever it was: `payment`
  says `paid`, `not_required`, `requires_action` (the customer confirms it on
  `hostedInvoiceUrl`), `failed` (the card was refused: save another with
  `usePaymentMethodSession`, or pay on `hostedInvoiceUrl`) or `processing`. While a payment
  is open, the invoices are read every 5 seconds until the invoice is `PAID`, for 10 minutes,
  and then once each time the window takes focus; the portal is read again when it is paid.
  An invoice that is not on the newest page is looked for a few pages down. A `processing`
  payment whose invoice turns out `PAYMENT_FAILED` becomes `failed` (with the invoice's
  `hostedInvoiceUrl`) and stops being read; one that began as `requires_action` stays so, as
  the invoice reads the same until the customer acts.
- **Refusals have names.** `problem` classifies what the last attempt was refused with
  (`quota_exceeded` and the entitlements over the plan, `already_subscribed`,
  `voucher_invalid`, `billing_email_required`, `setup_incomplete`, `unavailable` and
  `rate_limited` with their wait, `not_payable_online` for a paid plan the vendor has no card
  provider for, `addon_refused` and each add-on the price cannot bill, one of the order or one
  the instance holds, which a subscribe keeps, with why: `currency_mismatch`,
  `no_price_for_period`, `family_held` or `other`); `error` is the error itself, with its status
  and code. `useSetAddonQuantity`
  names the refusals of a change to an add-on the same way, in its own `problem`:
  `addon_not_public` (a version that is unknown, archived, unpublished or no longer the one the
  catalogue sells), `currency_mismatch` (priced in another currency than the subscription's),
  `incompatible` (it does not fit the plan, or has no price for its billing period),
  `quantity_exceeds_max`, `other_version_attached`, `subscription_incomplete` (the checkout's
  payment is not confirmed yet), `instance_required` (a session bound to the customer alone), and
  `boundary_pending` and `unavailable` with their wait. An address the API gives for
  the provider's page that is not `http` or `https` is never opened.
- **A billing period being closed.** `useCancelSubscription`, `useReactivateSubscription`
  and `useSetAddonQuantity` wait out a `BoundaryPendingError` that asks for 120 seconds or
  less, send the change once more, and say when in `retryAt`; the second answer is the
  answer. Nothing else is sent again by a hook: a checkout, a voucher check and a payment
  method session are made once.

#### Tokens that expire

Real sessions rotate, so `accessToken` also takes a function. It is called per
request, which means a refreshed credential is used from the next request on —
no remount, no cache reset. Passing an inline arrow is safe: the provider reads
the latest one through a ref instead of rebuilding its client each render.

`onAuthError` fires when the API rejects the credential (401/403). The request is
not retried — the SDK cannot mint a new token — so use it to refresh the host
session or send the user to sign in; the next poll picks the new token up.

```tsx
import { useAuth } from "@clerk/react";

function App() {
  const { getToken, signOut } = useAuth();

  return (
    <KaitenProvider
      mode="authenticated"
      accessToken={async () => (await getToken()) ?? ""}
      customerId="cust_123"
      onAuthError={({ status }) => {
        if (status === 401) void signOut();
      }}
    >
      <Billing />
    </KaitenProvider>
  );
}
```

## Provider modes

`KaitenProvider` supports four runtime modes:

- `mode="authenticated"` with `accessToken`, `customerId`, and optional `instanceId` — a customer's snapshot: plan, entitlements, usage, flags
- `mode="static"` with `catalog` — the plans the host already holds; no key, no request (see the quick start above)
- `mode="public"` with `publishableKey` — a live catalog read, from a Kaiten server with billing; see [Public mode](#public-mode)
- `mode="customer-session"` with `sessionClient`, and optional `publishableKey` — one customer's portal through a customer session, from a Kaiten server with billing; see [Customer session](#customer-session)

The three live modes take:

- `apiUrl?: string` — your Kaiten API's base URL, `/api` included. Defaults to `/api`, resolved against
  the current origin, which is almost never what you want in a deployed app; set
  it explicitly. Outside a browser (SSR) the relative default resolves against
  `http://localhost`.
- `polling?: { enabled?: boolean; interval?: number }` — on by default in
  `authenticated` and `customer-session` modes, every 5 minutes. The snapshot and
  the portal carry usage that other actors move; the catalog changes on a
  release, so a public provider polls only when asked, and a customer session
  never re-reads its catalog on that schedule. A read happens on mount, on that
  schedule and on `refetch` — never on focus or reconnect.
- `client?: KaitenClientLike` — a client of your own, such as the fake from
  [`@kaitencloud/client/testing`](../client/README.md#bringing-your-own-client).
  Under `customer-session`, it reads the catalog.
- `initialData?: { snapshot?, catalog?, portal? }` — data fetched server-side,
  rendered on the first paint without a skeleton; the provider then revalidates
  it on its polling schedule.

All four modes take:

- `hideBranding?: boolean` — a request, granted only when the licence allows it;
  `useKaitenBranding()` is the rule, and `@kaitencloud/react-ui`'s
  `KaitenBranding` its default rendering.
- `locale?: KaitenLocalizationOverrides` — the language: a pack from
  `@kaitencloud/react/locales` (`fr`, `es`, `de`; `en` is the default). A pack
  rather than a name, so the provider carries no language it was not handed —
  a host bundles the packs it ships and no other.
- `localization?: KaitenLocalizationOverrides` — the host's own strings, merged
  on top of the language. Deep: `{ paywall: { upgrade: "Go Pro" } }` changes
  one string and keeps the rest of the section. `useLocalization()` returns the
  resolved set, so a host's own markup can read the same strings the components do.
- `telemetry?: KaitenTelemetryOptions`

Theming lives with the components: `appearance` is a prop of
`@kaitencloud/react-ui`'s `KaitenStyleRoot`, which renders the element every SDK
style is scoped to.

### Switching from public to signed in

Use one top-level SDK scope whose config follows your application's own sign-in. Do not render a
signed-in `KaitenProvider` inside a public one after login: a provider with another config is a
scope of its own, so the inner one would read beside the outer one, with a second client and a
second cache, while everything outside it kept reading the public catalog.

The _scope_ is the data a provider reads and caches — its mode, its `apiUrl`, its key or its
client — not a permission: `KaitenScopeProvider` chooses which scope the SDK reads, and grants
nothing.

For the common visitor-pricing to signed-in-app flow, use `KaitenScopeProvider`. A vendor's
storefront reads the public catalog until its user signs in, then that customer's portal through a
customer session, which is the credential made for a customer's browser
([Customer session](#customer-session)):

```tsx
import * as React from "react";
import { KaitenSessionClient } from "@kaitencloud/client";
import { KaitenScopeProvider } from "@kaitencloud/react";

const apiUrl = "https://kaiten.example.com/api";

function BillingShell({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  // One session client per signed-in user: a new client is a new scope, with its own cache.
  const sessionClient = React.useMemo(
    () =>
      userId === null
        ? null
        : new KaitenSessionClient({
            apiUrl,
            // Your endpoint, which mints the customer session of the user signed in to your app.
            getCustomerSession: () =>
              fetch("/billing/session", { method: "POST" }).then((r) => r.json()),
          }),
    [userId],
  );

  return (
    <KaitenScopeProvider
      publicConfig={{ mode: "public", apiUrl, publishableKey: KAITEN_PUBLISHABLE_KEY }}
      authenticatedConfig={
        sessionClient
          ? {
              mode: "customer-session",
              sessionClient,
              // The catalog beside the portal, for a pricing table and `useUpgradeOptions`.
              apiUrl,
              publishableKey: KAITEN_PUBLISHABLE_KEY,
            }
          : null
      }
    >
      {children}
    </KaitenScopeProvider>
  );
}
```

`KaitenScopeProvider` renders the catalog while `authenticatedConfig` is empty, then switches to the
customer's portal when it is set. The SDK scope is remounted across that boundary so the client and
the SWR cache move together; state above the provider is preserved.

`publicConfig` also takes a static catalog — `{ mode: "static", catalog }` — which is the
signed-out half to use until your Kaiten server serves publishable keys: the pricing page renders from
data the host holds, and the same shell switches to the customer's portal after login.
An application whose users are members of your Kaiten organization, such as an internal tool, can
pass an `authenticated` config as `authenticatedConfig` instead; its token carries rights over the
whole organization ([Which credential](#authenticated-mode)), so it never goes to a customer's
browser.

## Headless hooks

```tsx
import { useAddOns, useCredits, useEntitlements, useFlags, usePlans } from "@kaitencloud/react";

function LicensingSidebar() {
  const plans = usePlans();
  const entitlements = useEntitlements();
  const flags = useFlags();
  const addOns = useAddOns();
  const credits = useCredits();

  // Build your own UI from the embedded licensing snapshot and catalog data.
}
```

The rules the styled components apply are exported too, so a host's own UI reaches
the same answers rather than re-deriving them: `formatKaitenMoney`,
`formatKaitenDate`, `formatKaitenUsageWindowBound`, `pluralize`, `usageWindowLabel`,
`isPeriodicEntitlement`, `resolveUsageScope`, `isCustomerFacing`, `unitLabel`,
`saleUnitLabel`, `toSaleUnits`, `isUnlimited`, `resolveLicensePrice`,
`formatKaitenPrice` and `useKaitenBranding`.

`formatKaitenPrice(price, localization, { entitlements })` writes any price of the
catalog as a line: "€49.00/month" for a monthly fee, "€135.00 every 3 months" for a
quarterly one, "€2.00 per 1M tokens" for a usage price, and "€0.000002 per call" for
a price below one minor unit, whose exact `unitAmountDecimal` it writes whole instead
of rounding to "€0.00". `formatKaitenMoney` takes that decimal string too. A usage price
names the unit of the entitlement it meters when it names no sale unit itself, so give
it the entitlements of the plan.

## Gating

Three levels, from most to least opinionated:

|           | Renders                             | Use when                                | Package                 |
| --------- | ----------------------------------- | --------------------------------------- | ----------------------- |
| `Paywall` | Kaiten's own wall over your content | You want the upsell UI for free         | `@kaitencloud/react-ui` |
| `Gate`    | Nothing — hands you the numbers     | You want your own button, badge, upsell | `@kaitencloud/react`    |
| `Show`    | Children or `fallback`              | The answer is a plain yes/no            | `@kaitencloud/react`    |

`Gate` is the headless middle. It always renders, and reports how much of the
entitlement is left so you can build the affordance in your own design system:

```tsx
import { Gate } from "@kaitencloud/react";

<Gate entitlement="seats">
  {({ blocked, warning, current, limit }) => (
    <>
      {(blocked || warning) && (
        <Badge>
          {current} / {limit} seats
        </Badge>
      )}
      <Button disabled={blocked} onClick={invite}>
        Invite teammate
      </Button>
    </>
  )}
</Gate>;
```

Treat this as a hint, not enforcement: the server is the authority, and it will
reject an over-quota write regardless. `Gate` stays open while the snapshot
loads, so a guarded button never flickers behind a spinner.

Under `mode="customer-session"` the state also says where the limit comes from.
`state.source` is the layer that grants the entitlement, `"license"` or `"addon"`, and
`state.provenance` how it got to its value: the licence's grant, the add-ons attached, the
voucher boosts and the arithmetic (`provenance.number.effective`, `.boostMultiply`…), enough
for a line such as "(100,000 base) × 2 voucher = 200,000". `useEntitlementCheck` returns
them on the entitlement it holds, `check.entitlement.source` and `.provenance`. Under any
other mode `provenance` is absent.

### Rolling out gradually

Every Kaiten hook throws outside `<KaitenProvider>` — deliberately, since
silently reporting "not entitled" would gate features by accident. `Gate` is the
exception: with no provider mounted it reports everything as allowed, so a host
adopting Kaiten behind a flag (or a self-hosted edition with no Kaiten account,
or a test rendering a subtree bare) does not have to fork each call site.

For hook call sites, branch on `useKaitenAvailable()` — hooks cannot be called
conditionally, so the branch has to pick a component:

```tsx
function NewProjectButton() {
  return useKaitenAvailable() ? <GatedButton /> : <PlainButton />;
}
```

### Errors

Every error a hook hands you, in `error`, in `onError` or by rejection, is the one the
client threw, with its class and its fields: narrow it with `instanceof`.

| Class                                                   | When                                                                                                      | What it carries                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `QuotaExceededError`                                    | a checkout the plan cannot hold: the instance already uses more than it grants                            | `entitlementSlugs`, the entitlements over the plan |
| `RateLimitedError`                                      | too many calls: 429                                                                                       | `retryAfterSeconds`                                |
| `BoundaryPendingError`                                  | a change refused while the billing period that ended is being closed                                      | `retryAfterSeconds`                                |
| `ProviderUnavailableError`                              | the payment provider could not be reached: 503                                                            | `retryAfterSeconds`                                |
| `TransactionIdReusedError`, `InvalidTransactionIdError` | a usage report whose `transactionId` (the `Idempotency-Key`) was used for another report, or is malformed | `transactionId`, and `original` for the first      |

All are a `KaitenError`, so `error.status` and `error.code` keep working. The three refusals
made to be waited out always carry `retryAfterSeconds`: the API's `Retry-After`, or 60 when the
response had none the browser could read. The hooks do not wait for you and do not send a call
again: a read that fails keeps the data it last had, with `error` set, and the next read is the
polling schedule's or `refetch`'s.

## Control primitives

| Component                 | Description                                       |
| ------------------------- | ------------------------------------------------- |
| `<Gate />`                | Render-prop gate reporting entitlement state      |
| `<Show />`                | Minimal declarative entitlement/flag switch       |
| `<KaitenLoaded />`        | Render children when provider data is loaded      |
| `<KaitenLoading />`       | Render children while provider data is loading    |
| `<KaitenFailed />`        | Render children when provider data failed to load |
| `<KaitenErrorBoundary />` | Error boundary for embedded trees                 |

Each renders only what you give it — no markup of Kaiten's own, so none of them
needs a stylesheet or a style root.

## Window events

The components of `@kaitencloud/react-ui` emit DOM events on `window` after an
embedded action, so the host application can react:

- `kaiten:plan-changed` — from `UpgradeButton` and the portal's current-plan section
- `kaiten:quota-added` — from the portal's current-plan section
- `kaiten:addon-added` — from the portal's current-plan and add-ons sections

```ts
window.addEventListener("kaiten:plan-changed", (event) => {
  console.log(event.detail);
});
```

## Data source

In `authenticated` mode, components consume the licensing snapshot and plan catalog
composed by `@kaitencloud/client` — GraphQL-first against the platform's `/graphql`
aggregate, with a REST fan-out fallback for older APIs; feature flags are evaluated
over OFREP. There are no dedicated `/api/components/*` endpoints.

With Kaiten billing, `public` and `customer-session` modes read the public routes
billing adds instead, and nothing else: `/public/catalog` with a publishable key,
`/public/session/*` with a customer session.

## Known limitations

- `mode="public"` and `mode="customer-session"` need a Kaiten server that ships billing ([Kaiten version](#kaiten-version)). `mode="static"` covers the marketing-site case today.
- Branding removal depends on backend capabilities exposed on `catalog` or `snapshot`.
- `useUpgradeOptions` offers every published plan but the current one. Several versions of one license family can be published at once, so a customer on one version is offered the others too; `familyId` on each plan tells them apart.
- Telemetry is opt-in and transport-injected; the SDK does not ship a hosted telemetry endpoint.
- Localization ships English defaults plus `fr`/`es`/`de` packs on `@kaitencloud/react/locales`, passed as `locale={fr}`; per-string overrides go through `localization`.

## Development

```bash
vp install
vp pack
vp check
vp test
```

The Storybook playground lives with the components, in
[`packages/react-ui`](../react-ui/README.md).
