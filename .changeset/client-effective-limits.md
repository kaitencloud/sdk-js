---
"@kaitencloud/client": patch
---

The licensing snapshot measures each entitlement against what the instance is entitled to: the usage read's `limit`, when it carries one, instead of the licence grant. Kaiten servers with add-ons and vouchers answer that read with the instance's effective value, which their usage gate enforces, so an instance with extra seats is no longer shown over its limit while the server still accepts its reports. `limitValue`, `unlimited`, `maximumAllowedUsage`, `remaining`, `percentageUsed` and `status` follow it. Older servers answer with the grant, so nothing changes against them.
