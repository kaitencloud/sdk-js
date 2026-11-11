# Codex thread wrapper — prompt-level gating

Optional peer `@openai/codex-sdk` ~0.163.0. Server-side only.

```ts
import { wrapCodexThread } from "@kaitencloud/ai-codex";
const metered = wrapCodexThread(thread, {
  kaiten,
  instance,
  entitlement,
  model: "configured-model",
});
```

`run` and `runStreamed` reserve once before the submitted prompt executes and
commit aggregate completion usage. Each prompt gets `<runId>:<index>`; reserve
refusal prevents invocation. Streaming preserves events and reports abandonment.
Pass an estimator for prompt-level estimates; the explicit model is necessary
because completion events do not identify the model.

**Decision/limitation:** SDK turn means an entire submitted prompt, potentially
many internal model calls. There is no public per-inference preflight or model
identity event, so this wrapper cannot gate/account each internal model turn or
model switch independently. Do not represent its aggregate turn as an inference.

Evidence: [released API](https://cdn.jsdelivr.net/npm/@openai/codex-sdk@0.163.0/dist/index.d.ts)
and [thread implementation](https://github.com/openai/codex/blob/main/sdk/typescript/src/thread.ts).
Tests verify SDK types with synthetic thread doubles; no Codex process or API call.

`vendorCost` (optional) reads what the provider charged for a call off its answer
and returns an exact decimal string in USD, committed beside the cost Kaiten
computes; it never changes the credits charged. The package never computes one:
pass only a figure the provider or a gateway reports. A reader that throws or
returns anything but a decimal string is logged, and the commit goes on without
it. `onCommitError(error, failed)` receives a commit that failed after its
retries; `failed.retry()` resends it byte for byte. Without it the failure is
logged. A pool that is not an AI credit pool throws `NotAnAiCreditPoolError` on
every call; only an API that predates AI credits degrades.
