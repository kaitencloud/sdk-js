# @kaitencloud/ai-vercel

## 0.1.0

First release, on npm under the Apache License 2.0. Kaiten AI credits for the Vercel AI SDK. `kaitenMiddleware({ kaiten, instance, entitlement })`, for `wrapLanguageModel`, reserves credits before each generation or streaming call of a language model (V4), tool-loop steps included, then commits its usage.

- Needs `@kaitencloud/client` 2.0 or later, whose `ai` API it calls, and Kaiten 26.11.3 or later. AI credits stay off until they are enabled on the platform. Server-side only, Node.js 22.12 or later.
- `ai` 7 is an optional peer, never imported at runtime.
- A refused reservation stops the call before the provider runs, and a commit that fails never replaces the provider's result.
- An entitlement that is not an AI credit pool throws `NotAnAiCreditPoolError`. An API that predates AI credits is logged once, and the calls go on unreported.
- `vendorCost` reads what the provider charged off its answer, as an exact decimal string in USD, recorded beside the cost Kaiten computes; it never changes the credits charged, and the package never computes one. `onCommitError(error, failed)` receives a commit that failed after its retries, with `failed.retry()` to resend it byte for byte; without it the failure is logged.
- A stream the provider answered is never settled `NOT_SENT`; a cancellation is `CUSTOMER_ERROR` and a timeout `PROVIDER_ERROR`. A call whose provider sends no usage does not fail.
