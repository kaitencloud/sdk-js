---
"@kaitencloud/server": minor
---

`isQuotaExceeded`, `isRateLimited`, `isBoundaryPending` and `isProviderUnavailable` recognize the refusals of the billing routes that call for a reaction of their own (422 `*.QuotaExceeded`, 429 `*.RateLimited`, 409 `*.BoundaryPending`, 503 `*.ProviderUnavailable`), as `isThresholdExceeded` does for a usage report over its limit. `KaitenError` gains an optional `retryAfterSeconds`, the `Retry-After` of the response in seconds, absent when there is none.
