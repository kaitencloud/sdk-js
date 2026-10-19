# Kaiten AI credits for Anthropic

Server-side only; optional peer `@anthropic-ai/sdk` (`>=0.100.0 <1`).

```ts
import { wrapAnthropic } from "@kaitencloud/ai-anthropic";
const metered = wrapAnthropic(anthropic, { kaiten, instance: "acme", entitlement: "credits" });
```

`messages.create` and `messages.stream` reserve before the underlying request,
then commit disjoint input/cache usage and final output. The synchronous
`MessageStream` helper retains `on`, `finalMessage`, `withResponse` and abort
behavior; its internal `create().withResponse()` is metered exactly once.
Raw streamed `create` merges message-start input usage with message-delta output.

An `estimator(params)` can replace the bytes/4 heuristic. Timeout supplies a capped
reservation TTL. Reserve refusals stop the request; unsupported-server errors
log once and disable reporting; commit failures do not replace successful data.
Abandoned raw iteration reports `CUSTOMER_ERROR` with usage known so far.

Tested with installed SDK 0.135.0 and synthetic fetch responses. The wrapper has
no runtime provider import, global instrumentation, pricing or prompt reporting.
