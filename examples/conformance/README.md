# Conformance suite

A customer's whole journey through a running Kaiten, taken with `@kaitencloud/client` and
`@kaitencloud/server` alone, with each answer held to the API contract.

| Step       | What it does                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------- |
| catalogue  | reads the catalogue with a publishable key and picks a plan a customer can buy alone               |
| session    | the vendor's backend mints a customer session; the customer reads their portal                     |
| dry run    | a checkout previews what is due, and changes nothing                                               |
| setup      | a checkout with no card sends the customer to the payment provider's page, which is then completed |
| checkout   | the same checkout subscribes, and bills what the preview said                                      |
| invoices   | the activation invoice is listed, paid, with a hosted page and a PDF                               |
| cancel     | the subscription ends with its period                                                              |
| reactivate | the cancellation is withdrawn                                                                      |
| revoke     | the session is revoked, twice, and the next portal read is refused                                 |

Two things are checked on every step, apart from what the step promises. Each credential
stays on its own routes: the publishable key on `/public/catalog`, the customer session on
`/public/session/*`, the vendor's token on `/customer-sessions`. And the JSON Kaiten sent,
read from the wire and not from what the SDKs made of it, is held to the response that
`contracts/openapi.yaml` declares for that operation and status: a required member that is
missing, a `null` where the contract has a string, an answer the contract never listed.

## Run it against a Kaiten

The suite needs a Kaiten API that serves billing, an organization with a public catalogue,
and a Stripe account in test mode that the organization is connected to. It subscribes the
instance it is given, so the instance has to have no subscription, **a new one for each run**.
Set these, then run it:

| Variable                             | Value                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `KAITEN_CONFORMANCE_API_URL`         | The API's URL, `/api` included: `http://localhost:8080/api`                                                            |
| `KAITEN_CONFORMANCE_PUBLISHABLE_KEY` | A publishable key (`pk_`) of the organization                                                                          |
| `KAITEN_CONFORMANCE_SERVER_TOKEN`    | A token (`ksh_`) that holds `write:customer_sessions`                                                                  |
| `KAITEN_CONFORMANCE_CUSTOMER_SLUG`   | A customer of the organization                                                                                         |
| `KAITEN_CONFORMANCE_INSTANCE_SLUG`   | One of that customer's instances, with no subscription                                                                 |
| `KAITEN_CONFORMANCE_RETURN_URL`      | Where the payment page sends the customer back: a URL on an origin the publishable key allows                          |
| `KAITEN_CONFORMANCE_STRIPE_TEST_KEY` | A Stripe test-mode key of that account (`sk_test_` or `rk_test_`), to complete the payment page. A live key is refused |
| `KAITEN_CONFORMANCE_SETUP_MODULE`    | Instead of the Stripe key: the path of a module that completes the payment page another way (below)                    |
| `KAITEN_CONFORMANCE_PLAN_SLUG`       | Optional. The plan to buy. By default, the first plan of the catalogue that is paid and self-serve                     |
| `KAITEN_CONFORMANCE_BILLING_EMAIL`   | Optional. Where invoices go. Default `conformance@example.test`                                                        |
| `KAITEN_CONFORMANCE_STRIPE_API_URL`  | Optional. Another Stripe API, such as a mock. Default `https://api.stripe.com`                                         |

```bash
vp install
vp run -r build
cd examples/conformance
KAITEN_CONFORMANCE_API_URL=http://localhost:8080/api \
KAITEN_CONFORMANCE_PUBLISHABLE_KEY=pk_… \
KAITEN_CONFORMANCE_SERVER_TOKEN=ksh_… \
KAITEN_CONFORMANCE_CUSTOMER_SLUG=… \
KAITEN_CONFORMANCE_INSTANCE_SLUG=… \
KAITEN_CONFORMANCE_RETURN_URL=https://… \
KAITEN_CONFORMANCE_STRIPE_TEST_KEY=sk_test_… \
vp test conformance.spec.ts
```

With none of the variables set the suite skips and prints what it needs; `vp run -r test`
does that in the ordinary run. With some set, or one that cannot be right, it fails and says
which: a repository that lost a secret must not look like a suite that passed.

### Completing the payment page

The one step that no SDK takes is the customer saving a card on the provider's hosted page.
By default the suite does it through the Stripe API, the way Stripe's test mode allows: it
reads the setup session's SetupIntent and confirms it with the test card `pm_card_visa`,
then reads the Checkout session again and fails unless it is `complete`, which is what Kaiten
waits for. Whether Stripe lets a session complete that way from outside its hosted page has
not been proven against a real account; until it has, a module is the safer choice for CI. The
path depends on how the Stripe account and Kaiten's connection to it are set up, so it can be
replaced: set `KAITEN_CONFORMANCE_SETUP_MODULE` to a module whose default export is

```js
export default async function completeSetup({ setupUrl, setupSessionId }) {
  // Drive a browser to setupUrl, click through a fake provider's page, or call
  // whatever the stack under test offers. Return once the card is saved.
}
```

## Without a Kaiten

`tests/` rehearses the journey against a stand-in that answers with the recorded fixtures of
`@kaitencloud/client`, so the suite's own code is tried on every `vp run -r test`: that it takes the
routes in order, keeps the credentials on theirs, and fails, saying what is wrong, on an API
that breaks the contract or the journey. It proves nothing about Kaiten.

The suite runs in CI as `.github/workflows/conformance.yml`, with the variables above taken
from the repository's secrets.
