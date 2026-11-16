---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
"@kaitencloud/ai-openai": minor
"@kaitencloud/ai-anthropic": minor
"@kaitencloud/ai-vercel": minor
"@kaitencloud/ai-claude-agent": minor
"@kaitencloud/ai-codex": minor
"@kaitencloud/ai-copilot": minor
---

AI credits (preview), explainable charges. Requires a Kaiten API version that ships them (to be set at release); the AI credits feature stays off until it is enabled on the platform.

- `ai.commit` takes an optional `vendorCost`: what the provider charged, in USD, as an exact decimal string, recorded beside the cost Kaiten computes and never changing the credits charged. It is validated locally, refused on a `NOT_SENT` commit, sent byte-identical on retries, and dropped with a warning, the commit going on, when the API predates it. The SDK never computes a cost.
- Every provider integration takes a `vendorCost` reader and an `onCommitError` hook: a commit that fails after its retries is handed over with a `retry()` that resends it byte for byte, instead of only being logged.
- Report answers carry the pricing `rule`; `AiUsageWarning` is an open union that includes `NO_RESERVATION`, `COUNTER_PRECISION_DEGRADED` and `PRICING_SNAPSHOT_UNREADABLE`.
- `ai.release()`, a `NOT_SENT` commit: without a reservation it leaves a tombstone, and a later reserve or commit under the same `transactionId` throws `TransactionIdReusedError`.
- Inference rows carry the pricing snapshot, licence, warnings, `reportSeq`, vendor cost, refunds and `credits.refunded`; `ai.listInferences` takes the `authorized`, `modelSlug`, `model` and `requestType` filters, and fills `refunds` and `warnings` with `[]` on a row from an older API.
- `ai.listOrganizationInferences()` lists the organization's inferences across instances and pools, cursor-paginated like `ai.listInferences`.
- `ai.refund()` gives credits of a committed inference back. Its idempotency key is generated when omitted and reused on retries; refusals throw `AiRefundError` and its subclasses (`AiInferenceNotFoundError`, `AiInferenceNotCommittedError`, `NothingToRefundError`, `RefundExceedsRefundableError`, `RefundIdempotencyKeyReusedError`, `AiPoolNotGrantedError`).
- A pool that is not an AI credit pool now throws `NotAnAiCreditPoolError` on every call, in `run` and in every wrapper, instead of degrading to unmetered calls. Degradation remains for an API that predates AI credits.
- Settlement fixes: a stream the provider answered is never settled `NOT_SENT`, even when closed before its first event (OpenAI, Anthropic, Vercel); a cancellation is `CUSTOMER_ERROR` and a timeout `PROVIDER_ERROR`, never `NOT_SENT`; `classifyProviderError` reads the AI SDK's `statusCode`; a Vercel call whose provider sends no usage no longer fails after the provider answered; a Codex or Claude Agent failure mid-stream is `PROVIDER_ERROR`, no longer `CUSTOMER_ERROR`.
- `@kaitencloud/server`: the regenerated `Instances.refundAiInference`, `Instances.listOrganizationAiInferences` and the new inference and conversion-rule members.
