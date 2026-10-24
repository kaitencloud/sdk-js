---
"@kaitencloud/client": patch
---

Replay AI reserve/commit requests using their transactionId and identical phase/body,
without the numeric usage Idempotency-Key header, including headers inherited from
transport defaults. Keep AiIdempotencyKeyUnsupported as a caller error rather than
silently degrading provider wrappers to unmetered calls. Clarify adapter preflight
limitations and preserve exact credit amounts and numeric AI pool read values.
