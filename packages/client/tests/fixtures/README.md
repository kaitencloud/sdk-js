# Fixtures

`fixtures-contract.test.ts` holds every answer in these files to its response schema in
`contracts/openapi.yaml`, so a sync of the snapshot that moves the contract fails there.

## `public-catalog.acme.json`

The body of `GET /public/catalog` for a fictional organization, Acme, read with
a publishable key. It is what Kaiten serves, member for member: a member the API
leaves out is absent here, not `null`, and the members that are `null` are the
ones the contract declares nullable (`trialPeriodDays`, `selfServeCtaUrl`,
`currency`, `maxQuantity`).

It is not written by hand. Kaiten's own code produced it: the catalogue is built
the way the route builds it, from the rows the route reads, with the functions
that project a price, a grant and a plan's self-serve flag onto the public
shapes, and marshalled with the same JSON encoder. Kaiten's integration test of
the route asserts on the response without recording it, and the route needs a
database, so nothing here ran a Kaiten server. The projection is the part that
decides what the SDK reads: `unitAmount` only for a whole number of minor units,
`unitAmountDecimal` as a plain decimal (`"0.0002"`), `saleUnitFactor` as a
string, a grant's `value` unwrapped from its stored form, and `capabilities.checkout`
true once a plan is self-serve. It was produced from Kaiten's billing contract at
the commit this repository's `contracts/openapi.yaml` snapshot comes from.

To regenerate it after the contract moves, from a checkout of Kaiten at the new
commit, run a throwaway test in the catalogue's package that assembles the
scenario below with the route's own functions and writes
`json.MarshalIndent(catalog, "", "  ")`, then format the file with `vp fmt`.
Do not edit it by hand.

The scenario, with the ids the tests name (`00000000-0000-4000-8000-` followed
by twelve hex digits):

| Plan       | Id   | What it shows                                                                                                        |
| ---------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| starter    | 0001 | FREE, a zero flat fee, self-serve                                                                                    |
| pro        | 0002 | monthly, quarterly, semi-annual and annual fees, a non-default fee, a price per 1M tokens and a price below one cent |
| growth     | 0003 | a 14-day trial, a payment method required                                                                            |
| lite       | 0004 | a 7-day trial, no payment method                                                                                     |
| enterprise | 0005 | CUSTOM: no price, a call to action, an unlimited grant                                                               |
| solo       | 0006 | PAID with no default flat fee, so not self-serve                                                                     |
| jp         | 0007 | JPY, which has no minor unit                                                                                         |
| kw         | 0008 | KWD, which has three                                                                                                 |

The add-ons are `extra-seats` (`00a1`, up to 50 units, two prices), `gpu-pack`
(`00a2`, in USD, unbounded) and `jp-pack` (`00a3`). Price ids are the plan's
number followed by the price's rank (`0201` is the first price of `pro`); an
add-on's are its id followed by the same (`a101`).

## `session.initech.json`

What the ten `/public/session/*` routes answer, for a fictional customer,
Initech, with a customer session (`kst_`). Each key is one answer, named for the
route and the case it shows; `errors` holds the refusals as `{ status, body,
retryAfter }`, where `retryAfter` is the `Retry-After` header in seconds. The
routes' own declared members are all there: a member the API sends as `null` is
`null`, and a member it leaves out is absent.

It is not written by hand. Kaiten's own code produced it: the portal's
entitlements and payment method go through the functions the portal route
builds them with, the subscription, the invoices and the add-ons through the
projections the session routes share, the checkout and the voucher check through
the response types of their routes, and the refusals through the function that
renders a problem. All of it is marshalled with the same JSON encoder. No route
ran, since each needs a database. It was produced from Kaiten's billing contract
at the commit this repository's `contracts/openapi.yaml` snapshot comes from, and
every answer is checked against its response schema in that file.

To regenerate it after the contract moves, from a checkout of Kaiten at the new
commit, run a throwaway test in the package of the portal route that assembles
the scenario below with those functions and writes
`json.MarshalIndent(fixtures, "", "  ")`, then format the file with `vp fmt`.
Do not edit it by hand.

| Key                                                                         | What it shows                                                                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portal`                                                                    | An instance-bound session, subscribed monthly: seven entitlements (a boosted number, an add-on's, a flag, a config, an unlimited one), two add-ons, two vouchers |
| `portalCanceling`, `portalScheduledChange`, `portalPastDue`                 | A subscription that ends with its period; one with a plan change scheduled; a quarterly one past due, with a payment method that has no labels                   |
| `portalCustomerWide`, `portalNeverSubscribed`                               | A session bound to the customer only, listing its instances; an instance with no subscription, whose plan can be bought alone                                    |
| `invoicesFirstPage`, `invoicesLastPage`, `invoicesEmpty`                    | Paid, payment-failed and manual invoices; a discount line has no unit amount                                                                                     |
| `checkoutPreview`, `checkoutPreviewTrial`                                   | What is due today with a discount; nothing due during a trial                                                                                                    |
| `checkoutRequiresMethod`                                                    | A payment method has to be saved first                                                                                                                           |
| `checkoutSubscribed`, `checkoutSubscribedAction`, `checkoutSubscribedTrial` | Paid; a payment that needs the customer's confirmation; a trial with no invoice                                                                                  |
| `cancel`, `reactivate`                                                      | The subscription after each                                                                                                                                      |
| `portalSession`, `paymentMethodSession`                                     | The provider's pages                                                                                                                                             |
| `paymentMethodCompleted`, `paymentMethodCompletedBare`                      | A payment method saved, with and without its labels                                                                                                              |
| `voucherPercent`, `voucherFixed`, `voucherBoost`, `voucherRefused`          | A repeating percentage, a one-time amount, forever boosts (one unlimited), and the answer to any code that does not apply                                        |
| `addon`, `addonDetached`                                                    | The quantity set; the add-on removed                                                                                                                             |

Ids are `00000000-0000-4000-8000-` followed by twelve hex digits: `0201`, `0202`
and `0204` are the monthly, quarterly and annual prices of the plan, `a101` and
`a102` the flat fee and the metered price of the `extra-seats` add-on.
