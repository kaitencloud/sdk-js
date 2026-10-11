# Fixtures

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
