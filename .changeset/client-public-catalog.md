---
"@kaitencloud/client": minor
---

A publishable key (`pk_`) now reads the public catalog, `GET /public/catalog`, served by Kaiten servers that ship billing.

- With `authScheme: "publishable"`, `getCatalog()` sends the key in `X-Kaiten-Publishable-Key` to that route only, with no `Authorization` header and no cookie, and with no GraphQL or REST fallback. Every other call of such a client is refused before any request, with a `KaitenError` of status 0: a publishable key was never accepted anywhere else. Clients with `"bearer"` or `"none"` compose the catalog as before.
- The catalog carries the public add-ons (`catalog.addOns`) and what the organization offers to self-serve customers (`catalog.capabilities`). Plans gain `billingPrices`, `pricingType`, `trialPeriodDays`, `requiresPaymentMethod`, `selfServe`, `selfServeCtaUrl` and `compatibleAddonFamilies`; add-ons gain `familySlug`, `pricingType`, `maxQuantity`, `quantity`, `billingPrices` and `compatibleLicenseFamilies`. All are optional.
- `PlanPrice` gains the optional `id`, `unitAmountDecimal`, `intervalCount`, `billingModel`, `meteredEntitlementSlug`, `saleUnitFactor` and `isDefault`. `plan.prices` and `addon.prices` hold only the default monthly and annual flat fees, which the 1.0 shape describes faithfully; every price, quarterly, usage-based and fractional ones included, is in the new `billingPrices`, typed `BillingPrice`, whose `amount` is absent when the price is not a whole number of minor units.
- `KaitenError` gains `retryAfterSeconds`, read from a `Retry-After` response header.
