---
"@kaitencloud/client": minor
---

Add the `ai` namespace for AI credits (KTN-201): `kaiten.ai.reserve()`, `kaiten.ai.commit()` and `kaiten.ai.run()` on an AI credit pool, the `fromOpenAI` / `fromAnthropic` usage normalisers, and the typed errors `InsufficientCreditsError`, `ModelNotAuthorizedError`, `UnknownModelError`, `TransactionIdReusedError` and `AiUsageUnsupportedError`. Both phases are keyed by `transactionId` (a UUIDv7 by default) and retried three times on network errors and 500/502/503/504 under one `Idempotency-Key`; never on a 4xx.

The `KaitenClient alone` bundle budget rises from 12.5 to 14.0 KB gzip: every `KaitenClient` carries the `ai` module (12.0 KB measured).
