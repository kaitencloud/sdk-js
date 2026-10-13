---
"@kaitencloud/server": minor
---

The generated resource classes follow Kaiten's billing contract: 316 operations, up from 162.

- New classes: `Addons`, `Billing`, `CustomerSessions`, `Public`, `PublishableKeys` and `Vouchers`. The existing ones gain operations, the usage history and its two exports among them, and the `Idempotency-Key` header of the usage report, which answers a `ReportedEntitlementUsage` that echoes the key as `transactionId`. Its `source` and `provenance` are always present, and `null` on a replay (`Idempotent-Replayed`), whose answer is rebuilt from a journal that keeps neither.
- Lists of add-ons, vouchers, voucher redemptions and publishable keys answer a page (`items`, `hasMore`, `nextCursor`). Members that have no value are `null`, nullable objects included (a subscription's `scheduledChange`, a portal's `paymentMethod`), and the generated types say `X | null` for them.
- The webhook of a cancelled plan change is named `com.kaiten.instance.billing.v1.plan_change_canceled`, as the contract spells it, and its payload and request types follow (`OnInstanceBillingPlanChangeCanceledWebhookPayload`). Every webhook request now types its `headers` (`EventHeaders`: the trace context of the request that produced the event, and the instance it concerns).
- A subscription's status may be `INCOMPLETE`: a public checkout waiting for its first payment. The statuses of an instance's billing, a session's subscription, the billing events and a portal's instances all take it.
- An invoice says whether it is `overdue` when read, the grace period of automatic collection included, which is what the list's `overdue` filter selects; the answers of writes and the event payloads carry `false`. A draft may be held because its provider cannot take that many lines (`holdReason: "PROVIDER_ITEM_LIMIT"`) as well as for its usage journal.
- The event sent three days before a trial ends, `com.kaiten.instance.billing.v1.trial_will_end` (`OnInstanceBillingTrialWillEndWebhookPayload`, whose `data` is the instance's billing), joins the webhook unions. The list of metadata fields takes `includeArchived`.
- The resource classes and their types are generated from the contract and are outside the stability guarantee of 1.x: a contract change can change them in a minor release.
