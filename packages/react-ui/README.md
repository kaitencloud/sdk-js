# @kaitencloud/react-ui

Kaiten's prebuilt React components for embedded licensing, pricing, entitlements,
add-ons, credits and paywall flows — plus the `KaitenStyleRoot` that scopes their
stylesheet and tokens, the `appearance` theming API, and a local Storybook for
visual development.

It is built on [`@kaitencloud/react`](../react/README.md), the headless core, and
**re-exports all of it**: the provider, the hooks and the control primitives are
available from here too, so an app that draws imports from one place. An app that
only gates its own UI installs the core alone and never pays for this package.

## Installation

> **Not on npm yet.** This package is published with Kaiten billing, whose public
> catalogue and customer sessions it reads. Until then it is built from this
> repository, and the line below is how it will install.

```bash
npm install @kaitencloud/react-ui
```

`@kaitencloud/react` comes with it as a dependency, so one install serves both.

```tsx
import "@kaitencloud/react-ui/styles.css";
```

## Kaiten version

Minimum Kaiten version for the billing features: **the first Kaiten release with billing.** No Kaiten release carries billing yet.

The components that read billing need it: `PricingTable` with a catalogue read by a
publishable key, `CheckoutFlow`, `CheckoutSummary`, and the billing sections of
`CustomerPortal` under a customer session (`InvoiceList`, `VoucherEntry`,
`PaymentMethodCard`). A component that draws a catalogue the host holds, or the licensing
snapshot of `mode="authenticated"`, asks no more of the server than before. The provider's
modes and what each asks of the server are in the
[core's README](../react/README.md#kaiten-version).

## Stability

The names this package re-exports from `@kaitencloud/react`, and each component's
`unstyled` rendering, follow semantic versioning. Everything else it adds — the
styled components' default rendering, `KaitenStyleRoot`, the `appearance` theming
API and `styles.css` — is **experimental: it may change in a minor release**. Pin
an exact version if you build on it, and read the changelog before upgrading.
[`STABILITY.md`](../react/STABILITY.md) lists what falls on each side.

## Quick start

Two elements: the provider carries the data and renders nothing; the style root
renders the `<div class="kaiten">` every SDK style is scoped to.

> **Which credential.** Authenticated mode below needs a token you are prepared to
> expose in your end users' browsers: see the core's
> [Authenticated mode](../react/README.md#authenticated-mode). A Kaiten server that
> ships billing adds the browser's own credentials, a publishable key for the
> catalog and a customer session for one customer
> ([Customer session](../react/README.md#customer-session)). Until then, for a
> pricing page, read the catalog on your backend and hand it to `mode="static"`, as
> in [Marketing site: a static catalog](../react/README.md#marketing-site-a-static-catalog).

```tsx
import { KaitenProvider, KaitenStyleRoot, Paywall } from "@kaitencloud/react-ui";

function App() {
  return (
    <KaitenProvider
      mode="authenticated"
      apiUrl="https://kaiten.example.com/api"
      accessToken="tmp_15_min_token"
      customerId="cust_123"
      instanceId="inst_456"
    >
      <KaitenStyleRoot>
        <Paywall
          entitlement="api_calls"
          flagKey="premium-feature"
          threshold={0.8}
          onUpgrade={(action) => {
            console.log("recommended action", action?.type);
          }}
        >
          <ApiPlayground />
        </Paywall>
      </KaitenStyleRoot>
    </KaitenProvider>
  );
}
```

Provider modes (`authenticated`, `static`, `public`, `customer-session`), credentials, polling,
localization and `KaitenScopeProvider`, which switches the scope when a user signs in, are the
core's; they are documented in
[`@kaitencloud/react`](../react/README.md).

### Where to put the style root

Wrap whatever draws. One root for the whole app is the simple answer; one per
route is what a mixed app wants, so the pages that only gate pay no DOM:

```tsx
<KaitenProvider mode="authenticated" {...config}>
  <App /> {/* Gate + hooks everywhere, zero Kaiten DOM */}
  <Route path="/billing">
    <KaitenStyleRoot>
      <CustomerPortal />
    </KaitenStyleRoot>
  </Route>
</KaitenProvider>
```

A styled component with no style root above it renders unstyled — every SDK rule
is scoped to that element — and says so in development. Nesting a second
`<KaitenProvider>` will not help: one with the same scope is a pass-through.
A nested style root is fine, and merges its `appearance` over the outer one's.

## Storybook

`packages/react-ui` is the local visual playground for the SDK.

```bash
vp install
vp run storybook
```

Storybook uses mocked Kaiten scenarios and the scoped Kaiten design system adapted from the main app, so the visual output stays close to the product while remaining embeddable.

## Components

| Component                  | Description                                                               |
| -------------------------- | ------------------------------------------------------------------------- |
| `<KaitenStyleRoot />`      | The `.kaiten` scope root: tokens, colour mode, portal container           |
| `<PricingTable />`         | Public pricing table with annual toggle, add-ons, and feature comparison  |
| `<FeatureComparison />`    | Standalone feature-by-feature comparison table                            |
| `<CustomerPortal />`       | Authenticated licensing portal composed from modular elements             |
| `<CurrentPlan />`          | Current plan, renewal info, credits, and portal action buttons            |
| `<IncludedFeatures />`     | The plan's feature catalog (limit + status); unlimited rows are collapsed |
| `<UsageMeters />`          | Finite, metered quotas with live usage and the console's usage states     |
| `<AddOns />`               | Available and active add-ons plus credit balances                         |
| `<FlagsSummary />`         | Customer feature flags and rollout status                                 |
| `<InvoiceList />`          | A customer session's invoices, to pay and to download                     |
| `<VoucherEntry />`         | A field that checks a voucher code, which a checkout redeems              |
| `<PaymentMethodCard />`    | The payment method a customer session pays with, to add or replace        |
| `<Paywall />`              | Paywall aware of both entitlements and feature flags                      |
| `<PlanBadge />`            | Compact badge showing the customer's current plan                         |
| `<UpgradeButton />`        | Button wired to the recommended upgrade action                            |
| `<CheckoutFlow />`         | A customer's checkout of a plan: choices, what is due, payment, outcome   |
| `<CheckoutSummary />`      | What is due today for a selection: the server's lines and total           |
| `<EntitlementStatusBar />` | Compact quota bar that warns before a metered quota reaches its ceiling   |
| `<FeatureCatalog />`       | Searchable catalog of what each plan grants, with lifecycle stage badges  |
| `<BillingSummary />`       | The subscription (or licence term) and current-cycle usage, plus billing  |
| `<KaitenBranding />`       | Shared branding footer with capability-aware hiding                       |

`Gate`, `Show`, `KaitenLoaded`/`Loading`/`Failed` and `KaitenErrorBoundary` are
the core's control primitives, re-exported here. They render only what you give
them, so they need no style root.

### Component notes

- `CustomerPortal` accepts `elements` as the current composition API. Under `mode="customer-session"` it is the customer's own portal: the plan with the controls to cancel the subscription at the end of its period and to withdraw that, the limits with a note on where each comes from, the add-ons with a stepper, the invoices and a voucher check. See [Known limitations](#known-limitations).
- For declarative gating use `<Show entitlement="…" fallback={…}>` (conditional render) or `usePaywallTrigger` for the raw decision; `Paywall` is the overlay/upsell component.
- `Paywall` renders hard mode as an accessible modal: the native `<dialog>` element opened with `showModal()`, in the top layer above any z-index the host uses, with focus held inside and Escape as the exit. Target it as `dialog[data-slot="dialog-content"]`; its overlay is the `::backdrop`. The SDK ships no Radix, and Base UI only for the radio group that draws `CheckoutFlow`'s billing periods and the checkbox of its free trial; unstyled, they are native inputs.
- `hideBranding` (on the provider) only removes branding when the backend returns `branding.removable = true`. `useKaitenBranding()` from the core is the same rule, for a host rendering its own footer.

## Styling status

- Import `@kaitencloud/react-ui/styles.css` for the packaged default styling.
- Every public UI component also supports `unstyled` if you want to own the full DOM and CSS.
- `appearance` on `KaitenStyleRoot` (plus the exported `themes.*` presets) is the runtime theming API.
- The default styled mode is aligned with the Kaiten app tokens and UI primitives, and scoped under `.kaiten` so the host app is not polluted — see [Tailwind v4 host apps](#tailwind-v4-host-apps) for how that scope is built.

## Design tokens

Base tokens are sourced from [`@kaitencloud/theme`](https://www.npmjs.com/package/@kaitencloud/theme), the design-token package this package and the Kaiten console share. It is pinned in `devDependencies` and inlined at build time.

That package generates two builds from one set of token partials, so the values can
never drift apart:

| Consumer  | Tokens                                                     | Tailwind mapping          |
| --------- | ---------------------------------------------------------- | ------------------------- |
| Host apps | `global.css` — generic names on `:root` / `.dark`          | `theme-inline.css`        |
| This SDK  | `scoped.css` — `--ktn-*` under `.kaiten` / `.dark .kaiten` | `theme-inline-scoped.css` |

`--ktn-*` is the SDK's public override surface — the names `appearance.variables`
writes at runtime — and it is the same surface in light and dark. The generic names
(`--primary`, `--background`, …) are never declared inside `.kaiten`: nothing of the
SDK's inherits into host markup you pass as children, and nothing of the host's is
inherited by SDK components.

Tailwind's theme keys stay generic, so components are written with `bg-primary` and
read `--ktn-primary`. On top of that the SDK adds:

- SDK-only tokens (`--color-ktn-*`, `--font-ktn-*`, `--radius-ktn-*`, `--shadow-ktn-*`) extending the mapping so `--ktn-*` overrides are reachable as utilities.
- `--ktn-z-portal`, which the shared design system does not own.
- Brand-image swap rules and `.kaiten`-scoped base styles.

Published consumers get precompiled CSS via `@kaitencloud/react-ui/styles.css` — no Tailwind runtime required.

## Tailwind v4 host apps

Every rule the stylesheet ships is confined to the `.kaiten` subtree — utilities,
preflight and Tailwind's theme variables alike. Import order therefore does not
matter, and **none of the SDK's utilities can reach your app**: a rule like
`.bg-primary` is emitted as `.bg-primary:is(.kaiten,.kaiten *)`, so it applies
inside Kaiten components and nowhere else. This holds even when the host has its
own `.bg-primary` bound to its own tokens.

This holds for the **preflight** too, which needs saying because it is keyed on
_tag_ names rather than class names — `h1`–`h6`, `a`, `ul`/`ol`, `img`, `button`,
`table`, the universal `margin`/`padding`/`border` reset. `KaitenStyleRoot`
renders `<div class="kaiten">{children}</div>`, so your markup is inside the
boundary, and a tag-keyed rule scoped only to `.kaiten` would reset it. Those
rules therefore carry a second condition: they apply only to elements the SDK
rendered (`.ktn-own`), and explicitly not to markup you pass through one of its
components (`<Paywall>{yourContent}</Paywall>`).

Both directions are tested against the shipped stylesheet — that your markup keeps
its own styling, and that the SDK's still gets its reset.

- Import `@kaitencloud/react-ui/styles.css` once from your app shell or package entry.
- Do not add `node_modules/@kaitencloud/react-ui` or the SDK source folder to the host app's Tailwind `@source` / content scan. The SDK stylesheet is already compiled.
- Keep host design tokens (`--primary`, `--background`, `--radius`, etc.) owned by the host app. Customize Kaiten through `appearance.variables` or scoped `--ktn-*` variables.
- If you link this package locally during development, still consume the SDK stylesheet as its own CSS entry instead of letting the host Tailwind build scan and regenerate SDK classes.

To place the SDK in a cascade layer of your own — so your unlayered CSS can
override it wholesale — use the native form. The package ships unlayered precisely
because a layer would rank it below every unlayered host rule, so opting into one is
how you reverse that:

```css
@import "@kaitencloud/react-ui/styles.css" layer(kaiten);
```

Storybook includes `Integration/Tailwind v4 Host` to verify a host shell with conflicting generic tokens does not bleed into `.kaiten` scoped components.

### Which side wins inside `.kaiten`

Scoping settles what the SDK does to your app. The reverse — whether your CSS reaches
_into_ Kaiten and overrides `appearance.variables` — is settled by specificity:

| Host CSS                                           | Result inside `.kaiten`                          |
| -------------------------------------------------- | ------------------------------------------------ |
| Tailwind v4, or anything in `@layer`               | `appearance.variables` wins, either import order |
| Unlayered — Tailwind v3, plain CSS, most CSS-in-JS | `appearance.variables` wins, either import order |
| A rule naming `.kaiten` explicitly, unlayered      | You win — that is a deliberate override          |
| The SDK imported `layer(kaiten)` (see above)       | You win wholesale, however your CSS is emitted   |

The published stylesheet is unlayered, and every rule in it is scoped, so a collision is
decided on specificity: `.bg-primary:is(.kaiten,.kaiten *)` carries two classes against
a host's `.bg-primary`, and Kaiten keeps your tokens rather than silently adopting the
host's. Name `.kaiten` in your own selector and you are back to two classes against two,
the later sheet winning — so an override you meant still lands, while a name collision
you did not intend does not.

One consequence worth knowing if you are on Tailwind v4: an override you write _inside_
`@layer utilities` now loses, because layered always loses to unlayered. Write it
outside a layer, or import the SDK with `layer(kaiten)` and override it wholesale.

`Integration/Appearance precedence` asserts these rows against the published
`dist/kaiten.css` in a real browser, so the boundary is pinned rather than assumed.

## Theming and appearance

- `appearance` on `KaitenStyleRoot` is the single theming entry point: `appearance.variables` for color/font/radius token overrides, `modes` for per-colour-mode palettes, plus `elements` and `icons`.
- Preset themes are exported via `themes` (e.g. `appearance={themes.midnight}`). **No preset carries a `baseTheme`**: light/dark is the host's decision, and a preset that took it with it turned a light page into a dark island. Their surfaces live under `modes`, so they apply only where they were designed to. `themes.default` overrides nothing — it is the built-in look.
- Portal stacking is configurable via `appearance.zIndex` or the `--ktn-z-portal` CSS variable. `useKaitenPortalContainer()` returns the mount node for a host's own portals, so the tokens under `.kaiten` reach them.

### Colour mode

`appearance.baseTheme` takes `"light"`, `"dark"`, or `"system"`. Omit it and the
SDK follows the host page: a `dark` class on any ancestor darkens the widgets
with it, which is what an embedded component should do when nobody said otherwise.

```tsx
<KaitenStyleRoot appearance={{ baseTheme: "system" }} />
```

`"system"` follows the visitor's `prefers-color-scheme` and keeps following it if
they change it mid-session. Reach for it when the host page themes itself from the OS
setting. The preference is read during render, so the first paint is already correct —
there is no flash of the light theme. Server rendering has no preference to read and
defers to the host; hydration corrects it.

### Overriding a fill keeps its text readable

Set `colorPrimary` to your brand colour and the label on it stays legible: when a
fill is overridden without its `…Foreground` pair, a readable text colour is derived
from the fill rather than inheriting one that may not contrast.

```tsx
// A light brand colour: the button label becomes dark automatically.
<KaitenStyleRoot appearance={{ variables: { colorPrimary: "#7dd3fc" } }} />

// Prefer your own pairing? Pass it and nothing is derived.
<KaitenStyleRoot
  appearance={{ variables: { colorPrimary: "#7dd3fc", colorPrimaryForeground: "#082f49" } }}
/>
```

The derivation is a fallback, not a colour system — it picks black or white by
contrast, and only for values it can parse (`#rgb` / `#rrggbb`). An `oklch()` or
`var()` fill is passed through untouched, so pair it yourself.

### A palette per colour mode

`variables` is what holds in either mode — a brand colour, a radius, a typeface.
Surfaces usually are not: a slate page needs light text, and the same values in
a light page would be unreadable. Put those under `modes`:

```tsx
<KaitenStyleRoot
  appearance={{
    variables: { colorPrimary: "#7c3aed" }, // both modes
    modes: {
      light: { colorBackground: "#f8fafc" },
      dark: { colorBackground: "#0f172a" }, // each derives its own surfaces
    },
  }}
/>
```

The choice is made by the **cascade**, not by React: the stylesheet reads every
token through a per-mode namespace and the style root writes both inline. So it is
still right when the host drives dark with a CSS class the SDK never sees, and
during server rendering, where no preference is knowable — no flash, no injected
stylesheet, no CSP nonce. A key in both wins under `modes`, for that mode only.

### Overriding the background rebuilds the surfaces on it

`colorBackground` brings its companions the same way a fill does — one level up.
Set a dark background alone and the card, popover, muted, secondary, border and
input surfaces are rebuilt around it (cards elevate slightly, neutrals step
toward the text, every derived surface gets readable text of its own), instead
of keeping the light theme's white cards on your dark page:

```tsx
// A complete dark neutral set from one value.
<KaitenStyleRoot appearance={{ variables: { colorBackground: "#0f172a" } }} />
```

Any surface you set explicitly wins over the derivation, token by token.

### Theme playground

A live editor over `appearance.variables`, in Storybook under
**Appearance → Theme playground**:

```bash
vp run storybook
```

Change a token and real components — `PlanBadge`, `PricingTable`, `Paywall`,
`CustomerPortal` — react in light and dark side by side. Start from any preset in
`themes`, then copy a config that is ready to paste into your style root.

What it will and will not emit is the point of the tool:

- **Only what you changed.** An untouched editor produces `{}`, not a snapshot of all
  thirty defaults. A config that restates today's token values stops tracking them the
  moment they move — which is exactly how `themes.default` once drifted into shipping a
  failing contrast ratio.
- **Never a derived pair.** Set `colorPrimary` alone and the editor shows you the
  foreground and hover it will derive, marked `derived`, and leaves them out of the
  output. Freezing a derived value into your source decouples it from the fill.
- **Variables only.** `elements` takes class names that must exist in _your_ CSS build,
  which a generator cannot know, so anything it emitted there would be a string that
  silently does nothing. `icons` takes React components. Both stay hand-written.

The output takes effect in any host stylesheet arrangement; see
[Which side wins inside `.kaiten`](#which-side-wins-inside-kaiten) for the one case
that overrides it — a host that imports the SDK into a cascade layer of its own.

#### Importing a shadcn theme

Paste a `globals.css` (or just its `:root` / `.dark` block) into **Import from shadcn**.
Bare HSL triplets (`222.2 47.4% 11.2%`), `hsl(…)` and hex are all converted; anything
else — `oklch(…)`, for instance — is copied verbatim, which is valid CSS but leaves the
swatch and the derived pair unavailable.

The import reports rather than guesses. Tokens with no Kaiten counterpart (`--chart-1`,
`--sidebar-*`) are listed as skipped; Kaiten keys shadcn cannot fill are split into
those that get derived from their fill and those with no source at all
(`colorSuccess`, `colorDestructiveSubtle`, and their foregrounds), which keep the SDK
default and may not match the palette you imported.

`:root` and `.dark` are offered separately, and `modes` is where both go — one
`appearance` object serves the two colour modes, resolved by the cascade.

## Known limitations

- `CheckoutFlow` and `CheckoutSummary` need `mode="customer-session"` and a Kaiten server that ships billing, and are experimental until it does (see [STABILITY.md](STABILITY.md)). No total is computed in the browser: the server prices every selection (a checkout's `dryRun`), and the lines and total are shown as it says them, even when the lines do not add up to the total. A voucher code is typed once and sent in the body of the checkout: it is not left in the field after "Apply", in the address or in a log, and a code the server refuses is said to be unusable, with no reason.
- A `CheckoutFlow` for a customer with no payment method sends them to the provider's page, in a popup or, when popups are blocked, in place of the page, and goes on when they are back: **mount it on the page they come back to** (its `returnUrl` is the current page, minus its fragment and any `kaiten_*` parameter, unless you say another, on an origin your publishable keys allow). It takes the plan from the catalog (what `PricingTable`'s `onSelectPlan` hands over) and, to offer add-ons, a provider that reads the catalog with a publishable key, or add-ons of your own. The hooks it is made of, for a checkout drawn in your own design system, are in [`@kaitencloud/react/billing`](../react/README.md#billing-hooks).
- Prices come from the catalog: the one the host supplies, or with Kaiten billing the public catalog. `PricingTable` shows a plan's default monthly or annual flat fee, never a quarterly or usage price under "/month", and links a plan that is not self-serve to its `selfServeCtaUrl` ("Contact us"). `onSelectPlan` receives the price the card showed. A plan that sells nothing for the chosen interval shows the fee it has, with its own period: "/month" under "Annual" for a plan with a monthly fee only, "every 3 months" for a plan whose only default fee is quarterly. A plan with no default fee shows the "Custom" label, since a price that is not the plan's default is not its headline.
- When the catalog cannot be read, whatever the reason (a publishable key used from an origin its owner did not allow answers 403 `PublicAuth.OriginNotAllowed`), the table shows an error with a "Try again" button, never an empty page; the error itself is `usePlans().error`, a `KaitenError` with its `status` and `code`.
- `CurrentPlan` reads the licence, and a customer session has none: it shows the plan the portal names, the price of the subscription ("€49.00/month", "€135.00 every 3 months") unless it is over, and where the subscription stands (see below). There is no version and no type to show, and it does not make them up. On a session bound to the customer only, with no plan, it renders nothing.
- `CustomerPortal` under `mode="customer-session"` changes nothing but what the customer asks: **cancelling** ends the subscription at the end of its period, never at once (a trial ends at once, and the customer is told so), and can be withdrawn until then; **an add-on's stepper** sets the quantity the instance holds, one change a press, beside the add-ons it holds offers those of the catalogue that fit the plan and that a live subscription can be billed (a default fee in its currency, for its billing period), asks before the last unit goes and says that a change is billed from the next renewal with nothing refunded; a change the API refuses is said with its reason (an add-on in another currency than the subscription's, one that does not fit the plan or its billing period, more units than it allows, another version held, a plan that waits for its payment); when the API asks to wait for a billing period that is being closed, the hook waits and the section says so, and a second refusal is the answer. `InvoiceList` offers "Pay" only on an invoice that is open (`PUSHED` or `PAYMENT_FAILED`) and a PDF where the invoice has one, both opening in a tab that has no handle on the page (`rel="noopener noreferrer"`); an invoice waiting for a 3-D Secure confirmation reads like a declined one, since nothing in the invoice tells them apart yet; the section is absent when the portal says the customer's invoices are not theirs to see (`capabilities.invoices`). `VoucherEntry` only checks a code: it is typed once, sent in the body of the check and emptied from the field, it says one sentence for every refusal, and a check refused for coming too often says when to come back. The note beside a limit (`i`) opens on a press and writes the figures the server sent: "(100,000 base) × 2 voucher = 200,000", never a voucher's code, which the portal does not carry.
- **The keyboard keeps its place.** A control that is pressed and then replaced (cancelling a subscription, removing the last unit of an add-on, applying a voucher, subscribing) sends focus to what took its place, and a stepper or a button that waits for its answer or is at its limit stays focusable and says so with `aria-disabled` rather than `disabled`. A code typed in the checkout's voucher field and not applied holds "Subscribe" back, with a sentence saying so, so that it is never silently left out of the checkout.
- `PaymentMethodCard` shows the labels the provider gave of the payment method the invoices are charged to ("Visa •••• 4242", "Expires 12/2030", an "Expired" or "Failed" badge when it is), never a number, and sends the customer to the provider's hosted page in place of the page to add or replace it. **Mount it on the page they come back to**: its `returnUrl` is the current page, minus its fragment and any `kaiten_*` parameter, unless you say another; on their return the card confirms with the API that a payment method was saved, reads the portal again and shows the new labels, and a confirmation that did not go through says so with a way to check again. The provider keeps one currency per customer, so a customer with no live subscription is set up in the currency of their last subscription, or the catalog's when it sells in one: pass `currencyCode` otherwise. The card is not there at all when the portal says the provider cannot capture a payment method (an organization billed outside any provider), and it is an element of `CustomerPortal` under a customer session.
- `CurrentPlan`, `BillingSummary` and `Paywall` say where a customer session's subscription stands, as the portal says it and never from the end date of a licence: running (it renews on a day), in its trial (it ends on one), canceled and ending with its period ("Ends on"), past due ("Payment failed", with a sentence, and no countdown: billing status closes no wall and removes no access), over ("Canceled", with no price), or none (a session bound to the customer only, or an instance that was never subscribed). A plan change that is scheduled is said once ("Changes to €490.00/year on …"). `BillingSummary` also shows the price of the subscription and the labels of the payment method ("Visa •••• 4242 · 12/2030") for whatever its `billing` prop leaves out. A `Paywall` carries the subscription's state in `data-subscription`, says a sentence under its reason when the subscription explains the wall (a trial or a cancellation that ends, a payment that failed, a subscription that is over), and offers "Subscribe" in place of "Upgrade" to a customer whose portal says they can buy a plan by themselves.
- **Usage is read the way the Kaiten console reads it.** `UsageMeters`, `EntitlementStatusBar`, `BillingSummary`, `IncludedFeatures` and the bar of a `Paywall` measure a quota against the most its grant lets through (the granted value plus its allowance, `maximumAllowedUsage`) and say one of six states: healthy (under 50% of that), watch (50%), near limit (80%), in allowance (past the granted value, under the ceiling, whatever the saturation), limit reached (on the ceiling, the last usage the API accepts) and over limit (past it). Near limit and in allowance are amber, limit reached and over limit red, the rest green; `IncludedFeatures` names only the four states that call for a look. With an allowance the bar's track runs to the ceiling, a hatched band covers the allowance and a tick marks the granted value; the bar carries its state as `data-usage-state`. The percentage next to a quota is of the granted value and is not capped (105% inside an allowance is true), and `BillingSummary` raises one sentence, about the most severe quota. A quota whose usage could not be read has no state: `BillingSummary` says so instead of showing `0 / limit`. This is the styled components' reading only; the headless core's `status` and `percentageUsed`, which `Gate`, `useEntitlementCheck` and `usePaywallTrigger` use, keep their own rule. An `unstyled` rendering keeps its markup, except that `BillingSummary` says a failed usage read in words there too.
- `PricingTable` shows every published plan, one column each. Several versions of one license family can be published at once, and each gets its own column; a host that publishes more than one should filter the catalog, or pass `hidePlans`.

## Development

```bash
vp install
vp pack
vp check
vp test
vp run storybook
```

`@kaitencloud/react` must be built first — this package resolves it through its
`dist/`, so a stale build masks drift between the two.

## Visual regression

The SDK ships a Playwright-based visual regression suite that snapshots an
allowlist of Storybook stories. The baselines committed under
`tests/visual/__screenshots__/` are the `-linux.png` renderings CI compares
against; a macOS run writes its own `-darwin.png` files, which git ignores.

### Running the suite

```bash
# CI runs this end-to-end:
vp run build-storybook
vp run test:visual

# Re-record this machine's baselines (the committed Linux ones come from CI, below)
vp run test:visual:update

# Open the HTML diff report after a failing run
vp run test:visual:report
```

`scripts/serve-storybook.mjs` serves `storybook-static/` over loopback while
the tests run. Playwright's `webServer` config boots it automatically.

### Updating the committed baselines

The committed `-linux` baselines are rendered only in the Playwright container CI
uses: sub-pixel anti-aliasing differs by CPU architecture, OS and font stack. After an
intentional UI change, run `vp run baselines:update` from the repository root. It
dispatches the **Update visual baselines** workflow on your branch, which commits
the new baselines back to it.

### Adding or removing stories

Edit the `STORIES` allowlist in
[`tests/visual/stories.ts`](tests/visual/stories.ts). The `storyId` is
the Storybook URL `?id=` value (kebab-case: `<title-slug>--<export-slug>`). Run
`vp run test:visual:update` after each addition to record the baseline.
