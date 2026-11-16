---
"@kaitencloud/react": patch
"@kaitencloud/react-ui": patch
---

Prices in 16 currencies show the amount the API bills, no longer 100 times more (1,000 times for the Iraqi dinar).

- `@kaitencloud/react`: `formatKaitenMoney`, and so the `formatMoney` of every built-in language pack, read a currency's minor-unit exponent from the runtime's `Intl` data. For AFN, ALL, COP, HUF, IDR, IRR, KPW, LAK, LBP, MGA, MMK, PKR, SOS, SYP and YER that data counts no minor unit where the API counts two, and for IQD none where the API counts three: `formatKaitenMoney(4900, "HUF")` wrote `HUF 4,900` for 49 forints. The exponent is now the API's, the one `majorUnitAmount` of `@kaitencloud/client` reads. `Intl` still gives the symbol, the grouping and the decimals shown, and its exponent only for a currency the API does not know. In those 16 currencies, which the locale writes in whole major units, an amount with a fraction of one shows that fraction: 4950 fillér are `HUF 49.5`, not `HUF 50`. Nothing changes for any other currency.
- `@kaitencloud/react-ui`: the pricing table, the checkout flows, the trial banner, the billing summary and the customer portal follow, through the `formatMoney` of the localization.

A `formatMoney` a host writes takes the same minor units: read the exponent with `majorUnitAmount`, not from `Intl`.

The bundle-size budgets of the scenarios that format a price are raised by what this adds, the API's table of minor units, about 0.95 KB gzip. A bundle that imports `formatKaitenMoney` or a language pack without the provider gains about 1.2 KB more, the client's GraphQL documents, which a host with the provider ships already.
