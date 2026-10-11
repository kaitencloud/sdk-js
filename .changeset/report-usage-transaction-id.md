---
"@kaitencloud/client": minor
---

`reportUsage` accepts an optional `transactionId`, the idempotency key a Kaiten server applies a usage report once by.

- With a key, and only then, a report that fails on the network, times out or answers a 500, 502, 503 or 504 is retried, up to three attempts under the same key. Another status, a 501 for one, is returned as it came. Without one, a report is still sent exactly once, with the same body as before. The client never makes a key up.
- The result says what the response headers said: `idempotentReplayed: true` when the report had already been applied under its key (`Idempotent-Replayed`), and `metadataDropped` when its metadata was not stored (`Kaiten-Metadata-Dropped`). The new `ReportUsageResult` type describes it.
- A key reused for another report rejects with `TransactionIdReusedError`, which names the original report and is never retried. A malformed key rejects with `InvalidTransactionIdError`, before anything is sent. Both are `KaitenError`s.
- Against a server that predates the member, the client sends that report again without its key when the server refuses it with a 422, warns once, and sends the client's later reports without a key, and so without retries.
- `KaitenTransport.run` takes an `onResponse` option, which receives the response of the attempt that succeeded.
