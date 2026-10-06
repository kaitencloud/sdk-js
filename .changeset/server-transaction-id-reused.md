---
"@kaitencloud/server": minor
---

A usage report refused because its `transactionId` was already used for another report (409 `ReportEntitlementUsageMetric.TransactionIdReused`) now throws `TransactionIdReusedError`, a `KaitenError` that carries the `transactionId` it was sent with and names the original report. `isTransactionIdReused` recognizes it.
