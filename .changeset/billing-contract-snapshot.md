---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

The generated REST API follows Kaiten's billing contract: 315 operations, up from 162.

- `@kaitencloud/server`: the resource classes `Addons`, `Billing`, `CustomerSessions`, `Public`, `PublishableKeys` and `Vouchers`, new operations on the existing ones (the usage history and its two exports among them), and the `Idempotency-Key` header of the usage report, which answers a `ReportedEntitlementUsage` that echoes the key as `transactionId`.
- `@kaitencloud/client`: the same operations and types under `KaitenApi`. `KaitenApi.EntitlementUsage` now requires `source` (`license` or `addon`), as the contract does; the client's own `EntitlementUsage` keeps it optional, so a usage row built against 1.0 still compiles.
- Lists of add-ons, vouchers, voucher redemptions and publishable keys answer a page (`items`, `hasMore`, `nextCursor`). Members that have no value are `null`, nullable objects included (a subscription's `scheduledChange`, a portal's `paymentMethod`), and the generated types say `X | null` for them.
- `@kaitencloud/server`: the webhook of a cancelled plan change is named `com.kaiten.instance.billing.v1.plan_change_canceled`, as the contract spells it, and its payload and request types follow (`OnInstanceBillingPlanChangeCanceledWebhookPayload`). Every webhook request now types its `headers` (`EventHeaders`: the trace context of the request that produced the event, and the instance it concerns).
