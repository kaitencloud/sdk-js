# @kaitencloud/client

Kaiten SDK for the embedded monetization surface: the plan catalog, a customer's
licensing snapshot, entitlement usage and feature flags. It is built for browsers,
where it never holds a secret, and it runs on servers too.

## Install

```bash
npm install @kaitencloud/client
```

## Kaiten version

Minimum Kaiten version for the billing features: **the first Kaiten release with billing.** No Kaiten release carries billing yet.

Three things need it. `getCatalog()` with a publishable key reads `GET /public/catalog`, and
`KaitenSessionClient` calls the `/public/session/*` routes; a server without billing does not
have them, answers with an error, and the call rejects with a `KaitenError`. A usage report
with a `transactionId` carries it in the `Idempotency-Key` header, which such a server ignores:
the report is counted at every sending, its answer has no `transactionId`, and the client never
sends it again, as [Reporting usage](#reporting-usage) describes. Everything else, which 1.0.0
already did (the catalogue and the licensing snapshot composed from the licences endpoints, usage reports
without a key, flag evaluation), works against the Kaiten releases it worked against. What a
newer server adds to a usage row (`source`, `provenance`, the effective limit) is read when it
is there and left out when it is not.

## Authentication

The API accepts a `ksh_` token, or a JWT from the identity provider its gateway trusts,
and both carry rights over a whole organization. Call Kaiten with them from your
backend, and send your pages only what they need. On a server, this client takes a
`ksh_` token with `authScheme: "bearer"`, as [`examples/node`](../../examples/node) does;
[`@kaitencloud/server`](../server) covers the whole API. In a browser, the client refuses
to send a `ksh_`, `ksm_` or `sk_` credential.

A browser has a credential of its own for the public catalog: a publishable key (`pk_`),
which reads it and nothing else. For a signed-in customer it uses a customer session
(`kst_`), described [below](#customer-sessions). For a visitor who has no account yet,
a publishable key starts an anonymous checkout and gets in return the token of that
one checkout (`ksc_`), described [below](#anonymous-checkout). The three are different
classes: the API refuses one presented on the routes of another, and so does this client.
It needs a Kaiten server that serves the public routes (`/api/public/*`): see
[Kaiten version](#kaiten-version).

A publishable key is `pk_` followed by 43 letters, digits, `-` or `_`.
`assertPublishableKeyShape(key)` throws for anything else (a key cut short by a paste,
or wrapped in quotes) and `isPublishableKeyShape(key)` answers true or false. The
client itself only checks the prefix of the key it sends, as `assertPublishableKey`
always has, so a test key such as `pk_live_abc` still works against a mock server.

`authScheme` is required:

- `"bearer"` sends the credential as `Authorization: Bearer`;
- `"publishable"` sends a publishable key as `X-Kaiten-Publishable-Key`, to
  `GET /public/catalog` only: `getCatalog()` reads it, with no cookie and no fallback,
  and every other call is refused before any request;
- `"none"` sends no credential, for an endpoint in front of Kaiten that authenticates the
  request itself.

### The public catalog

With a publishable key, `getCatalog()` returns the default published version of each
public licence family, its active prices and its public add-ons, and
`catalog.capabilities` says whether the organization takes self-serve checkouts and
payment methods. Each plan says whether it is `selfServe`, and where to send a customer
when it is not (`selfServeCtaUrl`).

Prices come in two lists. `plan.prices`, typed `PlanPrice[]` as in 1.0, holds the
default monthly and annual flat fees only: prices a 1.0 reader cannot misread.
`plan.billingPrices`, typed `BillingPrice[]`, holds every active price, in the API's
order:

- amounts are integers in the currency's minor units, as everywhere in this SDK
  (`4900` EUR is €49.00, `980` JPY is ¥980, `12500` KWD is 12.500 KWD);
- a quarterly or semi-annual fee is `{ interval: "month", intervalCount: 3 }` or `6`;
- a usage or overage price (`billingModel`) has no interval: it is per sale unit of its
  `meteredEntitlementSlug`, `saleUnitFactor` measured units each. Never add it into a
  headline;
- a price below one minor unit, such as `0.0002` cents per token, has no `amount`:
  render it from `unitAmountDecimal`, a decimal string, without converting it to a
  floating-point number.

`plan.price` and `plan.annualPrice` are the default monthly and annual flat fees.

To show a price, `majorUnitAmount(price)` gives its amount in the currency's major units
as an exact decimal string, without going through a floating-point number: `"49"` for a
`4900` EUR fee, `"2"` for `200` EUR per 1M tokens, and `"0.000002"` for a price of
`"0.0002"` per call. `Intl.NumberFormat` formats such a string as it is:

```ts
const amount = majorUnitAmount(price); // "0.000002"
new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: price.currencyCode,
  maximumFractionDigits: 20,
}).format(amount as `${number}`); // "€0.000002", and "€2.00" for "2"
```

A usage price is per sale unit, so the label is "€2.00 per 1M tokens" (`saleUnitSingular`),
or "€0.000002 per call" when the sale unit is one call. The amount is never divided down
to one measured unit and never added to the plan's fee. It returns `undefined` for a
currency the API does not know, rather than guess how many decimals it has.

`getCatalog` takes optional arguments that narrow the read, and send nothing more than
they name:

```ts
await client.getCatalog({ familySlug: "pro" }); // that family's plan, and the add-ons
await client.getCatalog({ include: "none" }); // every plan, without the add-ons
```

`include` is `"addons"` (the default) or `"none"`. An empty `familySlug`, or an
`include` that is neither, throws a `TypeError` before any request. A client with
any other credential composes its catalog from your licences and ignores both.

`catalog.capabilities.checkout` is what the API says about the organization: a plan
of this catalog can be bought alone. It is read from the response, not worked out from
the plans. When it is `false`, show each plan's `selfServeCtaUrl` instead of a
purchase button.

`catalog.capabilities.anonymousCheckout` says whether this publishable key can start a
checkout for a visitor with no account, and `turnstileSiteKey` is the site key of the
Turnstile widget that checkout needs. They go together: `anonymousCheckout` is `true` only
with a site key, and `turnstileSiteKey` is `null` otherwise, also on a Kaiten that
predates the feature.

### Customer sessions

A browser acting for one signed-in customer — a customer portal, a checkout — uses a
customer session (`kst_`), which your backend mints with
`CustomerSessions.createCustomerSession` of [`@kaitencloud/server`](../server#customer-sessions)
and hands to the page. `KaitenSessionClient` sends it, given a `getCustomerSession` callback
that fetches one:

```ts
import { KaitenSessionClient } from "@kaitencloud/client";

const billing = new KaitenSessionClient({
  apiUrl: "https://kaiten.example.com/api",
  // Your own endpoint, which calls CustomerSessions.createCustomerSession and
  // returns { token, expiresAt }.
  getCustomerSession: () => fetch("/billing/session", { method: "POST" }).then((r) => r.json()),
});

const portal = await billing.getPortal();
```

It is a class of its own, apart from `KaitenClient`: it holds a different credential,
which it sends as `Authorization: Bearer kst_…` to `/api/public/session/*` and nowhere
else. It calls `getCustomerSession` for its first call and again 60 seconds before the
session expires, once for any number of concurrent calls; when the API refuses a
session (401), it renews it and sends the request once more, and a second refusal
reaches `onAuthError`.

| Call                                                                | Route                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| `getPortal()`                                                       | `GET /public/session/portal`                             |
| `listInvoices({ cursor?, limit? })`                                 | `GET /public/session/invoices`                           |
| `checkout(input)`                                                   | `POST /public/session/checkout`                          |
| `cancelSubscription({ reason? })`, `reactivateSubscription()`       | `POST /public/session/billing/cancel`, `…/reactivate`    |
| `createPortalSession({ returnUrl })`                                | `POST /public/session/billing/portal-session`            |
| `createPaymentMethodSession(…)`, `completePaymentMethodSession(id)` | `POST /public/session/billing/payment-method-session[…]` |
| `validateVoucher({ code, licensePriceId? })`                        | `POST /public/session/vouchers/validate`                 |
| `redeemVoucher({ code, dryRun? })`                                  | `POST /public/session/vouchers/redeem`                   |
| `setAddonQuantity(addonSlug, quantity)`                             | `PUT /public/session/addons/{addonSlug}`                 |

A session bound to an instance (`CustomerSessions.createCustomerSession` takes an `instanceSlug`) reads
that instance's subscription, its entitlements, its add-ons and the estimate of its next
invoice. One bound to the customer only reads the customer, its `instances` and its
payment method, and the rest is `null` or empty. The portal's entitlements are the
instance's effective ones — the licence grant with its add-ons and voucher boosts
applied — each with its `source` and its `provenance`: the licence, the add-ons and the
boosts that make the value, with the identifiers of their rows. Every amount and total
comes from the server: the SDK never sums prices.

Where the API has no value, the SDK says `null`: a payment method's `brand` and `last4`,
an invoice's `issuedAt`, `dueAt` and `paidAt`, a discount line's `unitAmountDecimal`, a
subscription's `scheduledChange`. A `checkout` answers one of three results, by
`status`: a `preview` of what is due today (`dryRun: true`), `requires_payment_method`
with the provider's `setupUrl` to send the customer to (call `checkout` again with the
`setupSessionId` once they are back), or `subscribed`. `createPortalSession` answers a
`url` and nothing else. `validateVoucher` answers `{ valid: false }` for every code that
does not apply and, for one that does, how long it lasts (`duration`: `ONE_TIME`,
`REPEATING` or `FOREVER`) and what it gives; a discount's `value` and a boost's
`modifierValue` are decimal strings. The code goes in the request body only.

A code is redeemed by the checkout that carries it, or, on an instance whose subscription
is live (in its trial, active or past due), by `redeemVoucher`: with `dryRun: true` it
answers what the code would give and changes nothing, and without it the redemption is
made. A price part applies from the next invoice (`appliesFromInvoice: "next"`) and the
current period is never invoiced again. A subscription still waiting for its first payment
refuses (`RedeemSessionVoucher.SubscriptionIncomplete`), as does one that is not live
(`.NoLiveSubscription`); every other refusal is the same `.VoucherInvalid`. While a
subscription is in its trial, `portal.trial` holds when it ends (`endsAt`), when the `trial_will_end` event is,
or was, due (`reminderAt`, `null` when the API gives none), what its end charges (`charge`: the server's figure
and its billing period, `null` when nothing would be) and the card that charge goes to
(`paymentMethod`, `null` without one, whose `brand` and `last4` the provider may not give).

A refused call rejects with a `KaitenError` carrying the API's `status` and `code`, such
as `CreateSessionCheckout.AlreadySubscribed`; some refusals have a class of their own,
described in [Errors and retries](#errors-and-retries). Reads are retried after a network
failure or a 5xx; **a write never is**, whatever the answer, since a checkout can subscribe
the customer and nobody knows whether the first attempt took effect. The one exception is a
session the API refused with a 401, which did nothing: it is renewed and the request sent
once more.

### Anonymous checkout

A visitor your backend does not know yet can buy a self-serve plan from your own pages, with
no account: the checkout creates the customer, the instance and the subscription when it
completes. `KaitenAnonymousCheckoutClient` does it with a publishable key that has
anonymous checkout turned on, and a [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
token for each start.

**The start and the confirm**, on the page that sells the plan:

```ts
import { KaitenAnonymousCheckoutClient } from "@kaitencloud/client";

const checkout = new KaitenAnonymousCheckoutClient({
  apiUrl: "https://kaiten.example.com/api",
  publishableKey: "pk_…",
});

// The site key is catalog.capabilities.turnstileSiteKey; the widget gives one token per start.
// A dryRun first shows what is due (`status: "preview"`); it spends a token too.
const started = await checkout.startCheckout({
  turnstileToken,
  licenseSlug: "growth-v1", // or priceId
  billingPeriod: "MONTHLY",
  email: "ada@example.com",
  returnUrl: "https://shop.example.com/welcome",
  clientReferenceId: "cart-42", // echoed on the checkout's events; yours, not a request parameter's
});
// `started` is an opened session: the type follows from asking for no dryRun.
const confirmed = await checkout.confirmCheckout(started.sessionId);

if (confirmed.status === "requires_payment_method") {
  // The confirm re-checks the trial and may have changed what is due since the start.
  // Compare what the visitor was shown with the session, and show the new amount
  // (and let them agree to it) before sending them to the hosted page.
  const { dueToday, trialEndsAt } = confirmed.session;
  if (dueToday.total !== started.dueToday.total || trialEndsAt !== started.trialEndsAt) {
    await askTheVisitorAgain(confirmed.session);
  }
  location.assign(confirmed.setupUrl);
}
// "completed": a free plan, or a trial that needs no payment method.
```

**The way back**, on `returnUrl`, after the hosted page that saves the payment method. Read
the outcome first and clear the address only once you have it, so that a reload (or a failed
request) can try again:

```ts
import {
  CheckoutSessionClosedError,
  KaitenNetworkError,
  clearCheckoutReturn,
  readCheckoutReturn,
} from "@kaitencloud/client";

const back = readCheckoutReturn(); // { sessionId, urlWithoutSession } | null
if (back) {
  try {
    const confirmed = await checkout.confirmCheckout(back.sessionId);
    // "awaiting_payment": read getCheckoutSession(back.sessionId) until it closes.
    // "completed": the customer and the instance exist (confirmed.session.customerSlug).
    showOutcome(confirmed.session);
    clearCheckoutReturn(); // history.replaceState without kaiten_checkout_session
  } catch (error) {
    if (error instanceof CheckoutSessionClosedError) {
      // Closed already: Kaiten completes a checkout whose visitor never came back, so
      // this may well be a success. Read the session to tell which.
      showOutcome(await checkout.getCheckoutSession(back.sessionId));
      clearCheckoutReturn();
    } else if (error instanceof KaitenNetworkError) {
      showRetry(); // the address still names the session: confirm again, or read it. Never start over.
    } else {
      throw error;
    }
  }
}
```

| Call                        | Route                                                | Credential            |
| --------------------------- | ---------------------------------------------------- | --------------------- |
| `startCheckout(input)`      | `POST /public/checkout-sessions`                     | the publishable key   |
| `getCheckoutSession(id)`    | `GET /public/checkout-sessions/{sessionId}`          | that session's `ksc_` |
| `confirmCheckout(id)`       | `POST /public/checkout-sessions/{sessionId}/confirm` | that session's `ksc_` |
| `holdsCheckoutSession(id)`  | none                                                 |                       |
| `forgetCheckoutSession(id)` | none                                                 |                       |

`startCheckout` is typed by what it asks for: `dryRun: true` gives a `CheckoutSessionPreview`
and a start without it a `CheckoutSessionOpened`, so a page does not narrow what it already
knows; when `dryRun` is a `boolean` the compiler cannot see, it is either (narrow on `status`).
An answer of the other kind rejects with a `KaitenError`.

**Two credentials, two routes.** The publishable key goes in `X-Kaiten-Publishable-Key` to the
start and nowhere else. The start answers a session and its `ksc_` token, which goes in
`Authorization: Bearer ksc_…` to that session's own two routes and nowhere else. Neither is
ever sent with the other, whatever `defaultHeaders` holds, and no cookie is sent. `started.token`
is the same token the client already holds: read it only to keep it somewhere of your own (a
server-side session, when the page that confirms is not this one). It is a bearer credential for
one session: do not log or share it, and never put it in a URL or in `localStorage`.

**The token survives the redirect** to the hosted page that saves a payment method, which is a
full-page navigation: it is kept in memory and in `sessionStorage`, under the session's id. It
is never in a URL, never in `localStorage`. `sessionStorage` is used in a browser only; a server
runtime has memory alone, since the `sessionStorage` some of them offer is shared by every
visitor; for the same reason a client on a server must not be shared across visitors, as it
holds the token of every session it started. The client keeps the token of a session that closed (`COMPLETED`, `ABANDONED` or
`EXPIRED`) for the 24 hours the API still answers a read with it, so that a reload shows the
outcome of a payment; it drops the token when the API refuses it, when that window is over,
or on `forgetCheckoutSession`. A closed session's last answer is also kept in memory so that a
second read, or a second effect run, finds its outcome without a request. Pass `storage` (the
shape of `Storage`) to keep tokens somewhere else, or `storage: null` for memory alone.

**A page that comes back without the token** (another tab or browser, cleared or blocked
storage as in a private window, a window of more than 24 hours) gets a
`CheckoutTokenMissingError` before any request. **Never start a new checkout because of it, and
never automatically**: the session may have been paid for and completed while the visitor was
away, and a second checkout for the same buyer creates a second customer, instance and
subscription. Look the outcome up with your own events or the `clientReferenceId`, and let the
visitor decide. `holdsCheckoutSession(id)` tells before asking.

**`confirmCheckout` is safe to send again.** It answers the session's current state and never
creates a second customer, instance or charge, so after a timeout (30 seconds unless you set
`timeoutMs`; a confirm may open the payment provider's objects and pay inline) or a network
failure, confirm again or read the session. The client does not replay it by itself.

**Money and what is due** are the server's: `dueToday` is computed by the API from the start, a
trial included (`trialEndsAt`, or `null` with `trialRefusedReason: "ALREADY_CONSUMED"` when the
e-mail already had the plan's trial), and the client never sums a price. `requiresPaymentMethod`
says whether the confirm sends the visitor to the hosted page. A free plan, and a trial that needs
no payment method, complete at the first confirm. **The first confirm re-checks the trial**: when
another checkout used it up meanwhile, the session loses `trialEndsAt` and `dueToday` is recomposed,
and the confirm answers `requires_payment_method` with the new amount before any payment method is
captured. Show it. A trial that is refused only after the payment method was saved is a
`DueTodayChangedError`.

**While the payment is made**, `awaiting_payment` and then `getCheckoutSession` carry
`session.payment`: `processing` (wait and read again), `paid` (the session completes), `requires_action`
(the visitor must go to `hostedInvoiceUrl` to authorise the payment, 3-D Secure for instance) and
`failed` (the payment was refused: the same page lets them pay again). A session whose payment never
comes reads `EXPIRED`, and one left open for 24 hours `ABANDONED`.

**A Turnstile token is single-use**, a `dryRun` included, and **spent by any refusal of a start**
that got as far as the API, Turnstile out of reach apart (`InvalidEmail`, `InvalidReturnUrl`, `VoucherInvalid`, a price that is
not public, …): reset the widget and let the visitor pass it again before the next start. The client
refuses, before any request, an input the API would refuse for its shape: a missing token, both
forms of the price, no e-mail or return URL on a real start, a member of the wrong type, too long
(the API counts characters, not UTF-16 units: an e-mail 254, a return URL 2048, a voucher 64, a
plan 255, a reference 255, a Turnstile token 2048, at most 50 add-ons) or that the API does not know
(`returnURL` for `returnUrl`). That is a `TypeError`, and the token is still good.

A read is sent again after a network failure or a 5xx; **a write never is**, the start and the
confirm included. The class is made for a browser, with the publishable key: it refuses any
other kind of key, a `ksh_` included.

**`onAuthError`** is called for a refused credential only: a 401, or a 403 `Auth.WrongCredentialKind`.
A 403 that says anonymous checkout is turned off (`*.AnonymousCheckoutDisabled`) or that the origin is
not allowed (`PublicAuth.OriginNotAllowed`) is a configuration to fix, not a credential to renew:
the call rejects with its `KaitenError`, and the token is kept.

**What a visitor reads is yours to write.** The messages of the errors are for developers (`error.message`
and `detail` are English sentences about the API); map each class, and each `payment.status`, to your
own text and language instead of displaying them.

A cross-origin page reads `Retry-After` (the wait of a 429 or of `TurnstileUnavailable`) only if the
API's CORS policy sends `Access-Control-Expose-Headers: Retry-After` on these routes; without it the
client waits its default of 60 seconds, twice as long as the API asked for the Turnstile outage (30).

### Scopes

The API checks a token's scopes on every call. Give the token the scopes of the calls
you make:

| Call                                         | Scopes                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `components.getCatalog()`                    | `read:licenses`, `read:entitlements`                                                           |
| `components.getSnapshot()`                   | `read:licenses`, `read:entitlements`, `read:customers`, `read:instances`, `read:feature_flags` |
| `customers.*`                                | `read:customers`                                                                               |
| `instances.*`                                | `read:instances`                                                                               |
| `licenses.*`                                 | `read:licenses`                                                                                |
| `usage.getByInstance()`, `usage.getDetail()` | `read:instances`                                                                               |
| `usage.getByGroup()`                         | `read:entitlements`                                                                            |
| `usage.report()`                             | `write:instances`                                                                              |
| `flags.*`                                    | `read:feature_flags`                                                                           |

A call that needs a scope the token lacks is refused with `403` and the code
`Auth.MissingScope`. The two composed reads degrade instead of failing: when the API
refuses the GraphQL query for a missing scope, `getCatalog()` falls back to REST, which
needs only `read:licenses` but loses the presentation fields, and `onDegraded` reports
it; without `read:feature_flags`, the snapshot comes back with no flags.

## Quick start

On your backend:

```ts
import { KaitenClient } from "@kaitencloud/client";

const kaiten = new KaitenClient({
  apiUrl: process.env.KAITEN_API_URL!, // your Kaiten API's URL, /api included
  authScheme: "bearer",
  tokenProvider: () => process.env.KAITEN_API_TOKEN!, // a ksh_ token: it stays on the server
});

const catalog = await kaiten.components.getCatalog();
const snapshot = await kaiten.components.getSnapshot("acme-corp");
```

### Resource namespaces

- `kaiten.components` — embedded monetization: `getCatalog()`, `getSnapshot(customerId, instanceId?)`
- `kaiten.customers` / `kaiten.instances` / `kaiten.licenses` — curated reads
- `kaiten.usage` — entitlement usage (read + report)
- `kaiten.flags` — feature-flag evaluation (`evaluate`, `evaluateAll`)

## Reporting usage

A usage report is not idempotent: `append 500` sent twice counts 1 000. When a
report times out, the client cannot know whether the API counted it, so a report
without a key is sent **exactly once** and never retried.

Give it a `transactionId` and the API applies it once, whatever the number of
times it arrives. The client sends the key in the `Idempotency-Key` request
header; the body is the report alone.

```ts
import { KaitenError, TransactionIdReusedError } from "@kaitencloud/client";

try {
  const usage = await kaiten.reportUsage("acme-production", "tokens", {
    value: { type: "number", value: 1_250 },
    behavior: "append",
    transactionId: `llm-call:${callId}:tokens`, // 1 to 128 of [A-Za-z0-9._:-]
  });
  if (usage.idempotentReplayed) {
    // Already counted: `usage` is that report's original result, not the current gauge.
  }
} catch (error) {
  if (error instanceof TransactionIdReusedError) {
    // A bug in the caller: the key was used for another value. error.original names it.
  }
  throw error;
}
```

- **One key per measurement.** A key is scoped to the instance and the
  entitlement. The API remembers it for 35 days by default, and that window is
  what makes a retry safe: a report sent again under the same key inside it is
  applied once, while a key older than that is forgotten and counts as new. The
  same business event can feed two meters under one key. A correction is a new
  report under a new key, with `behavior: "set"` for an absolute value: under the
  original key it is refused with `TransactionIdReusedError` (409), which is
  never retried.
- **The echo.** A server that honours the key answers with it: the result's
  `transactionId` is the key the report was accepted under, on the first answer
  and on every replay, and `null` for a report sent without one.
- **Retries.** With a key, a report that fails on the network, times out or
  answers a 500, 502, 503 or 504 is retried, up to three attempts, all under the
  same key, after the `Retry-After` of the failure when it has one (see
  [Errors and retries](#errors-and-retries)), **once this client has received an
  echoed key**. Until then the failure surfaces after the first attempt, key sent
  all the same: a server that ignored the header would count the retry a second
  time, and only an echo says that this one does not. So the first keyed report of
  a client is never retried, and a client created for each request never retries.
  Any other status, a 501 for one, is returned as it came: asking again gets the
  same answer. A retry the API already applied resolves with
  `idempotentReplayed: true` and counts nothing. The memory is the client's, not
  the process's: another client keeps its own.
- **Older servers.** A server that predates the header ignores it: the report is
  counted every time it arrives, its answer carries no `transactionId`, and the
  client therefore never retries it. Send keys to a server that reads the header
  to get the protection.
- **No generated keys.** The client never makes a key up: without one, the body
  is the one you passed and the request carries no `Idempotency-Key` header.
- **Malformed keys** are refused before anything is sent, with an
  `InvalidTransactionIdError`: the same error the API answers a malformed key
  with (422, located at `header.Idempotency-Key`). An empty string is refused
  too, because the API reads an empty header as no key at all.
- **Browsers.** The header is not one a browser sends on its own: a page that
  reports usage from the browser triggers a preflight, which the API answers by
  allowing `Idempotency-Key`.
- **Dropped metadata.** `metadataDropped: "too_large"` says the report's
  `metadata` was above 4 KiB and was not stored. The report itself was counted.

## Errors and retries

A call the API refuses rejects with a `KaitenError`: its `status`, the problem's `code`
(`CreateSessionCheckout.AlreadySubscribed`), its `detail`, its `errorId` (quote it when you
report a problem) and, when the API sent a `Retry-After`, `retryAfterSeconds`. A request that
never reached the API rejects with a `KaitenNetworkError`.

Some refusals call for a reaction of their own. Each is a class that extends `KaitenError`,
so `instanceof KaitenError`, `status` and `code` keep working:

| Class                        | The API refused with                                                                                                          | It carries                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `QuotaExceededError`         | 422 `*.QuotaExceeded`: the instance already uses more than the plan a checkout would move it to allows, on a `dryRun` as well | `entitlementSlugs`, the ones over the plan |
| `RateLimitedError`           | 429 `*.RateLimited`                                                                                                           | `retryAfterSeconds`                        |
| `BoundaryPendingError`       | 409 `*.BoundaryPending`: the billing period that just ended is still being closed                                             | `retryAfterSeconds`                        |
| `ProviderUnavailableError`   | 503 `*.ProviderUnavailable`: the payment provider could not be reached                                                        | `retryAfterSeconds`                        |
| `TurnstileFailedError`       | 422 `*.TurnstileFailed`: a Turnstile token that is invalid, expired, already used or from another host                        |                                            |
| `TurnstileUnavailableError`  | 503 `*.TurnstileUnavailable`: Turnstile's verification could not be reached from Kaiten                                       | `retryAfterSeconds`                        |
| `CheckoutSessionClosedError` | 409 `*.SessionClosed`: an anonymous checkout confirmed after it closed                                                        | `sessionStatus`: how it closed             |
| `DueTodayChangedError`       | 409 `*.DueTodayChanged`: the amount due changed since the visitor was shown it                                                |                                            |

```ts
import { KaitenError, QuotaExceededError } from "@kaitencloud/client";

try {
  await billing.checkout({ licensePriceId, dryRun: true }); // the KaitenSessionClient above
} catch (error) {
  if (error instanceof QuotaExceededError) {
    // Offer a larger plan, or add-ons that make room for these entitlements.
    showOverQuota(error.entitlementSlugs);
  } else if (
    error instanceof KaitenError &&
    error.code === "CreateSessionCheckout.AlreadySubscribed"
  ) {
    showPortal();
  } else {
    throw error;
  }
}
```

Every other refusal (`AlreadySubscribed`, `VoucherInvalid`, `SetupSessionIncomplete`,
`OtherVersionAttached`, `AnonymousCheckoutDisabled`, `FallbackRequired`, …) is a plain
`KaitenError`, read by its `code`. The first four are recognized in
[`@kaitencloud/server`](../server) by predicates (`isQuotaExceeded` and the others); the
anonymous checkout is a browser's, and the server has none for the rest.

`CheckoutTokenMissingError` is raised by the anonymous checkout client itself, with status
`0` and before any request, when it holds no token for the session you name. The session may
have completed meanwhile: it is not a reason to start another checkout (see
[Anonymous checkout](#anonymous-checkout)).

**`retryAfterSeconds`** is the `Retry-After` the API sent, in seconds: a whole number, or
an HTTP date read as the seconds from now. It is absent when there is none. On the four
classes made to be waited out it is always a number, **60 when the response carries no
`Retry-After` the client can read**. A browser that calls another origin only sees that
header if the API's CORS policy exposes it (`Access-Control-Expose-Headers: Retry-After`);
without that, 60 is a default, not what the API asked.

**What the client sends again**

- A read is sent again after a network failure or a 5xx, and a usage report under a
  `transactionId` after a network failure or a 500, 502, 503 or 504, up to three
  attempts, once this client has read an echoed key (above). When the failure carries a `Retry-After`, the
  next attempt waits that long, **at most 30 seconds**; otherwise it backs off for a
  fraction of a second, then longer. A read refused because the provider is down is
  therefore asked again after the wait the API gave, not after 100 ms. A wait the client
  could not read (the 60 above) is not waited for: the retry backs off as it does for any
  other failure.
- A write is never sent again, whatever the answer: not after a 409, a 422, a 429 or a
  503, which say nothing of whether the first attempt took effect. The one exception is a
  usage report under a `transactionId` (above), which the API takes once however often it
  arrives, and which is sent again only after a server has echoed a key. Nor is any call after a 429, that one included; wait `retryAfterSeconds` and
  decide.
- A `BoundaryPendingError` reaches you with its delay and the client does not replay it.
  The change did not happen, and sending the same call again after `retryAfterSeconds` is
  yours to decide, usually once.

## Testing without an API — `@kaitencloud/client/testing`

Building or testing a Kaiten integration used to need a Kaiten account and a
reachable API. It doesn't: `@kaitencloud/client/testing` ships a fake client and
a set of licensing fixtures.

```ts
import { createMockKaitenClient } from "@kaitencloud/client/testing";

const client = createMockKaitenClient();
const catalog = await client.getCatalog();
const snapshot = await client.getLicensingSnapshot("acme");
```

No network: the fake implements `KaitenClientLike`, so code that takes a client
reads the fixtures through the same methods it calls on the real one.

### Driving a scenario

```ts
createMockKaitenClient({
  catalog: demoCatalogWithoutPrices(), // no amounts anywhere, as the API returns them
  snapshot: demoSnapshot({ license: null }),
  delayMs: 1500, // hold loading states still
  error: new Error("backend down"), // drive failure states
});
```

It is a **fake, not a stub**. `reportUsage` moves the usage it reports —
`currentValue`, `remaining`, `percentageUsed` and the `near_limit`/`over_limit`
status change together, as the snapshot normalizer does — so a usage meter that
looks right against the fixtures behaves the same against the API.

It echoes the key of a report as a current server does: the result's `transactionId` is the
`transactionId` you passed, `null` without one. It keeps no ledger of keys, so it never answers
a replay and never refuses a reused key: a test of either builds the result, or the error.

```ts
const client = createMockKaitenClient();
await client.reportUsage("acme-production", "seats", {
  value: { type: "number", value: 3 },
  behavior: "append",
});
client.snapshot.entitlements.find((e) => e.slug === "seats");
// → 24 / 25, remaining 1, status "near_limit"
client.usageReports; // every call, for assertions
```

### The session client

`createMockKaitenSessionClient()` does the same for the customer-session calls: anything
typed `KaitenSessionClientLike` takes it, so a customer portal or a checkout can be built
without a Kaiten that serves billing.

```ts
import { createMockKaitenSessionClient, demoUnsubscribedPortal } from "@kaitencloud/client/testing";

const session = createMockKaitenSessionClient({ portal: demoUnsubscribedPortal() });
const first = await session.checkout({
  licensePriceId: "price_growth_monthly",
  returnUrl: "https://app.acme.example/billing",
});
// → requires_payment_method: the customer has no payment method yet
```

It is a fake as well. A cancellation ends the subscription with its period and takes the
cancel action away, a checkout subscribes the instance and puts its first invoice at the
head of the list, and a quantity moves the add-on. What the API would refuse is refused
with its status and code, as a `KaitenError`. `checkout` scripts an outcome the model does
not cover (a trial, add-ons), `setPortal` swaps the scenario, and `calls` records what was
called.

To drive a screen into one of the [refusals](#errors-and-retries) that have a class of
their own, throw it from `checkout`:

```ts
import { QuotaExceededError } from "@kaitencloud/client";
import { createMockKaitenSessionClient } from "@kaitencloud/client/testing";

const session = createMockKaitenSessionClient({
  checkout: () => {
    throw new QuotaExceededError({
      title: "Unprocessable Entity",
      status: 422,
      code: "CreateSessionCheckout.QuotaExceeded",
      errors: [{ location: "body", message: "over", value: { entitlementSlugs: ["seats"] } }],
    });
  },
});
```

### The anonymous checkout client

`createMockKaitenAnonymousCheckoutClient()` plays an anonymous checkout: anything typed
`KaitenAnonymousCheckoutClientLike` takes it. A free plan and a trial with no card complete at
the first confirm; any other asks for a payment method and then for a payment, which the test
plays with `completeSetup(sessionId)` and `settlePayment(sessionId)`; `abandon(sessionId)`
leaves a session open until it is abandoned. A second trial for the same e-mail is refused as the
API refuses it, with `trialRefusedReason: "ALREADY_CONSUMED"`.

It checks the input as the client does (the same `TypeError`s: no token, no e-mail or return URL on
a real start, both forms of the price, a bound passed, an unknown member), and keeps the token of a
closed session until `forgetCheckoutSession`, after which every call on it rejects with a
`CheckoutTokenMissingError`. What the visitor can meet and a test must be able to play:

- `failPayment(id)` and `requireAction(id)`: the payment `failed`, or `requires_action`, with a
  `hostedInvoiceUrl`; `expire(id)`: the session reads `EXPIRED`.
- `consumeTrial(id)`: another checkout used up the trial. At the next confirm before the payment
  method is saved the session loses its trial and the confirm asks for a card with the new amount;
  after it, the confirm rejects with a `DueTodayChangedError`.
- `fail: { startCheckout, getCheckoutSession, confirmCheckout }`: an `Error`, or `(call) => Error | void`,
  to fail one method, or one call of it: the Turnstile token refused once, then accepted.

It does not check the Turnstile token's value, and it models neither add-ons (a `KaitenError`, 422
`AddonNotPublic`) nor vouchers.

Its options: `plans`, the `MockCheckoutPlan`s it sells (a `licenseSlug`, a `priceId`, a `billingPeriod`,
a `currencyCode`, an `amount` in minor units, and optionally `trialDays` and `requiresPaymentMethod`);
`delayMs`, to make loading states observable; `error`, to reject every call with it; and the `fail` above.
`demoAnonymousCheckoutPlans()` is the default for `plans`, and a good start to extend: a free Starter,
Growth monthly and annual, and Lite with a 14-day trial that asks for no card.

```ts
import {
  createMockKaitenAnonymousCheckoutClient,
  demoAnonymousCheckoutPlans,
} from "@kaitencloud/client/testing";

const checkout = createMockKaitenAnonymousCheckoutClient({
  plans: [
    ...demoAnonymousCheckoutPlans(),
    {
      licenseSlug: "pro-v1",
      priceId: "price_pro_monthly",
      billingPeriod: "MONTHLY",
      currencyCode: "USD",
      amount: 4900,
      trialDays: 7,
      requiresPaymentMethod: true, // a trial that asks for a card first
    },
  ],
});
```

### Fixtures

`demoCustomer` · `demoInstance` · `demoLicense` · `demoPlans` ·
`demoPlansWithoutPrices` · `demoCatalog` · `demoCatalogWithoutPrices` ·
`demoEntitlements` · `demoFlags` · `demoAddOns` · `demoCredits` ·
`demoSnapshot` · `demoSnapshotWithoutPrices`, and for the session client `demoPortal` ·
`demoUnsubscribedPortal` · `demoTrialPortal` · `demoSessionInvoices` · `demoSessionAddOns` ·
`demoCheckoutPrices` · `demoVouchers`, and for the anonymous checkout client
`demoAnonymousCheckoutPlans`

`demoTrialPortal(overrides)` is the portal of an instance in its trial: its `trial` block (the end,
the reminder, what the end charges and no card yet) is what a trial banner draws, and
`overrides` makes one that already has its card or that charges nothing (`trial.charge: null`).
`DEMO_TRIAL_ENDS_AT` is the instant that trial ends, and `DEMO_SESSION_NOW` the instant the
session fixtures and the anonymous checkout double are set at, for a test that fixes its clock
there.

Each is a **factory**, so one test's mutation cannot reach another, with fixed
ids and timestamps for stable assertions and visual baselines.

They are deliberately not the minimum that type-checks. Amounts are in minor
units (`7900` = $79.00); the metered `tokens` entitlement carries a sale unit
distinct from its base unit (`saleUnitFactor: 1_000_000`, so "$8 per 1M tokens"
is expressible); the catalog contains an **unpublished** license, a draft that is not for sale, so a
pricing page that renders the fixtures exercises its `published` filter;
and the resolved entitlements span every branch a UI must render — healthy, near
limit, over limit, unlimited, boolean, and one internal counter with
`userFacing: false`. The snapshot's `license.slug` matches a priced plan, so
joining the snapshot to the catalog's prices resolves.

### Bringing your own client

Type the client your code takes as `KaitenClientLike` — the five methods a UI
consumes (`getCatalog`, `getLicensingSnapshot`, `evaluateFlag`, `evaluateFlags`,
`reportUsage`) — rather than the `KaitenClient` class. The class has a private
field, so TypeScript types it nominally and no object could satisfy it
structurally; every double would end in `as unknown as KaitenClient`, a cast
that turns a checked substitution into an unchecked one. Implement the interface
instead, for a custom transport, cache or SSR arrangement. `KaitenClient`
implements it, so a real client still fits.

The customer-session calls are a second interface, `KaitenSessionClientLike`, which
`KaitenSessionClient` implements: a double of the session client implements that one.
[STABILITY.md](./STABILITY.md) says how the client surface grows within 1.x.

## Data path

With a publishable key, `getCatalog` reads `GET /public/catalog` and nothing else.
With any other credential, `getCatalog` / `getSnapshot` are **GraphQL-first**: one composed query against the
API's `/graphql` endpoint (a backend aggregate in kaiten) returns the customer,
its instances with live usage, and the full plan catalog with presentation metadata.
Against an older API without the GraphQL schema, the client **falls back** to
composing the same shape from existing REST endpoints (licenses, customers,
instances, entitlement usage). Snapshot feature flags are resolved **live via OFREP**
(bulk evaluation with the customer as targeting key) on both paths.

An entitlement's `limitValue` is what the instance is entitled to: the usage read's
`limit` when it carries one, the licence grant otherwise. A Kaiten server with add-ons
and vouchers answers that read with the instance's effective value — the grant with its
add-ons and boosts applied, which is what its usage gate enforces — and an older server
with the grant itself.

The allowance above it follows the same rule. `limitCapExceededOveragePercent` is the usage
read's when the read carries one (`-1` when the limit is unlimited), the grant's otherwise,
and `maximumAllowedUsage`, `remaining` and `status` are measured against the pair. The REST
usage reads (`usage.getByInstance`, `usage.getDetail`, `reportUsage`) also type what a
current server says of a row: `source`, the layer that grants the entitlement (`license` or
`addon`, and open: handle a value you do not know), and `provenance`, the licence's grant,
the add-ons and the voucher boosts the limit is made of, with the identifiers of the rows
they come from. All three are optional: an older server sends none. They also accept `null`:
the answer to a replayed report (`idempotentReplayed: true`) is rebuilt from the report's
journal entry, which keeps neither the layer nor its arithmetic, so its `source` and
`provenance` are `null`, and the percent is `null` for a flag or a configuration, which has no
value to cap. Check `row.source != null` before reading them. The GraphQL read does not select
them yet, so on that path the percent stays the grant's.

Commerce concepts the backend does not model — add-ons, credits, portal actions,
billing capabilities, branding — are returned as client-side defaults.

A client-side license-key `validate`/`activate` flow was removed: it required a backend
license-key model that Kaiten's managed-SaaS design (instances are bound to a license
server-side) does not have.

## Development

```bash
vp install
vp check
vp test
vp pack
vp run generate-graphql   # regenerate src/graphql/generated/ from the committed schema snapshot
```

`generate-graphql` reads the **committed schema snapshot**, `contracts/schema.graphql` at the repository root, so
building and publishing never need a kaiten checkout. Refreshing that snapshot is the
separate step, run from the repo root:

```bash
node scripts/sync-graphql-schema.mjs          # snapshot <- kaiten (KAITEN_PATH)
vp run @kaitencloud/client#generate-graphql   # types    <- snapshot
```

`node scripts/check-graphql-drift.mjs` guards both links. It matters more here than for
REST: GraphQL is the **primary** read path for `getCatalog` and `getLicensingSnapshot`, and
a failure falls back to the REST fan-out silently — so a schema change can kill the fast
path (and the presentation fields only GraphQL carries) without anything visibly breaking.

The generated OpenAPI client lives in `src/core/generated`; the committed OpenAPI
snapshot it is generated from lives in `contracts/openapi.yaml` at the repository root.

## License

Apache-2.0. See `LICENSE` and `NOTICE`, and `THIRD_PARTY_NOTICES.md` for the
third-party code this package bundles. The license does not grant permission to use
the Kaiten name or logos: see the
[trademark policy](https://github.com/kaitencloud/sdk-js/blob/main/TRADEMARKS.md).
