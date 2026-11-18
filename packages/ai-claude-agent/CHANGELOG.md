# @kaitencloud/ai-claude-agent

## 0.1.1

### Patch Changes

- [#54](https://github.com/kaitencloud/sdk-js/pull/54) [`03cddb1`](https://github.com/kaitencloud/sdk-js/commit/03cddb17a8946e7a71c0dbf8500ae18bac40ad41) Thanks [@Lleios](https://github.com/Lleios)! - Published by the release workflow, with npm provenance, a git tag and a GitHub release. The code is unchanged from 0.1.0.

## 0.1.0

First release, on npm under the Apache License 2.0. Usage accounting for the Claude Agent SDK. `observeClaudeAgent(messages, { kaiten, instance, entitlement })` commits the usage of each model response the agent streams. It observes after the call: the SDK has no hook before each model request, so a credit refusal cannot stop one.

- Needs `@kaitencloud/client` 2.0 or later, whose `ai` API it calls, and Kaiten 26.11.3 or later. AI credits stay off until they are enabled on the platform. Server-side only, Node.js 22.12 or later.
- `@anthropic-ai/claude-agent-sdk` (`~0.3.303`) is an optional peer, never imported at runtime.
- `vendorCost` reads what the provider charged off its answer, as an exact decimal string in USD, recorded beside the cost Kaiten computes; it never changes the credits charged, and the package never computes one. `onCommitError(error, failed)` receives a commit that failed after its retries, with `failed.retry()` to resend it byte for byte; without it the failure is logged.
- A failure in the middle of a stream is `PROVIDER_ERROR`, and a partial response left behind is committed as `CUSTOMER_ERROR`.
