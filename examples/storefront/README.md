# Storefront example

A small shop on Kaiten billing: a **pricing table**, a **checkout** and a **customer portal**,
in a Vite app, with the backend route that lets its page act for one customer. It is the whole
way a customer takes through the React packages, from choosing a plan to managing it, and the
code to read when you wire your own.

```
/                     PricingTable    the plans of the catalogue, from a publishable key
/checkout/:plan       CheckoutFlow    the choices, what is due today, the card, the outcome
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

## The theme

The header has a Light / Dark / System switch, remembered in `localStorage`. One preference has two
readers, both set up in [`src/theme.ts`](src/theme.ts): the page's own tokens read the `dark` class
that is put on `<html>` (an inline script in `index.html` does it before the first paint, so a dark
page never starts light), and the components read the same choice through
`<KaitenStyleRoot appearance={{ baseTheme }}>`, which follows the operating system by itself while it
is `"system"`. The stylesheet is plain CSS: tokens on `:root`, redefined under `:root.dark`.

## Changing plan

In V1 a customer does not move themselves from one paid plan to another: a tier change is a
commercial request (V31-40), and the portal's **Change plan** button opens the plan's
`selfServeCtaUrl`. Passing `onUpgradeVersion` to `CustomerPortal` is what shows the button
([`src/pages/portal-page.tsx`](src/pages/portal-page.tsx)), and
[`src/change-plan.ts`](src/change-plan.ts) decides where it goes:

- **The address of the plan the customer is on**, not of a "next" plan. The vendor writes
  `selfServeCtaUrl` on each version of a plan, the conversation starts from where the customer stands,
  and the catalogue has no order between plans for the SDK to look a next one up in. The storefront's
  [`/sales`](src/pages/sales-page.tsx) page takes the plan in its address, so whoever answers knows
  the starting point. An address on the storefront's origin is followed inside the app, any other
  opens in a new tab.
- **The pricing table** for a customer on a free plan: a checkout replaces a free subscription
  (V31-68), so there is nothing to ask for.
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

| Scenario                           | How                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Buy a plan with a trial            | a new customer, Growth's checkout, then **End the trial now**: the conversion invoice      |
| A voucher: WELCOME20               | a customer with a card, Pro's checkout, the voucher typed in the field                     |
| Add-on increase                    | the portal's + on Extra seats (in force at once), then the renewal that bills it           |
| Card declined, then retried        | the next payment set to fail, Pro's checkout, then the invoice paid                        |
| 3-D Secure                         | the next payment set to need a confirmation, answered on the provider's page               |
| An outcome that is not known yet   | the next payment left undecided, then answered paid or declined                            |
| A renewal fails                    | **Advance to the boundary** with a failing payment: past due, then paid from the portal    |
| Change the payment method          | the portal's Update payment method: the provider's page offers the other card              |
| Cancel, then withdraw              | the portal's controls, or **Advance to the boundary** to let the cancellation run          |
| Upgrade from the free plan         | Starter first, then Pro from the pricing table: the free subscription ends with no invoice |
| Change plan: a commercial request  | the portal's button, which opens the plan's own link                                       |
| The vendor schedules a plan change | the storefront's backend schedules Growth with the server token, the boundary applies it   |

What the v3.1 contract adds and the stand-in does not play yet is listed on the page as **Coming with
the v3.1 contract**, with nothing to press and with what the stand-in does meanwhile: payment before
the plan (INCOMPLETE, V31-63), a trial that ends without a card (CANCEL or CONVERT, V31-65), the
fallback to the free plan (V31-66), the deferred add-on decrease (V31-67), the true-up (V31-70), the
`trial_will_end` webhook (V31-69) and one trial per family (V31-64).

The vendor's scheduled plan change goes through
[`server/vendor-route.ts`](server/vendor-route.ts): `PUT` and `DELETE` on
`/storefront-api/vendor/plan-change`, which call `Billing.schedulePlanChange` and
`Billing.cancelPlanChange` of `@kaitencloud/server` with the server token. It is the vendor's side of a
tier change, here for the presenter's sake; a real storefront has no such route on its customer-facing
server, and this one is mounted only against the stand-in.

## How the credentials move

Three credentials are involved, and each one stays on its own routes:

| Credential                | Held by             | Sent to                                                              |
| ------------------------- | ------------------- | -------------------------------------------------------------------- |
| a publishable key `pk_`   | the page            | `GET /public/catalog`, and nothing else                              |
| a customer session `kst_` | the page, in memory | `/public/session/*`: the portal and the checkout of **one** customer |
| a server token `ksh_`     | the backend only    | `POST /customer-sessions`, to mint the session                       |

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

| Path                                                 | What it is                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`src/`](src)                                        | the page: provider, router, the screens, the journey page, the theme switcher |
| [`server/session-route.ts`](server/session-route.ts) | `POST /storefront-api/session`, the route to put behind your own sign-in      |
| [`server/plugin.ts`](server/plugin.ts)               | mounts the backend on `vp dev` and `vp preview`; nothing in `src/` imports it |
| [`server/vendor-route.ts`](server/vendor-route.ts)   | the vendor's scheduled plan change, for the journey page; the stand-in only   |
| [`server/environment.ts`](server/environment.ts)     | which Kaiten to talk to, read from the environment                            |
| [`server/double/`](server/double)                    | the stand-in for Kaiten                                                       |
| [`tests/`](tests)                                    | unit tests of the backend and of the stand-in                                 |
| [`e2e/`](e2e)                                        | Playwright tests of the page in Chromium                                      |

The route signs in one fixed customer, because the storefront has no accounts. In your own
application it sits behind your sign-in, reads who the user is, and mints a session for that
user's customer and instance. It refuses a request that comes from another origin, never repeats
what Kaiten answered to the page, and never logs the token; keep those. Revoke a session
(`CustomerSessions.revokeCustomerSession`) when the customer signs out.

Mount `CheckoutFlow` on the page the customer comes back to. The payment provider's page sends
them back to the page they left, with `kaiten_setup_session` in its address, and the checkout
goes on from there: that is why the checkout has a path of its own, and why there is a router.

## The stand-in for Kaiten

With none of the variables of the next section, the backend plays Kaiten itself, in the same
process: the catalogue, the minting of a session, the ten routes of `/public/session/*`, and the
pages of a payment provider, under `/kaiten-double`. The answers are the ones recorded from Kaiten
in the client's fixtures, which the client's tests hold to the API contract; what the stand-in adds
is a customer who moves:

- a checkout subscribes the instance, after a card has been saved on the provider's page if the
  customer has none; it prices a plan, its add-ons and a voucher (`WELCOME20`), and a plan with a
  trial bills nothing today;
- a checkout of an instance whose live subscription has no paid price (a free plan) replaces it:
  cancelled at once, with no invoice, and subscribed in the same step (V31-68). Any other live
  subscription is still a 409 `CreateSessionCheckout.AlreadySubscribed`;
- a cancellation ends the subscription with its period, and a reactivation withdraws it;
- the payment of the activation invoice can be paid, declined, wait for the customer's
  confirmation (3-D Secure) or be unknown for a while;
- an add-on quantity is set from the portal, in force at once and billed from the next renewal, and
  refused as the contract refuses it: `SetSessionAddonQuantity.CurrencyMismatch` for an add-on priced
  in another currency than the subscription's (the GPU pack, in dollars beside the plans in euros),
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
a trial's), `invoices/:id/pay` and `invoices/:id/decline` settle an invoice, `events` returns what
Kaiten would have told the vendor, `state` what the customer is, and `calls` what it was asked, with the
kind of credential and never the credential. `e2e/support/stand-in.ts` wraps these, and the journey page
uses the same surface from the browser.

What it does not play is the v3.1 contract's: a trial that ends with no card is refused by `trial/end`
with a message that says so, and a checkout subscribes at once instead of waiting for its payment.

## Run it against your Kaiten

Set all of these on the server that runs `vp dev` or `vp preview`, and it talks to your Kaiten
instead:

| Variable                   | Value                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `KAITEN_API_URL`           | Your API's URL, `/api` included                                                            |
| `KAITEN_API_TOKEN`         | A `ksh_` token that holds `write:customer_sessions`                                        |
| `KAITEN_PUBLISHABLE_KEY`   | A publishable key whose allowed origins include the storefront's (`http://localhost:5173`) |
| `STOREFRONT_CUSTOMER_SLUG` | The customer the storefront signs in as                                                    |
| `STOREFRONT_INSTANCE_SLUG` | One of that customer's instances: the one a checkout subscribes                            |

With some of them and not all, the server refuses to start and says which are missing: a shell that
kept one variable from another project must not give you a different storefront. The token is read
by the backend and goes to Kaiten, and nowhere else.

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

- **`stand-in`**, `checkout.spec.ts`, `failures.spec.ts`, `theme.spec.ts` and `journey.spec.ts`, against the
  stand-in. It needs nothing,
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
