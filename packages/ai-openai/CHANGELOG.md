# @kaitencloud/ai-openai

## 0.1.1

### Patch Changes

- [#54](https://github.com/kaitencloud/sdk-js/pull/54) [`03cddb1`](https://github.com/kaitencloud/sdk-js/commit/03cddb17a8946e7a71c0dbf8500ae18bac40ad41) Thanks [@Lleios](https://github.com/Lleios)! - Published by the release workflow, with npm provenance, a git tag and a GitHub release. The code is unchanged from 0.1.0.

## 0.1.0

First release, on npm under the Apache License 2.0. Kaiten AI credits for the OpenAI SDK. `wrapOpenAI(openai, { kaiten, instance, entitlement })` reserves credits before each allow-listed call (`chat.completions.create`, `responses.create`, `embeddings.create`, `images.generate`, `audio.transcriptions.create`, `audio.speech.create`) and commits what it used afterwards.

- Needs `@kaitencloud/client` 2.0 or later, whose `ai` API it calls, and Kaiten 26.11.3 or later. AI credits stay off until they are enabled on the platform. Server-side only, Node.js 22.12 or later.
- `openai` 7 is an optional peer, never imported at runtime.
- A refused reservation stops the call before the provider runs, and a commit that fails never replaces the provider's result.
- An entitlement that is not an AI credit pool throws `NotAnAiCreditPoolError`. An API that predates AI credits is logged once, and the calls go on unreported.
- `vendorCost` reads what the provider charged off its answer, as an exact decimal string in USD, recorded beside the cost Kaiten computes; it never changes the credits charged, and the package never computes one. `onCommitError(error, failed)` receives a commit that failed after its retries, with `failed.retry()` to resend it byte for byte; without it the failure is logged.
- Streams commit on completion. Breaking a stream's iteration commits `CUSTOMER_ERROR` with the usage known; a cancellation is `CUSTOMER_ERROR` and a timeout `PROVIDER_ERROR`, never `NOT_SENT`.
