---
"@kaitencloud/client": minor
---

`reportUsage` accepts an optional `transactionId`, the idempotency key a Kaiten server applies a usage report once by. The client sends it in the `Idempotency-Key` request header; the body is the report alone, as it was before keys existed.

- A report whose server has answered with an echoed key is retried when it fails on the network, times out or answers a 500, 502, 503 or 504, up to three attempts under the same key. Another status, a 501 for one, is returned as it came. The result's new `transactionId` member is that echo: the key the report was accepted under, on the first answer and on every replay, `null` for a report sent without one. The client keeps no list of keys; it remembers, per client, that its server has echoed one. Until then a failed keyed report surfaces after its first attempt, key sent all the same, because a server that ignored the header would count a retry twice. A report without a key is sent exactly once, with no header. The client never makes a key up.
- The result says what the response headers said: `idempotentReplayed: true` when the report had already been applied under its key (`Idempotent-Replayed`), and `metadataDropped` when its metadata was not stored (`Kaiten-Metadata-Dropped`). The new `ReportUsageResult` type describes it.
- A key reused for another report rejects with `TransactionIdReusedError`, which names the original report and is never retried. A malformed or empty key rejects with `InvalidTransactionIdError`, before anything is sent. Both are `KaitenError`s, and a refusal from the API is located at `header.Idempotency-Key`.
- `KaitenTransport.run` takes an `onResponse` option, which receives the response of the attempt that succeeded.
