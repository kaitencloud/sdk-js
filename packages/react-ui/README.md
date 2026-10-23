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

| Component                   | Description                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| `<KaitenStyleRoot />`       | The `.kaiten` scope root: tokens, colour mode, portal container              |
| `<PricingTable />`          | Public pricing table with annual toggle, add-ons, and feature comparison     |
| `<FeatureComparison />`     | Standalone feature-by-feature comparison table                               |
| `<CustomerPortal />`        | Authenticated licensing portal composed from modular elements                |
| `<CurrentPlan />`           | Current plan, renewal info, credits, and portal action buttons               |
| `<IncludedFeatures />`      | The plan's feature catalog (limit + status); unlimited rows are collapsed    |
| `<UsageMeters />`           | Finite, metered quotas with live usage and the console's usage states        |
| `<AddOns />`                | Available and active add-ons plus credit balances                            |
| `<FlagsSummary />`          | Customer feature flags and rollout status                                    |
| `<InvoiceList />`           | A customer session's invoices, to pay and to download                        |
| `<VoucherEntry />`          | A voucher code: checked before a subscription, previewed then applied on one |
| `<PaymentMethodCard />`     | The payment method a customer session pays with, to add or replace           |
| `<TrialBanner />`           | The trial an instance is in: countdown, what its end charges, the card       |
| `<Paywall />`               | Paywall aware of both entitlements and feature flags                         |
| `<PlanBadge />`             | Compact badge showing the customer's current plan                            |
| `<UpgradeButton />`         | Button wired to the recommended upgrade action                               |
| `<CheckoutFlow />`          | A customer's checkout of a plan: choices, what is due, payment, outcome      |
| `<AnonymousCheckoutFlow />` | A visitor's checkout, with no account: e-mail, security check, payment       |
| `<CheckoutSummary />`       | What is due today for a selection: the server's lines and total              |
| `<EntitlementStatusBar />`  | Compact quota bar that warns before a metered quota reaches its ceiling      |
| `<FeatureCatalog />`        | Searchable catalog of what each plan grants, with lifecycle stage badges     |
| `<BillingSummary />`        | The subscription (or licence term) and current-cycle usage, plus billing     |
| `<KaitenBranding />`        | Shared branding footer with capability-aware hiding                          |

`Gate`, `Show`, `KaitenLoaded`/`Loading`/`Failed` and `KaitenErrorBoundary` are
the core's control primitives, re-exported here. They render only what you give
them, so they need no style root.

### Component notes

- `CustomerPortal` accepts `elements` as the current composition API. Under `mode="customer-session"` it is the customer's own portal: the plan with the controls to cancel the subscription at the end of its period and to withdraw that, the limits with a note on where each comes from, the add-ons it holds with a panel to change them, the invoices and a voucher check. See [Known limitations](#known-limitations).
- `AnonymousCheckoutFlow` sells a plan to a visitor with no account, under a `mode="public"` or `mode="static"` provider given an `anonymousCheckoutClient`, and draws nothing unless the catalogue says the publishable key may start an anonymous checkout. It is a component of its own rather than a mode of `CheckoutFlow`, which is a customer's and needs a session. The visitor chooses the billing period, gives an email (and a name, with `collectName`, which only your `onStarted` and `onSubscribed` get), passes the Cloudflare Turnstile check, and sees what the server says is due before they confirm; a free plan starts with one button. The payment method is saved on the provider's page, in a popup or in place of the page, and the page the visitor comes back to (mount the flow there; `returnUrl` is the current page by default) sees the checkout through. At the end the visitor is sent to your `successUrl`, or told that the order is registered for their address: Kaiten sends no email to your buyers, so a host whose own email follows says so in `localization.anonymousCheckout.completedFor`. The review of a paid plan words its price as the card does ("$79.00/month") and says when it renews, from the period the server billed; a trial that asks for a card says what it will bill and from when, from the catalogue price; a trial that asks for none says that nothing is charged unless the visitor adds one. An amount that changed since it was shown is a warning, announced and focused; one that changed after the payment method was saved is refused, and the review, which can only show what was shown before, draws the refusal and "Start again" and not those figures. A check that loaded and failed is told apart from a script that a blocker kept out (`checkError` and `checkFailed`), and a check that passed is not said so beside the refusal of the start that used it. `successUrl` is opened as written, so write it yourself and never from a request parameter of the page; `clientReferenceId` and everything `onSubscribed` reports are the visitor's browser's, and the vendor's backend links the buyer to an account from the signed `checkout_session.v1.completed` event. **The styled flow is the plan, the billing period, the email and, if the page asks, the name**: it has no field for a voucher code or for add-ons. A page that sells either builds its form on `useAnonymousCheckout`, which takes a code (`setVoucherCode`) and add-ons (`setAddonQuantity`) and names their refusals (`voucher_invalid`, `addon_refused`), and words them itself. Allow `https://challenges.cloudflare.com` in your Content-Security-Policy (`script-src`, `frame-src`, `connect-src`), or the check never appears. See `useAnonymousCheckout` in [`@kaitencloud/react`](../react/README.md#anonymous-checkout).
- For declarative gating use `<Show entitlement="…" fallback={…}>` (conditional render) or `usePaywallTrigger` for the raw decision; `Paywall` is the overlay/upsell component.
- `Paywall` renders hard mode as an accessible modal: the native `<dialog>` element opened with `showModal()`, in the top layer above any z-index the host uses, with focus held inside and Escape as the exit. Target it as `dialog[data-slot="dialog-content"]`; its overlay is the `::backdrop`. The SDK ships no Radix, and Base UI only for the radio group that draws `CheckoutFlow`'s billing periods; unstyled, they are native radios.
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

- `CheckoutFlow` and `CheckoutSummary` need `mode="customer-session"` and a Kaiten server that ships billing. Like every styled component, they are experimental (see [STABILITY.md](STABILITY.md)); the hooks they are made of are stable. No total is computed in the browser: the server prices every selection (a checkout's `dryRun`), and the lines and total are shown as it says them, even when the lines do not add up to the total. A voucher code is typed once and sent in the body of the checkout: it is not left in the field after "Apply", in the address or in a log, and a code the server refuses is said to be unusable, with no reason.
- A `CheckoutFlow` for a customer with no payment method sends them to the provider's page, in a popup or, when popups are blocked, in place of the page, and goes on when they are back: **mount it on the page they come back to** (its `returnUrl` is the current page, minus its fragment and any `kaiten_*` parameter, unless you say another, on an origin your publishable keys allow). It takes the plan from the catalog (what `PricingTable`'s `onSelectPlan` hands over) and, to offer add-ons, a provider that reads the catalog with a publishable key, or add-ons of your own. Of those it offers only the ones Kaiten attaches beside the price chosen, by the rule the portal offers them by, each at its fee for that billing period: an add-on with no fee for the period the customer picks (seats sold by the month, beside a plan bought by the quarter) is not offered, and a quantity chosen for it leaves the selection. An instance whose subscription ended can hold add-ons, which a subscribe keeps and bills: the flow lists them as held, offers no other add-on of their families, and a billing period that cannot bill them cannot be chosen. A refusal of an add-on names it, and says why, in place of the summary. The flow waits until the add-ons are known (yours, or the catalogue and the portal read) before it starts, so that the quantities you start it from are held to them and no selection Kaiten would refuse is priced; an add-on you hand over in the shape of 1.0, with a `price` and no `billingPrices`, is offered where its currency and its interval are the price's. Once the customer subscribes, it says what became of the payment; while a current Kaiten leaves the subscription waiting for its first payment (`INCOMPLETE`), it says that the plan starts once the payment is confirmed rather than that the customer is subscribed, beside the page to confirm it, or a declined card and the ways out of it. A customer who comes back to the flow while the subscription still waits (after a reload, or a confirmation window they closed) is refused a checkout, since the subscription is live, and is told the same: that the plan starts once the payment is confirmed, with "Pay invoice" while the activation invoice is open, and that they are subscribed once it is paid. The hooks it is made of, for a checkout drawn in your own design system, are in [`@kaitencloud/react/billing`](../react/README.md#billing-hooks).
- Prices come from the catalog: the one the host supplies, or with Kaiten billing the public catalog. `PricingTable` shows a plan's default monthly or annual flat fee, never a quarterly or usage price under "/month", and links a plan that is not self-serve to its `selfServeCtaUrl` ("Contact us"). `onSelectPlan` receives the price the card showed. A plan that sells nothing for the chosen interval shows the fee it has, with its own period: "/month" under "Annual" for a plan with a monthly fee only, "every 3 months" for a plan whose only default fee is quarterly. A plan with no default fee shows the "Custom" label, since a price that is not the plan's default is not its headline.
- When the catalog cannot be read, whatever the reason (a publishable key used from an origin its owner did not allow answers 403 `PublicAuth.OriginNotAllowed`), the table shows an error with a "Try again" button, never an empty page; the error itself is `usePlans().error`, a `KaitenError` with its `status` and `code`.
- `CurrentPlan` reads the licence, and a customer session has none: it shows the plan the portal names, the price of the subscription ("€49.00/month", "€135.00 every 3 months") unless it is over or waits for its first payment, and where the subscription stands (see below). There is no version and no type to show, and it does not make them up. On a session bound to the customer only, with no plan, it renders nothing.
- `CustomerPortal` under `mode="customer-session"` changes nothing but what the customer asks: **cancelling** ends the subscription at the end of its period, never at once (a trial ends at once, and so does a subscription that waits for the first payment of its checkout, whose plan then never starts; neither is charged, and the customer is told so before confirming), and can be withdrawn until then; **the add-ons** are changed in a panel, never by a single press: the `AddOns` card lists what the instance holds (its quantity and the price of a unit), and "Manage add-ons", on that card and among the plan's actions, opens a modal on the native `<dialog>` (the browser's top layer, focus held inside it, Escape to close, focus given back to the button). In it the customer sets quantities with a stepper, among the add-ons the instance holds and those of the catalogue that fit the plan and that Kaiten attaches to a live subscription (priced in its currency and, for a paid add-on with flat fees, with a default fee for its billing period; a metered-only, free or custom add-on has no period to be checked for), never a second version of a family it holds; nothing is sent while they do. A summary says, for each add-on changed, the change ("Extra seats 3 → 4"), its recurring fee at the add-on's own price ("+1 × €10.00/month", never a total: what the renewal comes to is the server's) and when it is billed: an increase takes effect at once and is billed from the renewal on the subscription's `currentPeriodEnd`, with a note that a higher quantity can also be billed for the current period at the most held during it; a lower quantity or a removal is said to take effect at once, the renewal billing what is left with nothing refunded (the contract's portal add-ons carry `pendingQuantity`, a decrease scheduled for the renewal, but the client does not map it yet and the panel does not read it, so it does not say a decrease as scheduled); a renewal that changes the billing period, by a plan change scheduled for it, says the fee of the new period, read from the catalogue's version of the add-on; in a trial, a change is billed from the trial's end, which bills what is held then, with no word of the current period, since a trial is never trued up; a subscription that ends says it is not renewed, and without a live one nothing is billed. A subscription that waits for the payment of its checkout has no panel: its cards say that add-ons can be changed once the payment is confirmed. "Confirm changes" sends one change per add-on, in the order of the list, the portal read again after each, and stops at the first the API refuses, which it says with its reason and the add-on's name (an add-on no longer for sale, one in another currency than the subscription's, one that does not fit the plan or its billing period, more units than it allows, another version held, a plan that waits for its payment, a session with no instance); the changes before it went through, and the summary keeps the rest. When the API asks to wait for a billing period that is being closed, the hook waits and the panel says so, and a second refusal is the answer. "Cancel", Escape, or closing the panel while it sends, drops what is not sent. Unstyled, the panel is the bare `<dialog>`, centred in the top layer with none of the SDK's chrome, and plain buttons. `InvoiceList` offers "Pay" only on an invoice that is open (`PUSHED` or `PAYMENT_FAILED`) and a PDF where the invoice has one, both opening in a tab that has no handle on the page (`rel="noopener noreferrer"`); an invoice waiting for a 3-D Secure confirmation reads like a declined one, since nothing in the invoice tells them apart yet; the section is absent when the portal says the customer's invoices are not theirs to see (`capabilities.invoices`). `VoucherEntry` only checks a code: it is typed once, sent in the body of the check and emptied from the field, it says one sentence for every refusal, and a check refused for coming too often says when to come back. The note beside a limit (`i`) opens on a press and writes the figures the server sent: "(100,000 base) × 2 voucher = 200,000", never a voucher's code, which the portal does not carry.
- **The keyboard keeps its place.** A control that is pressed and then replaced (cancelling a subscription, applying a voucher, subscribing) sends focus to what took its place, a closed panel gives it back to the button that opened it, and a stepper or a button that waits for its answer or is at its limit stays focusable and says so with `aria-disabled` rather than `disabled`. A code typed in the checkout's voucher field and not applied holds "Subscribe" back, with a sentence saying so, so that it is never silently left out of the checkout.
- `VoucherEntry` depends on the subscription the portal names. On a **live subscription** (in its trial, active or past due) a code is checked with a dry run that changes nothing, and the customer sees what it gives (a discount from their next invoice, for how many invoices; a boost or a flag grant that takes effect now, and until when) before they press **Apply** or **Not now**. A subscription that **waits for its first payment** has no field: the portal says a code can be added once the plan has started. With **no subscription** the code is only checked, and the checkout that carries it applies it. The redemptions in force are listed under the field, never with their codes. Every refusal of a code is the same sentence, whatever the reason; a check refused for coming too often says when to come back. The code is typed once: it is sent in the body of the call, emptied from the field at once, and held in memory by `useRedeemVoucher` between the check and the apply, and nowhere else.
- `PaymentMethodCard` shows the labels the provider gave of the payment method the invoices are charged to ("Visa •••• 4242", "Expires 12/2030", an "Expired" or "Failed" badge when it is), never a number, and sends the customer to the provider's hosted page in place of the page to add or replace it. **Mount it on the page they come back to**: its `returnUrl` is the current page, minus its fragment and any `kaiten_*` parameter, unless you say another; on their return the card confirms with the API that a payment method was saved, reads the portal again and shows the new labels, and a confirmation that did not go through says so with a way to check again. The provider keeps one currency per customer, so a customer with no live subscription is set up in the currency of their last subscription, or the catalog's when it sells in one: pass `currencyCode` otherwise. The card is not there at all when the portal says the provider cannot capture a payment method (an organization billed outside any provider), and it is an element of `CustomerPortal` under a customer session.
- `TrialBanner` shows the trial of the instance a customer session is bound to, from the portal's `trial` block: a countdown to its end (in days, then hours, then minutes), the date, what the end charges (the server's figure, with its billing period; "nothing will be charged" when the server says the end charges nothing, and "would be charged" while no card is on file, since the portal gives what the end would charge and not what happens to a trial without a card) and the card it goes to, or a prompt to add one. "Add a card" is offered while the portal says the provider can capture one and none is on file, and works as the payment method card does: **mount the banner on the page the customer comes back to**, where it confirms the card and shows it. "Cancel" is offered while the portal lets this customer cancel; it asks first and says the trial ends at once with nothing charged, and `onTrialEnded` is called once the portal was read again. It draws nothing outside a trial, while the portal loads, and from a server that does not serve the block yet. Pass `now` to fix the instant the countdown counts from (a server render, a test), or `trial` to draw a trial you hold. It is not an element of `CustomerPortal`: put it where your customer should see it, at the top of your app for one.
- `CurrentPlan`, `BillingSummary` and `Paywall` say where a customer session's subscription stands, as the portal says it and never from the end date of a licence: running (it renews on a day), in its trial (it ends on one), canceled and ending with its period ("Ends on"), past due ("Payment failed", with a sentence, and no countdown: billing status closes no wall and removes no access), over ("Canceled", with no price), waiting for the first payment of its checkout ("Awaiting payment": the plan it bought starts once the payment is confirmed, which it says, with no price and no renewal, while the instance keeps the plan and the limits it had), or none (a session bound to the customer only, or an instance that was never subscribed). A plan change that is scheduled is said once ("Changes to €490.00/year on …"). `BillingSummary` also shows the price of the subscription and the labels of the payment method ("Visa •••• 4242 · 12/2030") for whatever its `billing` prop leaves out. A `Paywall` carries the subscription's state in `data-subscription`, says a sentence under its reason when the subscription explains the wall (a trial or a cancellation that ends, a payment that failed, a subscription that is over, a plan bought that starts once its payment is confirmed), and offers "Subscribe" in place of "Upgrade" to a customer whose portal says they can buy a plan by themselves.
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
