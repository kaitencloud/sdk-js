---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

The generated REST API follows Kaiten's billing contract: 315 operations, up from 162.

- `@kaitencloud/server`: the resource classes `Addons`, `Billing`, `CustomerSessions`, `Public`, `PublishableKeys` and `Vouchers`, new operations on the existing ones (the usage history and its two exports among them), and `transactionId` on the usage report body.
- `@kaitencloud/client`: the same operations and types under `KaitenApi`. `KaitenApi.EntitlementUsage` now requires `source` (`license` or `addon`), as the contract does; the client's own `EntitlementUsage` keeps it optional, so a usage row built against 1.0 still compiles.
- Lists of add-ons, vouchers, voucher redemptions and publishable keys answer a page (`items`, `hasMore`, `nextCursor`). Members that have no value are `null`. For the nullable objects the contract declares in a form the generator cannot express (a subscription's `scheduledChange`, a portal's `paymentMethod`), the generated type says `X` where `null` can arrive.
