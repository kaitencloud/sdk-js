# @kaitencloud/ai-codex

## 0.1.0

First release, on npm under the Apache License 2.0. Prompt-level gating for the Codex SDK. `wrapCodexThread(thread, { kaiten, instance, entitlement, model })` reserves credits once before each prompt a thread runs (`run`, `runStreamed`) and commits the prompt's total usage. A Codex prompt can make several model calls inside; they are not gated one by one.

- Needs `@kaitencloud/client` 2.0 or later, whose `ai` API it calls, and Kaiten 26.11.3 or later. AI credits stay off until they are enabled on the platform. Server-side only, Node.js 22.12 or later.
- `@openai/codex-sdk` (`>=0.163.0 <0.170.0`) is an optional peer, never imported at runtime.
- A refused reservation stops the prompt before it runs, and a commit that fails never replaces the thread's result.
- An entitlement that is not an AI credit pool throws `NotAnAiCreditPoolError`. An API that predates AI credits is logged once, and the calls go on unreported.
- `vendorCost` reads what the provider charged off its answer, as an exact decimal string in USD, recorded beside the cost Kaiten computes; it never changes the credits charged, and the package never computes one. `onCommitError(error, failed)` receives a commit that failed after its retries, with `failed.retry()` to resend it byte for byte; without it the failure is logged.
- A failure in the middle of a stream is `PROVIDER_ERROR`.
