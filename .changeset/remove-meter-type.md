---
"@kaitencloud/client": minor
---

Remove the `MeterType` type and the `Entitlement.meterType` field, which the Kaiten API never had.

An entitlement has no meter type in the Kaiten API, and neither contract this package is built from declares one, so no call ever returned the field. Code that names `MeterType` or reads `meterType` stops compiling: delete the reference. Nothing changes at run time.
