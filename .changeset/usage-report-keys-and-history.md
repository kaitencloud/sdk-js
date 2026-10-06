---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

Usage report transaction IDs and the usage history.

- `@kaitencloud/client`: `ReportUsageInput.transactionId` makes a report idempotent, so a keyed report is retried on network errors and 5xx under the same key; a report without a key is still sent once. A key already used for a different report throws `TransactionIdReusedError` (never retried); a malformed one throws a `TypeError` before any request. `usage.reportDetailed` (and `reportUsageDetailed`) also returns `replayed` and `metadataDropped`. Against an API without `transactionId`, the report is resent without it and the client stops sending keys, warning once. `usage.history` (and `listUsageReports`) lists an instance's entitlement usage reports, following the pages.
- `@kaitencloud/server`: the contract gains `transactionId` on the usage report body and the `listUsageReports`, `exportUsageReports` and `exportOrganizationUsageReports` operations. `isTransactionIdReused` recognises the reused-key conflict.
