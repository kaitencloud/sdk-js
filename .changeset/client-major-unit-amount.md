---
"@kaitencloud/client": minor
---

`majorUnitAmount(price)` gives a price's amount in the currency's major units as an exact decimal string, to show it without a floating-point number: `"49"` for a `4900` EUR fee, `"12.5"` for `12500` KWD, `"2"` for `200` EUR per 1M tokens, and `"0.000002"` for a usage price of `unitAmountDecimal: "0.0002"` per call, which `Intl.NumberFormat` formats as `€0.000002`. It reads `unitAmountDecimal` of a `BillingPrice` or a `PlanPrice`, or the integer `amount` when there is none, and returns `undefined` for a currency the API does not know or an amount that is not a plain decimal. A usage price stays per sale unit: it is not divided down to a measured unit, and no usage price is part of a plan's headline `price`.
