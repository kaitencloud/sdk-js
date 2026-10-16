---
"@kaitencloud/client": minor
---

The generated REST API under `KaitenApi` follows Kaiten's billing contract: 316 operations, up from 162, with their request and response types.

- `KaitenApi.EntitlementUsage` now requires `source` (`license` or `addon`), as the contract does; the client's own `EntitlementUsage` keeps it optional, so a usage row built against 1.0 still compiles.
- Lists of add-ons, vouchers, voucher redemptions and publishable keys answer a page (`items`, `hasMore`, `nextCursor`). Members that have no value are `null`, nullable objects included (a subscription's `scheduledChange`, a portal's `paymentMethod`), and the generated types say `X | null` for them.
- A subscription's status may be `INCOMPLETE`: a public checkout waiting for its first payment. The statuses of an instance's billing, a session's subscription, the billing events and a portal's instances all take it.
- An invoice says whether it is `overdue` when read, the grace period of automatic collection included, which is what the list's `overdue` filter selects; the answers of writes and the event payloads carry `false`. A draft may be held because its provider cannot take that many lines (`holdReason: "PROVIDER_ITEM_LIMIT"`) as well as for its usage journal.
- The usage report of `KaitenApi` takes its idempotency key in the `Idempotency-Key` header, and its answer, `ReportedEntitlementUsage`, echoes the key as `transactionId`.
- The list of metadata fields takes `includeArchived` (`KaitenApi.ListMetadataFieldsData`), as the server's does.
- `KaitenApi` follows the contract and is outside the stability guarantee of 1.x; the curated surface does not move with it.
