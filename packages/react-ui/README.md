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
localization and the session switch are the core's; they are documented in
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
| `<UsageMeters />`          | Finite, metered quotas with live usage and threshold states               |
| `<AddOns />`               | Available and active add-ons plus credit balances                         |
| `<FlagsSummary />`         | Customer feature flags and rollout status                                 |
| `<Paywall />`              | Paywall aware of both entitlements and feature flags                      |
| `<PlanBadge />`            | Compact badge showing the customer's current plan                         |
| `<UpgradeButton />`        | Button wired to the recommended upgrade action                            |
| `<CheckoutSummary />`      | Lightweight plan plus add-on checkout shell                               |
| `<EntitlementStatusBar />` | Compact quota bar that warns before a metered entitlement runs out        |
| `<FeatureCatalog />`       | Searchable catalog of what each plan grants, with lifecycle stage badges  |
| `<BillingSummary />`       | The licence's term and current-cycle usage, plus host-supplied billing    |
| `<KaitenBranding />`       | Shared branding footer with capability-aware hiding                       |

`Gate`, `Show`, `KaitenLoaded`/`Loading`/`Failed` and `KaitenErrorBoundary` are
the core's control primitives, re-exported here. They render only what you give
them, so they need no style root.

### Component notes

- `CustomerPortal` accepts `elements` as the current composition API.
- For declarative gating use `<Show entitlement="…" fallback={…}>` (conditional render) or `usePaywallTrigger` for the raw decision; `Paywall` is the overlay/upsell component.
- `Paywall` renders hard mode as an accessible modal: the native `<dialog>` element opened with `showModal()`, in the top layer above any z-index the host uses, with focus held inside and Escape as the exit. Target it as `dialog[data-slot="dialog-content"]`; its overlay is the `::backdrop`. The SDK ships no Radix and no Base UI.
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

- `CheckoutSummary` is a redirect shell: no checkout session API backs it, and the total it shows is the sum of the items the host gave it. With Kaiten billing, the amount due is the server's (a checkout's `dryRun`); the component will be rebuilt on it, and is experimental until then (see [STABILITY.md](STABILITY.md)).
- Prices come from the catalog: the one the host supplies, or with Kaiten billing the public catalog. `PricingTable` shows a plan's default monthly or annual flat fee, never a quarterly or usage price under "/month", and links a plan that is not self-serve to its `selfServeCtaUrl` ("Contact us"). `onSelectPlan` receives the price the card showed.
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
