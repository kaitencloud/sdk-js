---
"@kaitencloud/client": minor
---

`getCatalog` takes optional arguments that narrow the public catalog: `getCatalog({ familySlug })` reads one licence family, and `getCatalog({ include: "none" })` leaves the public add-ons out (`"addons"`, the default, lists them). They are read with a publishable key; a client with another credential composes its catalog from the licences endpoints and ignores them. An empty `familySlug`, or an `include` other than `"addons"` and `"none"`, throws a `TypeError` before any request. `KaitenClientLike.getCatalog` and `KaitenComponentsModule.getCatalog` accept the same optional argument, so a double written against 1.0, which takes none, still satisfies them.

`catalog.capabilities.checkout` is read from the response, where the API says whether a plan of the catalog can be bought alone. It is not worked out from the plans' `selfServe`.
