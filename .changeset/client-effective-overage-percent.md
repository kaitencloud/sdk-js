---
"@kaitencloud/client": patch
---

The licensing snapshot measures an entitlement against the instance's effective overage percent, not the licence grant's. A Kaiten server answers its REST usage reads with the allowance of the limit in force, add-ons and voucher boosts applied, but the snapshot read the limit from the row and the percent from the grant, so an instance whose add-on brought a soft limit was shown over its limit while the server still accepted its reports, and one whose grant was soft but whose effective limit is hard was shown room it did not have. `maximumAllowedUsage`, `remaining`, `status` and `limitCapExceededOveragePercent` follow the row's percent when it carries one. A server that predates it, and the GraphQL read, whose document does not select it yet, keep the grant's.
