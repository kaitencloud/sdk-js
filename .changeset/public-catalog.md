---
"@kaitencloud/client": minor
---

Public catalogue with a publishable key.

- With `authScheme: "publishable"` and a `pk_` key, `components.getCatalog()` (and `getCatalog`) reads `GET /api/public/catalog` and nothing else: the organization's public plans with their prices and user-facing entitlements, and the public add-ons. It never falls back to GraphQL or the REST fan-out, which refuse a publishable key. Bearer clients read the catalogue as before.
- New optional fields, so nothing breaks: `PlanPrice.id`, `intervalCount` (3 for quarterly, 6 for semi-annual), `unitAmountDecimal`, `billingModel`, `meteredEntitlementSlug`, `saleUnitFactor`, `isDefault`; `Plan.pricingType`, `selfServe`, `selfServeCtaUrl`, `trialPeriodDays`, `requiresPaymentMethod`; `Addon.familySlug`, `maxQuantity`; `KaitenCatalog.addOns` and `capabilities`.
- A metered price can cost a fraction of a minor unit (half a cent per token). Its `amount` is then that fraction, not a whole number of minor units: format it from `unitAmountDecimal`, per sale unit, and never add metered prices to a headline.
