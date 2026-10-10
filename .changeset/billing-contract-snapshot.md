---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

The generated REST API follows Kaiten's billing contract: 315 operations, up from 162.

- `@kaitencloud/server`: the resource classes `Addons`, `Billing`, `CustomerSessions`, `Public`, `PublishableKeys` and `Vouchers`, new operations on the existing ones (the usage history and its two exports among them), and `transactionId` on the usage report body.
- `@kaitencloud/client`: the same operations and types under `KaitenApi`. `KaitenApi.EntitlementUsage` now requires `source` (`license` or `addon`), as the contract does; the client's own `EntitlementUsage` keeps it optional, so a usage row built against 1.0 still compiles.
