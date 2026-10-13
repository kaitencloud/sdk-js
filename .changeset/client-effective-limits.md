---
"@kaitencloud/client": patch
---

The licensing snapshot measures each entitlement against what the instance is entitled to, not against the licence grant. Kaiten servers with add-ons and vouchers answer a usage read with the limit in force, boosts applied, which is what their usage gate enforces. The snapshot read the limit from the grant, so an instance with extra seats was shown over its limit while the server still accepted its reports, and one whose grant was soft but whose effective limit is hard was shown room it did not have.

- The usage read's `limit`, when it carries one, replaces the grant's, and `limitValue`, `unlimited`, `maximumAllowedUsage`, `remaining`, `percentageUsed` and `status` follow it.
- The row's own overage percent, when it carries one, replaces the grant's, and `maximumAllowedUsage`, `remaining`, `status` and `limitCapExceededOveragePercent` follow it.
- A server that predates either sends none, and the grant is used as before. The GraphQL read, whose document does not select the overage percent yet, keeps the grant's.
