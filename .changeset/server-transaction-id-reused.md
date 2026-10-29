---
"@kaitencloud/server": minor
---

A usage report refused because its key was already used for another report (409 `ReportEntitlementUsageMetric.TransactionIdReused`) now throws `TransactionIdReusedError`, a `KaitenError` that carries the key the request's `Idempotency-Key` header held, as `transactionId`, and names the original report. `isTransactionIdReused` recognizes it.
