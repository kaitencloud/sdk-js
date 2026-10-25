---
"@kaitencloud/client": minor
---

Sync the canonical GraphQL snapshot to Kaiten `510ec73aa` (37 object types, up from 36) and regenerate
the typed documents. Billing, price, lifecycle, provider and usage-source fields now use real enums;
price status arguments are enums, and LicensePrice/AddonPrice expose `unitAmountDecimal` instead of
`unitAmount`. The schema also declares entitlement exceptions and their filter/kind/status enums.

Both shipped licensing documents remain unchanged and validate against the synced schema. Their
generated files are byte-for-byte unchanged: the changed fields/enums are outside their selections.
They still avoid the gated price/billing/add-on fields. A GraphQL `Billing.Disabled`, `Billing.NotEntitled`
or `Billing.EntitlementCheckUnavailable` error still degrades once and returns the REST licensing
read, even when the GraphQL response contains partial data; the regressions hold that fallback.
