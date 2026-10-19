# Claude Agent usage observer — accounting, not preflight enforcement

Optional peer `@anthropic-ai/claude-agent-sdk` ~0.3.303. Server-side only.

```ts
import { observeClaudeAgent } from "@kaitencloud/ai-claude-agent";
const messages = query({ prompt, options: { includePartialMessages: true } });
for await (const message of observeClaudeAgent(messages, { kaiten, instance, entitlement })) {
  // Render the unchanged message locally.
}
```

**Decision/limitation:** no public general before-each-model-request hook exists.
This adapter never reserves after the provider has already run and never claims
that a credit refusal can prevent a model request. It directly commits one
operation per unique response under `<runId>:<index>`, merging `message_start`
input/cache usage with `message_delta` final output. Partial messages are required;
assistant messages alone carry placeholder output. Cumulative result usage is not
charged again. Parent-tool identity separates subagent streams; model comes from
the response. A partial response on abandonment is committed as CUSTOMER_ERROR.
Commit failures are logged without hiding SDK messages.

Evidence: [official cost tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
and [published SDK declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.303/sdk.d.ts).
The optional dev SDK verifies the types; tests replay synthetic typed events and
never start Claude. This is a documented partial fulfillment of D4's agent gate,
not a transparent per-model-turn gating implementation.
