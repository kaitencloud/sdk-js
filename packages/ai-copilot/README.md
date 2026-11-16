# Copilot usage observer — accounting, not preflight enforcement

Optional peer `@github/copilot-sdk` ^1.0.22. Server-side only.

```ts
import { observeCopilotSession } from "@kaitencloud/ai-copilot";
const observer = observeCopilotSession(session, { kaiten, instance, entitlement });
// After session work completes:
observer.dispose();
await observer.flush();
```

Deduplicated `assistant.usage` events directly commit per-call usage with the
actual model and `<runId>:<index>`. Event callbacks remain synchronous; `flush`
awaits pending accounting and `dispose` removes only this listener. No prompt,
completion, local pricing or cumulative session totals are reported.

**Decision/limitation:** event listeners return void and cannot block the runtime
before a model request. No reserve is fabricated after the call. Experimental
requestHandler HTTP/WebSocket interception exists but changes the data-path surface
and requires physical-retry and per-WebSocket-message correlation; this adapter
instead documents post-call accounting only. It does not fulfill D4 preflight
stopping for Copilot.

Evidence: [released event types](https://cdn.jsdelivr.net/npm/@github/copilot-sdk@1.0.22/dist/types.d.ts)
and [request handler](https://cdn.jsdelivr.net/npm/@github/copilot-sdk@1.0.22/dist/copilotRequestHandler.d.ts).
Tests use installed SDK types and synthetic events; no Copilot runtime starts.

`vendorCost` (optional) reads what the provider charged for a call off its answer
and returns an exact decimal string in USD, committed beside the cost Kaiten
computes; it never changes the credits charged. The package never computes one:
pass only a figure the provider or a gateway reports. A reader that throws or
returns anything but a decimal string is logged, and the commit goes on without
it. `onCommitError(error, failed)` receives a commit that failed after its
retries; `failed.retry()` resends it byte for byte. Without it the failure is
logged. This observer only commits, after the fact: a refused commit, a pool that
is not an AI credit pool included, goes to `onCommitError`. The `assistant.usage` event's `cost` is Copilot's billing multiplier, not a
price in USD: do not return it as `vendorCost`.
