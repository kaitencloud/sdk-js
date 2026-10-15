---
"@kaitencloud/client": minor
---

Four refusals a host acts on are classes of their own, all extending `KaitenError`, so `instanceof KaitenError`, `status`, `code` and `retryAfterSeconds` keep working and only `name` differs.

- `QuotaExceededError` (422 `*.QuotaExceeded`, `CreateSessionCheckout.QuotaExceeded` on a checkout and on a `dryRun`): `entitlementSlugs` names the entitlements the instance uses beyond the plan.
- `RateLimitedError` (429 `*.RateLimited`), `BoundaryPendingError` (409 `*.BoundaryPending`) and `ProviderUnavailableError` (503 `*.ProviderUnavailable`): `retryAfterSeconds` is always a number, the API's `Retry-After` or 60 when the response carries none the client can read, as in a browser calling another origin whose CORS policy does not expose the header.
- Every other refusal stays a `KaitenError`, read by its `code`.

`Retry-After` is read as a whole number of seconds or an HTTP date; any other value is no longer taken for a date (`-5` used to read as 0).

A read that fails on the network or with a 5xx, and a usage report under a `transactionId` that fails on the network or with a 500, 502, 503 or 504, once the client has read an echoed key, are sent again, up to three attempts. They now wait for the `Retry-After` of the failure when the response carried one the client could read, at most 30 seconds, instead of the backoff. No other write is sent again, and no call is sent again after a 429; a `BoundaryPendingError` reaches the host with its delay and the client does not replay it. `RetryOptions` gains an optional `delayOf`.
