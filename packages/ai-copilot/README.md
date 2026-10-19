# Copilot usage observer — accounting, not preflight enforcement

Optional peer `@github/copilot-sdk` ^1.0.22. Server-side only.

```ts
import { observeCopilotSession } from "@kaitencloud/ai-copilot";
const observer = observeCopilotSession(session, { kaiten, instance, pool });
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
