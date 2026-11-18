# @kaitencloud/ai-copilot

## 0.1.0

First release, on npm under the Apache License 2.0. Usage accounting for the GitHub Copilot SDK. `observeCopilotSession(session, { kaiten, instance, entitlement })` commits the usage of each model call a session reports. It observes after the call: the SDK's events cannot block a model request, so a credit refusal cannot stop one.

- Needs `@kaitencloud/client` 2.0 or later, whose `ai` API it calls, and Kaiten 26.11.3 or later. AI credits stay off until they are enabled on the platform. Server-side only, Node.js 22.12 or later.
- `@github/copilot-sdk` (`^1.0.22`) is an optional peer, never imported at runtime.
- `vendorCost` reads what the provider charged off its answer, as an exact decimal string in USD, recorded beside the cost Kaiten computes; it never changes the credits charged, and the package never computes one. `onCommitError(error, failed)` receives a commit that failed after its retries, with `failed.retry()` to resend it byte for byte; without it the failure is logged.
