# Storefront example

A small shop on Kaiten billing: a **pricing table**, a **checkout** and a **customer portal**,
in a Vite app, with the backend route that lets its page act for one customer. It is the whole
way a customer takes through the React packages, from choosing a plan to managing it, and the
code to read when you wire your own.

```
/                     PricingTable    the plans of the catalogue, from a publishable key
/checkout/:plan       CheckoutFlow    the choices, what is due today, the card, the outcome
/portal               CustomerPortal  the plan, the limits, the invoices, cancellation
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
| [`src/`](src)                                        | the page: provider, router, the three screens and the theme switcher          |
| [`server/session-route.ts`](server/session-route.ts) | `POST /storefront-api/session`, the route to put behind your own sign-in      |
| [`server/plugin.ts`](server/plugin.ts)               | mounts the backend on `vp dev` and `vp preview`; nothing in `src/` imports it |
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
- a cancellation ends the subscription with its period, and a reactivation withdraws it;
- the payment of the activation invoice can be paid, declined, wait for the customer's
  confirmation (3-D Secure) or be unknown for a while.

It is not Kaiten. The sums are its own, the entitlements are those of one recorded customer
whatever the plan, and it accepts every origin and limits no rate. It proves that the storefront
asks for the right routes with the right credentials and that the components draw what comes back,
refusals included. It proves nothing about Kaiten, and `tests/kaiten-double.test.ts` holds it to
what it stands in for: the conformance suite's whole journey runs against it, and every answer it
gives in those tests is checked against `contracts/openapi.yaml`.

A test controls it over HTTP, under `/kaiten-double/control`: `reset` starts from a customer with
nothing (or with a card, an email, a subscription), `script` has the next calls to a route
answered with a refusal you give it (a 401, a 403, a 429 with a `Retry-After`), `payment` says what
becomes of the next payment, and `calls` returns what it was asked, with the kind of credential and
never the credential. `e2e/support/stand-in.ts` wraps these.

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

- **`stand-in`**, `checkout.spec.ts` and `failures.spec.ts`, against the stand-in. It needs nothing,
  so it runs everywhere, CI included (`storefront-e2e` in `.github/workflows/ci.yml`).
  - `checkout.spec.ts` is the customer's way: the pricing table, a plan taken to its checkout, a card
    saved on the provider's page in a popup and, when the browser blocks popups, in place of the
    page, a customer who has a card, the portal, cancellation and its withdrawal, and that each
    credential stays on its own routes.
  - `failures.spec.ts` is what a customer meets when it does not go well: a card that is declined,
    a payment that needs the customer's confirmation, a page whose origin the key does not allow,
    a session that has expired (renewed, then refused), a request that has to wait (429), and a
    backend that cannot mint a session.
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
