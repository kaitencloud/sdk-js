---
"@kaitencloud/client": minor
---

The customer session and the catalogue read three more members the contract serves.

- `Addon.pendingQuantity`, on the add-ons of the portal and on the answer of `setAddonQuantity`, is a decrease scheduled for the next renewal: the quantity from then on, `0` for a removal. `quantity` stays what the instance holds until then. It is `null` when nothing is scheduled and absent from a server that predates it. The double schedules a lower quantity, or none, on a subscription that is live (in its trial, active or past due), where it used to apply it at once; it applies every change at once without one, and sending the quantity held cancels a scheduled decrease.
- `BillingPrice.billingTiming` is `"ADVANCE"` or `"ARREARS"`, as the API says when a price is billed. It is absent when the API says nothing.
- `KaitenPortal.branding` and `KaitenCatalog.branding` read the contract's `poweredByRemovable`: the vendor's plan lets its portal and storefront hide "Powered by Kaiten" only when it is `true`. The catalogue's `branding.removable` was always `false`; it now follows the API. `KaitenPortal.branding` is absent from a server that predates it, and `demoPortal()` says `{ removable: false }`.
