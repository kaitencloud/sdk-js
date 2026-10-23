# Storefront example

A small shop on Kaiten billing: a **pricing table**, a **checkout** and a **customer portal**,
in a Vite app, with the backend routes that let its page act for one customer, or for a visitor who
signs up, and a checkout that a visitor with no account can buy from. It is the whole way a customer takes through the React packages, from choosing a plan to
managing it, and the code to read when you wire your own.

```
/                     PricingTable    the plans of the catalogue, from a publishable key
/checkout/:plan       CheckoutFlow    the choices, what is due today, the card, the outcome
                      AnonymousCheckoutFlow   the same for a visitor with no account: email, security check
/portal               CustomerPortal  the plan, the limits, the invoices, cancellation, Change plan
/sales                                where Change plan and the plans priced on request lead
/journey                              a presenter's walk through the payment lifecycle
```

It runs against a **stand-in for Kaiten** unless you give it a Kaiten, so you can run it, read
it and test it with no account, no stack and no network.

```bash
vp install
vp run -r build
cd examples/storefront
vp dev            # http://localhost:5173
```

The stand-in starts as **one customer**, signed in, so that you land on a pricing table you can buy
from. There are three ways in, and the **Journey** page starts the stand-in in the last two:

- **One customer**, signed in for everyone: the default.
- **A visitor who buys with no account**, when the publishable key opens the anonymous checkout: the
  page sends them to a checkout of their own, and Kaiten makes the customer when it completes. Start
  **A visitor buys with no account**; [the section below](#visitors-who-buy-with-no-account) says what
  happens.
- **A visitor who signs up** first, when the key does not open it: a "Create your account" step, then the
  checkout of a customer. Start **A visitor signs up and buys a plan**; [that section](#visitors-who-sign-up)
  says what happens. Against your own Kaiten with no customer named, this is the mode you start in, or the
  one above if your key opens the anonymous checkout.

## The theme

The header has two controls, and they are two separate choices: the **colour mode** (Light / Dark /
System) and the **theme** (Kaiten, Claude or Neo Brutalism). Every theme has a Light and a Dark, and
System follows the operating system under any of them. Each choice is remembered in `localStorage`
under its own key (`storefront-theme` and `storefront-palette`, wrapped in try/catch: a blocked
storage gives System and Kaiten), and an inline script in `index.html` puts both on `<html>` before
the first paint, so that a dark page never starts light and a themed one never starts in the Kaiten
look.

**Kaiten** is the storefront's own look and overrides nothing. **Claude** and **Neo Brutalism** are
themes taken from [tweakcn.com](https://tweakcn.com), pasted as they were exported and kept in the
shape shadcn/ui gives a theme: a block of tokens for light and one for dark (`--background`,
`--primary`, `--radius`, `--font-sans`, `--shadow-*`, and so on), as
[`src/themes/claude.ts`](src/themes/claude.ts) and
[`src/themes/neo-brutalism.ts`](src/themes/neo-brutalism.ts). The Kaiten console is meant to let a
vendor make a theme the same way, so the storefront consumes that exact shape.

```
src/themes/shadcn.ts          the shape of a theme, and how an override is applied to an export
src/themes/claude.ts          a tweakcn theme as exported, and the overrides listed beside it
src/themes/neo-brutalism.ts   the same
src/themes/to-appearance.ts   a theme to the components' KaitenAppearance: the one place
src/themes/page-css.ts        a theme to the page's own tokens (--bg, --surface, --brand, ...)
src/themes/palettes.ts        the themes of the picker
src/palette.ts                the choice: state, storage, <html data-palette>
```

### One mapper to the components

[`toAppearance()`](src/themes/to-appearance.ts) turns a theme into the `variables`, `modes.light`,
`modes.dark` and `elements` of a `KaitenAppearance`, and `app.tsx` passes it as
`<KaitenStyleRoot appearance={{ baseTheme, ...appearance }}>`. It is small, pure and unit-tested
([`tests/themes.test.ts`](tests/themes.test.ts)), because it is where a console-made theme would plug
in: give it the two blocks of tokens and it gives back what the components take.

- Every shadcn colour that has a `KaitenVariables` key is mapped per mode, and **every foreground is
  passed explicitly**: the SDK derives a missing one from a hex fill only, and a theme made in a
  console may well arrive in oklch (the mapper passes any CSS colour through as it is).
- Hover fills have no shadcn token. The mapper derives them: a tenth toward black under a light label
  and toward white under a dark one (the other way for a fill with no room left, a near-white one under
  dark text), and `color-mix()` for a colour that is not hex. The SDK's own
  derivation would give a purple hover to such a colour.
- The radius and the sans font hold in both modes, so they go to `variables`.

### The page follows

The storefront's own tokens read from the same theme object, not from a second copy of its values.
[`src/themes/page-css.ts`](src/themes/page-css.ts) turns each block into rules scoped by
`:root[data-palette="claude"]` and `:root[data-palette="claude"].dark`, and `vite.config.ts` puts them
in the `<head>` of the page when it is built or served, which is what lets them be there before the
first paint (a stylesheet written when the app starts would show the Kaiten look for a moment).
`--bg`, `--surface`, `--text`, `--text-muted`, `--border`, `--brand`, `--brand-contrast`, `--focus`,
`--radius`, `--font` and the shadows come straight from the tokens; `--brand-hover` is derived like the
components' hover, and `--brand-text` (the brand colour as text) and `--brand-soft` (its tint) are
derived so that the brand colour still reads at 4.5:1 on the page, on a card and on its own tint. The
page's corners all follow the one radius. With Kaiten selected none of this applies: its screenshots
are pixel for pixel those from before the picker existed, the header's new control apart.

The values are written into CSS as they are. They are constants of the storefront here; a theme that
comes from somewhere else has to be validated before it goes through `page-css.ts`.

### What was changed in the two themes

The values are kept as exported. The few that fail WCAG AA (4.5:1) for text are changed as a listed
override next to the export (`claudeOverrides`, `neoBrutalismOverrides`), applied to a copy: an
override states the value it replaces and throws if the export no longer holds it. A button label
stays white on the brand fill, so it is the fill that gives way, by the smallest darkening that
reaches 4.5:1 (the channels move toward black in steps of 0.5%, so hue and saturation are kept).
`tests/themes.test.ts` holds that the failing pairs of each export are exactly the ones below.

| Theme         | Mode  | Token              | Exported  | Used      | Contrast, before to after                                             |
| ------------- | ----- | ------------------ | --------- | --------- | --------------------------------------------------------------------- |
| Claude        | Light | `primary`          | `#c96442` | `#b95c3d` | 3.90 to 4.51 under the white label                                    |
| Claude        | Light | `muted-foreground` | `#83827d` | `#6a6965` | 3.17 to 4.53 on the muted fill, 3.65 to 5.22 on the page and the card |
| Claude        | Dark  | `primary`          | `#d97757` | `#b06046` | 3.12 to 4.56 under the white label                                    |
| Claude        | Dark  | `destructive`      | `#ef4444` | `#d73d3d` | 3.76 to 4.54 under the white label                                    |
| Neo Brutalism | Light | `primary`          | `#ff3333` | `#e22d2d` | 3.64 to 4.52 under the white label                                    |

Every other pair that the components draw (primary, destructive, secondary, accent, popover, card and
page, muted text on the page and on the card, and each hover) reads at 4.5:1 or more in both modes.
Two things the 4.5:1 rule does not cover were left as exported: the `input` borders of Claude are
2.02:1 (Light) and 1.90:1 (Dark) against the page, under the 3:1 that WCAG asks of a control's edge,
and Neo Brutalism's shadows are black, so they do not show on its black Dark page. The thickness of
Neo Brutalism's borders (2px) is not in tweakcn's export: it is the storefront's, in `palettes.ts`.
Darkening Claude's dark `primary` for a white label leaves it at 3.33:1 against the page, which is
enough for a fill and an icon and not for the brand colour used as text there; the page's own
`--brand-text` is derived for that, and the components have no second primary for it.

DM Sans and Space Mono, which Neo Brutalism names, are not loaded: the storefront adds no web font
and no dependency, so both fall back to the system sans and monospace stacks.

To add a theme: paste its export into a file of `src/themes` in the same shape, add it to
`palettes.ts` and to the list in the inline script of `index.html`, and run `vp test`: the contrast
tests name each pair that needs an override.

### What the `appearance` API could not express

A note for the SDK's maintainers. Each item is something a tweakcn theme asks for and
`KaitenAppearance` has no way to say; the storefront did not change the API, and worked around each
in its own CSS, through the public `elements` slots where one reaches the part, and through the
`data-slot` attributes where none does. It overrides no `--ktn-*` property.

- **Shadows.** `KaitenVariables` has no shadow key, although the stylesheet has `--ktn-shadow-*`.
  Neo Brutalism is mostly its `4px 4px 0 0` offset shadow, so cards get it through `elements.card`
  and `elements.pricingCard` (`.themed-card`), and buttons through `[data-slot="button"]`.
  A shadow of a button's own takes the focus ring (also a shadow) with it, which the CSS puts back.
- **Border width.** There is no key and no token for it. Neo Brutalism's 2px borders come from the
  same classes and rules, and from one custom property of the storefront's.
- **`elements.button` does nothing.** It is declared, and no component reads it: the same for
  `badge`, `cardDescription`, `cardFooter`, `skeleton`, `separator` and `gateLockedIcon`. Buttons
  are reached by `[data-slot="button"]`, which makes a `data-slot` selector part of what a theme
  relies on.
- **The gradient button.** The highlighted plan's button is the brand gradient
  (`--ktn-primary-gradient`, class `ktn-cta-gradient`), whatever `colorPrimary` is, and there is no
  key for it. A themed button gets a flat fill: `background-image: none` on every button. Every
  plan's "Select plan" is a primary button, so in a theme the highlighted plan's button is the same
  as the others', and the plan is told apart by its badge, its 2px edge and its halo.
- **Fixed corners.** The pricing table (`rounded-[1.5rem]`) and its plans (`rounded-[1rem]`) ignore
  `borderRadius`; the portal's and checkout's cards follow it (as `radius + 4px`, so a radius of 0
  still gives 4px, as it does in shadcn). Plans take the same formula through `elements.pricingCard`;
  the table has no slot and is found by `[data-slot="pricing-table"]`.
- **Fonts.** `fontFamily` sets `--ktn-font-sans` only. Card titles use `--ktn-font-display` and `code`
  (the `/month` of a price) uses `--ktn-font-mono`, both with no key, and `font-serif` has none: a theme
  with its own mono or heading face cannot have it on the components.
- **Tracking, spacing, charts, sidebar.** No key, no effect here: both themes leave tracking and
  spacing at the defaults, and no component the storefront draws reads a chart or sidebar token.
- **Success, warning and the tinted destructive surface.** shadcn has no such tokens, so they stay
  the Kaiten defaults in a theme (the green badges, the pale error panel). The `colorWarning*` tokens
  of the stylesheet have no key at all.
- **One primary for two jobs.** `colorPrimary` is both the fill under a white label and the text and
  icon colour of the primary (the `link` button, the icons of the portal's card titles). In Dark the
  first needs a darker value than the second can use; shadcn themes avoid it with a dark label on a
  light primary, and the storefront keeps its labels white.
- **A theme in a console's notation.** The SDK derives foregrounds, hovers and neutral surfaces from
  hex only, so a theme in oklch has to carry all of them: that is why the mapper passes every
  foreground and derives the hovers itself.

## Changing plan

In V1 a customer does not move themselves from one paid plan to another: a tier change is a
commercial request, and the portal's **Change plan** button opens the plan's
`selfServeCtaUrl`. Passing `onUpgradeVersion` to `CustomerPortal` is what shows the button
([`src/pages/portal-page.tsx`](src/pages/portal-page.tsx)), and
[`src/change-plan.ts`](src/change-plan.ts) decides where it goes:

- **The address of the plan the customer is on**, not of a "next" plan. The vendor writes
  `selfServeCtaUrl` on each version of a plan, the conversation starts from where the customer stands,
  and the catalogue has no order between plans for the SDK to look a next one up in. The storefront's
  [`/sales`](src/pages/sales-page.tsx) page takes the plan in its address, so whoever answers knows
  the starting point. An address on the storefront's origin is followed inside the app, any other
  opens in a new tab.
- **The pricing table** for a customer on a free plan: a checkout replaces a free subscription,
  so there is nothing to ask for.
- **`/sales`** for a paid plan whose vendor left the address empty, because a button that does nothing
  is the one thing Change plan must not be.

The component words the button "Upgrade version" by default; `app.tsx` passes
`localization={{ currentPlan: { upgradeVersion: "Change plan" } }}`, which is what the specification
calls it.

## The journey page

`/journey` walks a presenter through the payment lifecycle. Each scenario has a few steps, and a step
says what to look at and has the control that gets there: a button that drives the stand-in for Kaiten
(start a customer over, say what the next payment comes to, move to the next boundary), or a link to
the real page, where the SDK's components do the rest. Beside them, the stand-in's own state (plan,
status, card, invoices) and the log of events Kaiten would have sent. It needs the stand-in: against
your Kaiten the buttons are off and the links remain.

| Scenario                           | How                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A visitor buys with no account     | the key's anonymous checkout on: Starter, then Pro through the provider's page, a refused security check, a checkout that expires |
| Buy a plan with a trial            | a new customer, Growth's checkout, then **End the trial now**: the conversion invoice                                             |
| A voucher: WELCOME20               | a customer with a card, Pro's checkout, the voucher typed in the field                                                            |
| Add-on increase                    | the portal's add-ons panel, + on Extra seats, confirmed, then the renewal that bills it                                           |
| Card declined, then retried        | the next payment set to fail, Pro's checkout, then the invoice paid                                                               |
| 3-D Secure                         | the next payment set to need a confirmation, answered on the provider's page                                                      |
| An outcome that is not known yet   | the next payment left undecided, then answered paid or declined                                                                   |
| A renewal fails                    | **Advance to the boundary** with a failing payment: past due, then paid from the portal                                           |
| Change the payment method          | the portal's Update payment method: the provider's page offers the other card                                                     |
| Cancel, then withdraw              | the portal's controls, or **Advance to the boundary** to let the cancellation run                                                 |
| Upgrade from the free plan         | Starter first, then Pro from the pricing table: the free subscription ends with no invoice                                        |
| Change plan: a commercial request  | the portal's button, which opens the plan's own link                                                                              |
| The vendor schedules a plan change | the storefront's backend schedules Growth with the server token, the boundary applies it                                          |

What the v3.1 contract adds and the stand-in does not play yet is listed on the page as **Coming with
the v3.1 contract**, with nothing to press and with what the stand-in does meanwhile: payment before
the plan (INCOMPLETE), a trial that ends without a card (CANCEL or CONVERT), the fallback to the
free plan, the deferred add-on decrease, the true-up, the `trial_will_end` webhook and one trial per
family. (A visitor's anonymous checkout already plays two of them: the payment before the plan, and one trial
per address and family.)

The vendor's scheduled plan change goes through
[`server/vendor-route.ts`](server/vendor-route.ts): `PUT` and `DELETE` on
`/storefront-api/vendor/plan-change`, which call `Billing.schedulePlanChange` and
`Billing.cancelPlanChange` of `@kaitencloud/server` with the server token. It is the vendor's side of a
tier change, here for the presenter's sake; a real storefront has no such route on its customer-facing
server, and this one is mounted only against the stand-in.

## Visitors who buy with no account

When the publishable key opens the anonymous checkout, a visitor who is not signed in buys a plan with
no account at all. The catalogue says so (`capabilities.anonymousCheckout`, with the site key of the
widget in `capabilities.turnstileSiteKey`), so the page does not have to be told: the checkout page of a
visitor reads it ([`src/visitor-checkout.tsx`](src/visitor-checkout.tsx)) and draws `AnonymousCheckoutFlow`
instead of the sign-up step. Where the catalogue says no, or cannot be read, the visitor makes an account
first, as [below](#visitors-who-sign-up).

```
page ──POST /public/checkout-sessions (pk_, Turnstile token, email, returnUrl)──▶ Kaiten  one session, nothing else
page ◀── 201 { sessionId, token: ksc_…, dueToday } ─────────────────────────────┘
page ──POST …/{sessionId}/confirm (Bearer ksc_…)───────────────────────────────▶ Kaiten
        a free plan, or a trial with no card: completed, and the customer, instance and subscription exist
        otherwise requires_payment_method { setupUrl }: the provider's page saves a card, in a popup
page ──POST …/{sessionId}/confirm again, once back, then GET until paid ─────────▶ Kaiten  completed
```

What the page does ([`src/app.tsx`](src/app.tsx), [`src/visitor-checkout.tsx`](src/visitor-checkout.tsx)):

- **One client for the page**, `KaitenAnonymousCheckoutClient`, made once and given to the provider as
  `anonymousCheckoutClient`: it keeps the `ksc_` of the checkout it started in memory and in
  `sessionStorage`, so that the page the provider sends the visitor back to can confirm. The token is never
  in a URL, and the storefront's backend never sees it.
- **The flow is mounted on the page the visitor comes back to**, the checkout's own address: the provider
  sends them to the `returnUrl` of the start (this page, by default) with `kaiten_checkout_session` in its
  address, and the flow goes on from there, whatever the catalogue says by then. In a popup, the page the
  popup lands on tells the one that waits, which carries on, and the popup closes.
- **One start per attempt.** A start spends a Turnstile token, a preview too: the page makes no preview, and
  a token refused is replaced by the widget at once.
- **Nothing else is asked of the storefront's backend**: no account, no cookie, no session. The visitor
  has an email, and Kaiten has made a customer named after it, with that address as its billing email,
  an instance and a subscription.
- **The page gives a `clientReferenceId`** (an order number it makes), which Kaiten echoes on the
  `checkout_session.v1.started`, `.completed` and `.abandoned` events. That reference, or the email, is how
  a vendor links the buyer to its own account when the `completed` event arrives, with the slugs of the
  customer and instance it made: Kaiten sends no email to your buyers, so the vendor's backend gives them
  an account, and an email of its own. This example has no webhook receiver, so it shows what the visitor
  sees and says where the rest happens; the stand-in's event log shows what Kaiten would have sent.
- **A paid plan starts once it is paid.** The instance is made on the free plan the family names as its
  fallback, and moves to the plan bought when the first invoice is paid. A visitor who never pays has a
  session that expires, and a customer left on the free plan for the vendor to clean up.
- **One trial per email address and plan family.** A second checkout with an address that had the trial is
  priced without it, and says so.
- The **Account** page still offers a visitor an account, and a customer who signed up has the checkout of a
  customer: **the sign-up mode and the one-customer mode are untouched**. With one customer signed in for
  everyone there is no visitor to sell to, whatever the key opens.

**What the vendor sets up in Kaiten** for this to work:

- A publishable key whose **allowed origins** include the storefront's (`http://localhost:5173` under
  `vp dev`): the start and the session's routes check the page's origin, and so does the `returnUrl`.
- On that key, **anonymous checkout switched on**, with the **Turnstile site key and secret** of a
  Cloudflare widget that is allowed on the storefront's host. The site key is public, and the catalogue
  hands it to the page; the secret is write-only, kept by Kaiten in its vault, and never returned. A key
  with the switch on and no secret answers 422 `TurnstileNotConfigured`, and with the switch off, 403
  `AnonymousCheckoutDisabled`. Self-hosted Kaiten works the same way: there is no bypass.
- A **billing provider that captures payment methods** for a plan that costs money, and, for each paid plan
  family, a **fallback** family with a free published version: the start of a paid checkout answers 422
  `FallbackRequired` without one. A free plan and a trial that asks for no card need neither.
- The page's **Content-Security-Policy**, if it has one, allows `https://challenges.cloudflare.com` in
  `script-src`, `frame-src` and `connect-src`, or the widget never appears.

For **local use**, Cloudflare publishes test keys that need no account and no challenge: the site key
`1x00000000000000000000AA` always passes, and the secret `1x0000000000000000000000000000000AA` accepts
every token. Put that pair on the key, and the widget the page draws is a real one that solves itself. The
other published keys are for the failures: on the site key side `2x00000000000000000000AB` always blocks
and `3x00000000000000000000FF` forces an interactive challenge, and on the secret side
`2x0000000000000000000000000000000AA` always fails and `3x0000000000000000000000000000000AA` answers that
the token was already spent (Cloudflare's page on testing Turnstile has the current values; check these
against it before relying on them).

Kaiten also compares the host Cloudflare reports for the solved widget with the key's allowed origins, and
refuses with `TurnstileFailed` when they differ. **Not confirmed yet**: which host Cloudflare's test secret
reports. If it is a placeholder (`example.com` is the likely one) and not the page's own, the test pair is
refused until that host is among the allowed origins of a key made for testing. If Kaiten answers
`TurnstileFailed` to the pass pair on a page that is otherwise right, that is the first thing to check;
a run against a real Kaiten will settle it, and this paragraph should then say which host to add.

The stand-in for Kaiten hands the page the same site key. It takes each token once, as Cloudflare does (a
token it has seen again is refused with `TurnstileFailed`, and counted in its state as `turnstileReused`),
and passes any token it has not seen while it plays a pass.

Limits, on purpose: the visitor is never told about an account, because there is none; a buyer who comes
back from another browser has nothing to sign in with; and **a visitor who buys twice makes two
customers**: Kaiten makes a new one at each checkout, and linking them is the vendor's job, through the event.

## Visitors who sign up

A real shop has visitors who are not customers yet. **When the publishable key does not open the
anonymous checkout** (above), a checkout is a customer's, and a customer is something the vendor's
backend creates. So there are two modes, and the second is the path to copy when your visitors sign up
on your site:

- **One customer.** The backend signs every visitor in as the customer it is given. There are no
  accounts: this is the mode of the stand-in's default, of `STOREFRONT_CUSTOMER_SLUG` and
  `STOREFRONT_INSTANCE_SLUG`, and of `live.spec.ts`.
- **Sign-up.** The pricing table is public, read with the publishable key alone. **Select plan**, and
  the **Account** entry, lead a visitor who has no account to **Create your account**: a name (a company's
  or their own) and the email the invoices go to. The backend makes the account in Kaiten, remembers it
  in a cookie, mints the customer's session, and the page goes on with the checkout of the plan the
  visitor picked, at the same address.

```
page ──POST /storefront-api/signup {name, email}──────▶ backend
                          ──GET  /public/catalog (pk_)────────────────────────────▶ Kaiten  which licence to start on
                          ──POST /customers      (ksh_)────────────────────────────▶ Kaiten  write:customers
                          ──POST /instances      (ksh_)────────────────────────────▶ Kaiten  write:instances
page ◀── 201, Set-Cookie: storefront_account=… ───────┘
page ──POST /storefront-api/session (cookie)────────────▶ backend ──POST /customer-sessions (ksh_)──▶ Kaiten
page ──────────── Authorization: Bearer kst_… (the checkout, as for any customer) ───────────────────▶ Kaiten
```

What the backend creates, and why ([`server/account-routes.ts`](server/account-routes.ts)):

- **The customer**: `name`, a slug of its own making (the name's slug and six random hexadecimal
  characters, Kaiten's own shape; a slug that is taken is tried again with another suffix, three times)
  and `billingEmail`. The checkout does not ask the customer for an address again.
- **The instance**: `POST /instances` requires a licence, so there is no instance without one, and an
  instance holds the entitlements of the licence it starts on. It starts on **the catalogue's free
  plan**, which is what Kaiten does for its own organizations: a new one holds the free Starter version
  and has no subscription, and leaves it through a checkout. A checkout moves the instance to the plan it
  buys, so the licence it starts on does not limit what can be bought. **The visitor never chooses that
  licence**: `POST /storefront-api/signup` is public, and a plan taken from its body would give any
  caller, as often as they like, the entitlements of whichever plan they named. So **a catalogue with no
  free plan has no sign-up**: the route creates nothing, logs that a free plan must be published, and the
  page says that accounts can't be created right now. (The plan a visitor picks on the pricing table
  only decides which checkout opens once the account exists.) The licence runs three years from now, as
  Kaiten's registration of its own instances does; billing does not read the dates.
- **A half-made account is taken back.** When the instance cannot be created, the customer just made is
  deleted (`DELETE /customers/{slug}`, covered by `write:customers`), so that a visitor who tries again
  leaves nothing behind.

The server token needs **`write:customers`**, **`write:instances`** and **`write:customer_sessions`**.
The catalogue is read with the publishable key, which needs no scope. A token that lacks one is refused
with a 403 `Auth.MissingScope`, and the storefront says which in words a developer understands: in the
server's log (`KAITEN_API_TOKEN does not hold write:instances. Sign-up mode needs write:customers,
write:instances and write:customer_sessions on the server token.`) and, while the visitor is the
developer, in a small line under the visitor's message: **under `vp dev`, and against the stand-in**.
Under `vp preview` against a Kaiten, which is closer to a live site, the page is only told that accounts
can't be created right now, and the scope, the quota and the missing free plan stay in the log. The
other refusals are handled too: a 409 slug conflict is retried; a customer or instance limit
(`EntitlementLimitReached`, a 409) is logged, and said to a developer; a 422 on the address is said at
the field; a 503 passes Kaiten's `Retry-After` on to the visitor; anything else is "try again in a
moment", with the status and code in the log and never the name or the address. The contract documents
a 503 with `Retry-After` for these two operations and no 429; a 429 from a gateway in front of Kaiten is
handled the same way as a precaution, not as something Kaiten says.

The request is checked before anything is sent to Kaiten: JSON only (`415` otherwise), 4 KiB at most
(`413`, and the body is not read past the limit), a name and an address of the lengths the contract
allows, and no control or invisible characters (line breaks, zero-width or bidirectional marks) in
either.

**The cookie** ([`server/account-cookie.ts`](server/account-cookie.ts)) is `storefront_account`:
`HttpOnly`, `SameSite=Lax`, `Path=/`, 30 days, and `Secure` when the request arrived over https. It
holds the customer's slug and the instance's and the moment it stops being good, and nothing else:
no name, no address, no id. It is signed with HMAC-SHA256, and a cookie that was altered in any way, not
signed by this server, or past its 30 days, is ignored as if it were absent. The key is `STOREFRONT_COOKIE_SECRET` (32 characters or more; the server refuses to start
with a shorter one). Without it a random key is made at each start, **the accounts are forgotten when the
server restarts**, and the startup log says so. The session route mints for the cookie's customer, and a
visitor with no valid cookie gets nothing minted. A cookie for a customer that Kaiten has forgotten (a
deleted customer, a stand-in that started over) is dropped, and the visitor is a visitor again.

**Sign out**, on the Account page beside the customer's name, revokes the sessions this process minted
for that customer (`CustomerSessions.revokeCustomerSession`), clears the cookie and loads the home page
again, so that the next visitor starts clean. The cookie holds slugs only, so the ids of the sessions are
kept in memory: after a restart there is nothing left to revoke, and a session ends by itself within an
hour. While someone is signed in, **Sign out** is also in the header of every page but Account. **Sign
out ends the account on that browser, not a copy of its cookie**: there is no server-side store to tell
that a value was cancelled, so a copy made earlier stays good until it expires or the secret changes. A
real site keeps its sessions on the server.

What this does **not** do, on purpose, and what a real site adds:

- There is **no sign-in**: no password, no link by email. An account lives in the browser that made it,
  and another browser starts as a new visitor. A real site has its own authentication, maps its user to
  the customer and instance slugs it stored, and mints for those.
- There is **nothing against abuse** on `POST /storefront-api/signup`, a public route that creates
  customers. Put email confirmation, a CAPTCHA and a rate limit in front of it. Kaiten's own limits and
  its customer quota apply, which is a floor and not a defence.
- Behind a proxy that ends TLS, the request reaches the server as http and the cookie is not `Secure`:
  the server does not read `X-Forwarded-Proto`. This is an example, not something to put on the internet.

The stand-in plays this mode when it is started as a visitor: the journey page has a scenario for it
(**A visitor signs up and buys a plan**), and a test does the same with `reset({ signUp: true })`. It
implements `POST /customers`, `POST /instances` and `DELETE /customers/{slug}` as the contract has them,
and plays **one instance at a time**: a new instance starts the billing state over, on the licence it was
created with, and replaces the account before it, which is then a visitor again (no session is minted for
it, and the ones it held end). The stand-in lives in the server's memory, so it starts over at each
restart, and with it every account.

## How the credentials move

Three credentials are involved, and each one stays on its own routes:

| Credential                | Held by             | Sent to                                                                                                 |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| a publishable key `pk_`   | the page            | `GET /public/catalog`, and the start of an anonymous checkout, `POST /public/checkout-sessions`         |
| a checkout token `ksc_`   | the page, in memory | `GET` and `POST …/confirm` of **one** anonymous checkout session, and nothing else                      |
| a customer session `kst_` | the page, in memory | `/public/session/*`: the portal and the checkout of **one** customer                                    |
| a server token `ksh_`     | the backend only    | `POST /customer-sessions`, to mint the session; in sign-up mode `POST /customers` and `POST /instances` |

The page never holds the server token. It asks its own backend for a session, and the backend
mints one with `CustomerSessions.createCustomerSession` of `@kaitencloud/server`:

```
page ──POST /storefront-api/session──▶ backend ──POST /customer-sessions (ksh_)──▶ Kaiten
page ◀────── { token: kst_…, expiresAt } ──────┘
page ──────────── Authorization: Bearer kst_… ────────────────────────────────────▶ Kaiten
```

`KaitenSessionClient` calls the backend for its first request, again a minute before the session
ends, and once more when Kaiten refuses the session, which is what [`src/config.ts`](src/config.ts)
and [`src/app.tsx`](src/app.tsx) set up. `pnpm run check:no-secrets`, run from the repository root, scans
this example's build for a token, the name of a secret variable and code of `@kaitencloud/server`.

## What is here

| Path                                                   | What it is                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`src/`](src)                                          | the page: provider, router, the screens, the journey page, the colour mode and theme controls, [the themes](src/themes)                          |
| [`server/session-route.ts`](server/session-route.ts)   | `POST /storefront-api/session`, the route to put behind your own sign-in                                                                         |
| [`server/account-routes.ts`](server/account-routes.ts) | sign-up mode: `GET /storefront-api/account`, `POST …/signup`, `POST …/signout`; [`account-cookie.ts`](server/account-cookie.ts) signs the cookie |
| [`server/plugin.ts`](server/plugin.ts)                 | mounts the backend on `vp dev` and `vp preview`; nothing in `src/` imports it                                                                    |
| [`server/vendor-route.ts`](server/vendor-route.ts)     | the vendor's scheduled plan change, for the journey page; the stand-in only                                                                      |
| [`src/visitor-checkout.tsx`](src/visitor-checkout.tsx) | a visitor's checkout with no account, and the choice between it and the sign-up step                                                             |
| [`server/environment.ts`](server/environment.ts)       | which Kaiten to talk to, read from the environment                                                                                               |
| [`server/double/`](server/double)                      | the stand-in for Kaiten                                                                                                                          |
| [`tests/`](tests)                                      | unit tests of the backend, of the stand-in and of the themes                                                                                     |
| [`e2e/`](e2e)                                          | Playwright tests of the page in Chromium                                                                                                         |

The route signs in one fixed customer, or, in sign-up mode, the customer of the visitor's cookie.
In your own application it sits behind your sign-in, reads who the user is, and mints a session for that
user's customer and instance. It refuses a request that comes from another origin, never repeats
what Kaiten answered to the page, and never logs the token; keep those. Revoke a session
(`CustomerSessions.revokeCustomerSession`) when the customer signs out.

Mount `CheckoutFlow` on the page the customer comes back to. The payment provider's page sends
them back to the page they left, with `kaiten_setup_session` in its address, and the checkout
goes on from there: that is why the checkout has a path of its own, and why there is a router.

## The stand-in for Kaiten

With none of the variables of the next section, the backend plays Kaiten itself, in the same
process: the catalogue, the minting of a session, the ten routes of `/public/session/*`, the three of
the anonymous checkout (`/public/checkout-sessions`), and the
pages of a payment provider, under `/kaiten-double`. The answers are the ones recorded from Kaiten
in the client's fixtures, which the client's tests hold to the API contract; what the stand-in adds
is a customer who moves:

- a checkout subscribes the instance, after a card has been saved on the provider's page if the
  customer has none; it prices a plan, its add-ons and a voucher (`WELCOME20`), and a plan with a
  trial bills nothing today. It refuses an add-on as the contract does:
  `CreateSessionCheckout.AddonNotPublic` for one that does not fit the plan, `.CurrencyMismatch` for
  one priced in another currency than the plan's, `.AddonInvalid` for a paid one with no fee for the
  plan's billing period, and `.AddonInvalid` with `AttachInstanceAddon.FamilyAlreadyAttached` inside
  for one of a family the instance already holds. The add-ons the instance holds (taken after a
  cancellation took effect) stay through the checkout and are billed from its activation, at their
  fee for the new period; one the new price cannot bill is refused, with one `errors[]` entry per
  attachment (`addons.<slug>`), as `.CurrencyMismatch` when the first is priced in another currency
  and `.AddonInvalid` otherwise;
- a checkout of an instance whose live subscription has no paid price (a free plan) replaces it:
  cancelled at once, with no invoice, and subscribed in the same step. Any other live
  subscription is still a 409 `CreateSessionCheckout.AlreadySubscribed`;
- a cancellation ends the subscription with its period, and a reactivation withdraws it;
- the payment of the activation invoice can be paid, declined, wait for the customer's
  confirmation (3-D Secure) or be unknown for a while;
- an add-on quantity is set from the portal's add-ons panel, one request per add-on confirmed, in
  force at once and billed from the next renewal, and refused as the contract refuses it:
  `SetSessionAddonQuantity.CurrencyMismatch` for an add-on priced in another currency than the
  subscription's (the GPU pack, in dollars beside the plans in euros),
  `.Incompatible` for one that does not fit the plan, or for a paid one whose flat fees have none
  for its billing period (an add-on that is metered only, free or custom is not checked for one),
  `.QuantityExceedsMax` for more units than it allows or fewer than none. Without a live
  subscription, after a cancellation took effect, nothing is billed: a change is in force at once,
  and only the plan and the most units the add-on allows are checked;
- changing the payment method saves the other of two cards, so that the change is seen;
- every plan that is not free has a `selfServeCtaUrl`: the storefront's `/sales` page, for the plan;
- it can move to the **next boundary**, as Kaiten's close would when the time came: a trial converts (an
  ACTIVATION invoice), a period renews (a RENEWAL invoice, with the add-ons held), a plan change the
  vendor scheduled applies, a cancellation takes effect. The invoice is paid, declined, left unknown or
  waits for a confirmation as `payment` says; one that is not paid leaves the subscription PAST_DUE until
  the customer pays it, on the provider's page or from the portal;
- **a visitor's anonymous checkout**, off until a test or the journey page turns it on (the catalogue
  then says so, with Cloudflare's always-passing test site key). The start takes the publishable key and a
  Turnstile token and prices the plan, its add-ons and the trial, one per address and family (`dryRun` writes
  nothing); it writes one session and no customer, instance or subscription. The confirm, with the
  session's `ksc_`, completes a free plan and a trial that asks for no card at once, and otherwise opens the
  provider's page to save a card (a return address naming the session) and, on the confirm after it, makes
  the customer (named and addressed by the email, with a slug of it and a random suffix), its instance and
  the subscription; with an amount due the instance starts on the free plan and moves to the plan bought
  when the first invoice is paid, which the payment outcome decides as it does for a customer's. It refuses
  as Kaiten does (`CreateCheckoutSession.InvalidPriceSelection`, `.PriceNotPublic`, `.AddonNotPublic`,
  `.InvalidEmail`, `.InvalidReturnUrl`, `.VoucherInvalid` for every code, `.FallbackRequired`, a body that
  does not fit the contract, a credential of the wrong class or another session's token, a session that is
  closed with its status in `errors[0].value`, `.DueTodayChanged` when the trial was used up after a card was
  saved). The security check comes to what a test scripts: it passes, Cloudflare refuses the token
  (`.TurnstileFailed`), cannot be reached (503 `.TurnstileUnavailable` and a `Retry-After`) or the key has
  no secret (`.TurnstileNotConfigured`). A token is single-use, a preview's included: one it has already
  verified, or refused, is refused again with `.TurnstileFailed`, and a page that sends one twice shows in
  the state's `turnstileReused`. Its log keeps no token;
- the vendor's routes `PUT` and `DELETE /instances/{slug}/billing/scheduled-change`, with the server
  token and the refusals of the contract (a trial, a cancellation, the same price, another currency, an
  add-on that does not fit);
- a log of the events Kaiten would have sent the vendor. It is a log: no webhook is delivered.

It is not Kaiten. The sums are its own, the entitlements are the catalogue's for the plan the
customer is on (its limits, a usage that is a share of them, nothing metered), and it accepts every
origin and limits no rate. It proves that the storefront
asks for the right routes with the right credentials and that the components draw what comes back,
refusals included. It proves nothing about Kaiten, and `tests/kaiten-double.test.ts` holds it to
what it stands in for: the conformance suite's whole journey runs against it, and every answer it
gives in those tests is checked against `contracts/openapi.yaml`.

A test controls it over HTTP, under `/kaiten-double/control`: `reset` starts from a customer with
nothing (or with a card, an email, a subscription, or a free one with `free`), `script` has the next
calls to a route answered with a refusal you give it (a 401, a 403, a 429 with a `Retry-After`),
`payment` says what becomes of the next payment, `advance` moves to the next boundary (`trial/end` only
a trial's), `invoices/:id/pay` and `invoices/:id/decline` settle an invoice, `anonymous-checkout` (`{ "enabled": true }`)
turns the key's anonymous checkout on or off (`reset` with `anonymousCheckout: true` starts it on),
`turnstile` (`{ "verdict": "fail", "times": 1 }`, a verdict of `pass`, `fail`, `unavailable` or `unconfigured`
for the next `times` verifications, or all of them) scripts the security check, `checkout-sessions/expire`
lets the time pass that closes the newest waiting session (a session never confirmed is abandoned, one
whose first payment never came expires), `events` returns what
Kaiten would have told the vendor, `state` what the customer is, and `calls` what it was asked, with the
kind of credential and never the credential. `e2e/support/stand-in.ts` wraps these, and the journey page
uses the same surface from the browser.

What it does not play, for a customer's checkout, is the v3.1 contract's: a trial that ends with no card is
refused by `trial/end` with a message that says so, and a checkout subscribes at once instead of waiting
for its payment. The visitor's anonymous checkout plays the wait: the instance is on the free plan until
the first invoice is paid. It has no fallback families, rate limits, or origins to allow: a free plan in the
catalogue is the fallback of every paid one, and a paid checkout is refused when there is none.

## Run it against your Kaiten

Copy `.env.example` to `.env` in this directory, fill it in, and run `vp dev` (or `vp preview`): the
storefront talks to your Kaiten instead of the stand-in. There are two modes, chosen by the two slug
variables.

```bash
cd examples/storefront
cp .env.example .env     # then fill it in
vp dev                   # http://localhost:5173
```

| Variable                   | Value                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `KAITEN_API_URL`           | Your API's URL, `/api` included                                                                            |
| `KAITEN_API_TOKEN`         | A `ksh_` token: `write:customer_sessions`, and in sign-up mode `write:customers` and `write:instances` too |
| `KAITEN_PUBLISHABLE_KEY`   | A publishable key whose allowed origins include the storefront's (`http://localhost:5173`)                 |
| `STOREFRONT_CUSTOMER_SLUG` | Optional, with the next: the customer the storefront signs in as                                           |
| `STOREFRONT_INSTANCE_SLUG` | Optional, with the previous: one of that customer's instances, the one a checkout subscribes               |
| `STOREFRONT_COOKIE_SECRET` | Optional: 32 characters or more, to sign the account cookie of sign-up mode                                |

- **Both slugs set**: the storefront signs in that one customer, as it always did. No sign-up, no sign
  out.
- **Neither set**: **sign-up mode**, [described above](#visitors-who-sign-up). The three first variables
  are all it needs, with a token that holds the three scopes.
- **One alone**: the server refuses to start and names the one that is missing, since a pair with a
  half is a mistake in either direction.

The files are read the way Vite reads them: `.env`, `.env.local`, `.env.[mode]` and
`.env.[mode].local`, the last one winning. `.env`, `.env.local` and `.env.*.local` are git-ignored;
`.env.example` is the committed template. Setting the same variables in your shell works too, and
**a variable of the shell wins over the files, even when it is empty**: with them set to empty in the
shell, you are back on the stand-in whatever `.env` holds, which is how the end-to-end tests stay on it.

Vite expands `$NAME` and `${NAME}` in the values of a file, so write a literal `$` as `\$` (a real
`ksh_` token or slug has none).

With only some of the first three variables, or with one slug and not the other, the server
refuses to start and says which are missing: a shell that kept one variable from another project must
not give you a different storefront. `STOREFRONT_COOKIE_SECRET` is never counted as missing; if it is set,
it must be long enough, and it is accepted in every mode. The
variables are read by the backend only. They have no `VITE_` prefix, so Vite never puts them in
`import.meta.env` or in the page, and the token goes to Kaiten and nowhere else. If you serve the
page on another port, add that origin (`http://localhost:<port>`) to the publishable key's allowed
origins.

Your Kaiten needs billing switched on, a public catalogue (a licence family made public, with a
default flat-fee price), and an instance that has no subscription. What a customer can buy depends
on the payment provider the organization has: a plan that costs money is bought alone only when the
provider can save a card, so against Kaiten's own provider, which bills nothing, the free plans can
be bought and the paid ones are shown and refused.

## Tests

```bash
vp run -r build                    # the page and the packages: the tests read their builds
cd examples/storefront
vp test                            # unit tests of the backend and of the stand-in: no browser
pnpm run test:e2e                  # Playwright, in Chromium
```

The tests need Chromium: `vp run test:browsers:install` in `packages/react-ui` installs the one
Playwright runs, and CI uses the Playwright image. `pnpm run test:e2e` serves the build with
`vp preview` and runs two projects. Run it with `pnpm run`: `vp run` hides the shell's variables from
a script, and the live project reads them.

- **`stand-in`**, `checkout.spec.ts`, `failures.spec.ts`, `theme.spec.ts`, `journey.spec.ts`,
  `signup.spec.ts` and `anonymous.spec.ts`, against the stand-in. It needs nothing,
  so it runs everywhere, CI included (`storefront-e2e` in `.github/workflows/ci.yml`).
  - `checkout.spec.ts` is the customer's way: the pricing table, a plan taken to its checkout, a card
    saved on the provider's page in a popup and, when the browser blocks popups, in place of the
    page, a customer who has a card, the portal, cancellation and its withdrawal, and that each
    credential stays on its own routes.
  - `failures.spec.ts` is what a customer meets when it does not go well: a card that is declined,
    a payment that needs the customer's confirmation, a page whose origin the key does not allow,
    a session that has expired (renewed, then refused), a request that has to wait (429), and a
    backend that cannot mint a session.
  - `journey.spec.ts` is a customer changing plan, and the journey page: Starter bought and then Pro from
    the pricing table, the free subscription ended with no invoice, Change plan and where it leads, and
    scenarios driven through the page's own buttons (a trial ended into its invoice, a renewal that fails
    and is paid from the portal, a plan change the vendor schedules and the boundary applies).
  - `signup.spec.ts` is a visitor who is not a customer yet: signing up from the pricing table and buying
    a plan, coming back and still being signed in, signing out and becoming a new visitor, a customer
    Kaiten has forgotten and a cookie that was not signed, a token that lacks a scope and a request to
    wait, the step in every theme and colour mode down to 320px, and the one-customer mode left as it was.
  - `anonymous.spec.ts` is a visitor who buys with no account: a free plan with an email and the security
    check, a paid plan through the provider's page, a trial that asks for no card and one that does, a
    security check that Kaiten refuses or cannot reach, a checkout that is abandoned and started again, a
    payment that never comes, a trial used up by another checkout before the card and while it is saved, a
    visitor sent to the provider's page in the same tab (the page is loaded again and still prints the
    session's reference), a long address on a 320px screen, the heading and title of the page, the catalogue
    turning the checkout on and off, the one-customer mode left as it was, and the journey page's scenario.
    Cloudflare's script is answered by a stand-in of the tests' own
    ([`e2e/support/cloudflare.ts`](e2e/support/cloudflare.ts)), so no network is needed; it gives every
    widget a new token, since the stand-in for Kaiten takes each once. What these tests do not cover: the
    real Turnstile widget (Cloudflare is never loaded), a widget in a container under 320px, and a run
    against a real Kaiten (the `live` project plays no anonymous checkout).
  - `theme.spec.ts` is the colour mode and the theme: System following the operating system, a
    choice kept across a reload and applied before the first paint, Claude's and Neo Brutalism's
    values on the page and on the components in Light and in Dark, going back to Kaiten, and a header
    and pages that do not scroll sideways at 380 and 320px with any theme.
- **`live`**, `live.spec.ts`, against your Kaiten. It is skipped without the variables below, and
  fails if only some are set. It subscribes the instance it is given, to a free plan, so the instance
  must have no subscription: a new one for each run.

  | Variable                          | Value                                                               |
  | --------------------------------- | ------------------------------------------------------------------- |
  | `STOREFRONT_LIVE_API_URL`         | as `KAITEN_API_URL`                                                 |
  | `STOREFRONT_LIVE_SERVER_TOKEN`    | as `KAITEN_API_TOKEN`                                               |
  | `STOREFRONT_LIVE_PUBLISHABLE_KEY` | as `KAITEN_PUBLISHABLE_KEY`, for the origin `http://127.0.0.1:4174` |
  | `STOREFRONT_LIVE_CUSTOMER_SLUG`   | as `STOREFRONT_CUSTOMER_SLUG`                                       |
  | `STOREFRONT_LIVE_INSTANCE_SLUG`   | as `STOREFRONT_INSTANCE_SLUG`                                       |

  The live tests take the paths that need no card: the catalogue, a free plan bought and found in the
  portal with its invoice, the refusal of a paid plan that no provider can charge, an instance that
  is subscribed already, and the cancellation and its withdrawal. A card saved on the provider's
  page, a declined card and a 3-D Secure challenge need a provider that a test can drive without
  a person, which a Kaiten with no Stripe account does not have: the stand-in plays them in
  `checkout.spec.ts` and `failures.spec.ts`, and they have not run against a real provider.
