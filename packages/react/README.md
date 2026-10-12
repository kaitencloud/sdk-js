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

## Package status

- Import public APIs from `@kaitencloud/react`.
- Subpath exports: `@kaitencloud/react/locales` (one pack per language) and
  `@kaitencloud/react/types`. `@kaitencloud/react/internal` exists for
  `@kaitencloud/react-ui` and carries no stability promise.
- The package is a client module (`"use client"`), except `./locales`, which is
  plain data a Server Component can import.

### Stability

What this package exports follows semantic versioning, except the parts marked
`@experimental`: the telemetry types, which may change in a minor release.
[`STABILITY.md`](STABILITY.md) lists both sides, for this package and for
`@kaitencloud/react-ui`. The raw generated API (`KaitenApi`) is not exported here:
import it from `@kaitencloud/client`.

### Hook naming

- Selector hooks use short, unprefixed names: `useCustomer`, `useEntitlements`, `usePlans`, `useFlags`, `useAddOns`, `useCredits`. (There is no `useKaiten*`-prefixed variant.)

## Quick start

### Authenticated mode

> **Which credential.** This release has no customer-scoped credential for your end
> users' browsers. The API accepts a `ksh_` token, which the client refuses to send
> from a browser, or a JWT from the identity provider its gateway trusts, and both
> carry rights over a whole organization: see
> [`@kaitencloud/client`](../client/README.md#authentication), which also lists the
> scopes each read needs. For a pricing page, read the catalog on your backend and
> hand it to [`mode="static"`](#marketing-site-a-static-catalog).

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

A pricing page has no customer and needs no credential — and no backend serves a
publishable key anyway (see [Public mode](#public-mode)).
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
`FeatureCatalog` read it through the same hook. Prices are part of it: Kaiten
models no money server-side (see [Data source](#data-source)), so a static
catalog is where a marketing page's prices live.
`KaitenScopeProvider` accepts a static config as its `publicConfig` (see
[Switching](#switching-from-public-to-authenticated)), so the signed-out half of
an app can be static and the signed-in half live.

What a static provider cannot do, it says: `useReportUsage` and a contextual
`useFeatureFlag` reject with the mode in the message, and `usePaywallTrigger`
(so `Gate`, so `Paywall`) fails open with a development warning — gating needs a
customer, which only `mode="authenticated"` has.

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

> **Not served by the platform.** No backend endpoint accepts a `pk_` key, so this
> snippet returns no data against a real API. Use `mode="static"` above; switching
> is a change of config block, not of components. For fixture data in tests and
> Storybook, `createMockKaitenClient()` from
> [`@kaitencloud/client/testing`](../client/README.md#testing-without-an-api--kaitencloudclienttesting)
> plugs into the `client` prop.

```tsx
<KaitenProvider mode="public" apiUrl="https://kaiten.example.com/api" publishableKey="pk_demo">
  <Plans />
</KaitenProvider>
```

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

`KaitenProvider` supports three runtime modes:

- `mode="authenticated"` with `accessToken`, `customerId`, and optional `instanceId` — a customer's snapshot: plan, entitlements, usage, flags
- `mode="static"` with `catalog` — the plans the host already holds; no key, no request (see the quick start above)
- `mode="public"` with `publishableKey` — a live catalog read; **not served by the platform**, see [Public mode](#public-mode)

The two live modes take:

- `apiUrl?: string` — your Kaiten API's base URL, `/api` included. Defaults to `/api`, resolved against
  the current origin, which is almost never what you want in a deployed app; set
  it explicitly. Outside a browser (SSR) the relative default resolves against
  `http://localhost`.
- `polling?: { enabled?: boolean; interval?: number }` — on by default in
  `authenticated` mode only, every 5 minutes. The snapshot carries usage that
  other actors move; the catalog changes on a release, so a public provider polls
  only when asked. A read happens on mount, on that schedule and on `refetch` —
  never on focus or reconnect.
- `client?: KaitenClientLike` — a client of your own, such as the fake from
  [`@kaitencloud/client/testing`](../client/README.md#bringing-your-own-client).
- `initialData?: { snapshot?, catalog? }` — data fetched server-side, rendered on
  the first paint without a skeleton; the provider then revalidates it on its
  polling schedule.

All three modes take:

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

### Switching from public to authenticated

Use one top-level SDK scope whose config follows your app session. Do not render an authenticated
`KaitenProvider` inside a public one after login: nested providers are intentionally pass-through, so
the inner scope will keep using the outer provider data.

For the common visitor-pricing to signed-in-app flow, use `KaitenScopeProvider`:

```tsx
import { KaitenScopeProvider } from "@kaitencloud/react";

function BillingShell({
  session,
  children,
}: {
  session: AppSession | null;
  children: React.ReactNode;
}) {
  return (
    <KaitenScopeProvider
      publicConfig={{
        mode: "public",
        publishableKey: "pk_live_...",
        polling: { enabled: false },
      }}
      authenticatedConfig={
        session
          ? {
              mode: "authenticated",
              accessToken: session.kaitenAccessToken,
              customerId: session.customerId,
              instanceId: session.instanceId,
              polling: { enabled: false },
            }
          : null
      }
    >
      {children}
    </KaitenScopeProvider>
  );
}
```

`KaitenScopeProvider` renders public catalog data while `authenticatedConfig` is empty, then switches
to authenticated snapshot data when it becomes available. The SDK scope is remounted across that
boundary so the client and the SWR cache move together; state above the provider is preserved.

`publicConfig` also takes a static catalog — `{ mode: "static", catalog }` — which is the
signed-out half to use in place of publishable keys, which no endpoint serves: the pricing page renders from
data the host holds, and the same shell switches to the customer's live snapshot after login.

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
`saleUnitLabel`, `toSaleUnits`, `isUnlimited`, `resolveLicensePrice` and
`useKaitenBranding`.

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

Components consume the licensing snapshot and plan catalog composed by
`@kaitencloud/client` — GraphQL-first against the platform's `/graphql` aggregate,
with a REST fan-out fallback for older APIs; feature flags are evaluated over OFREP.
There are no dedicated `/api/components/*` endpoints.

## Known limitations

- `mode="public"` / publishable keys are not served by the platform; the client-side surface is ready. `mode="static"` covers the marketing-site case.
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
