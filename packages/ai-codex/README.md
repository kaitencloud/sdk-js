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
