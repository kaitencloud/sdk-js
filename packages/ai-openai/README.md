# Kaiten AI credits for OpenAI

Server-side only. Install this package alongside `openai` 7 and `@kaitencloud/client`.

```ts
import { wrapOpenAI } from "@kaitencloud/ai-openai";
const metered = wrapOpenAI(openai, { kaiten, instance: "acme", pool: "credits" });
```

The wrapper delegates the user's client, retaining its own unlisted resources and
bound methods. `chat.completions.create`, `responses.create`, `embeddings.create`,
`images.generate`, `audio.transcriptions.create` and `audio.speech.create` each
reserve before the request and commit afterwards. Provider packages are optional
peers, not imported or re-exported at runtime.

Streaming chat forces usage reporting and hides the extra final usage chunk unless
the caller requested it. Streams commit on completion; breaking iteration commits
`CUSTOMER_ERROR` with known usage (or `NOT_SENT` if no event arrived). Consume or
cancel streams: an untouched stream retains its reservation until expiry.

`estimator` overrides the bytes/4 heuristic and declared output maximum. Timeout
sets the reservation TTL, capped at one hour. Transcriptions with no estimate and
speech responses without usage report only what is known; the server may charge
its configured minimum. No local pricing or inferred audio duration is supplied.

Reserve refusals propagate before the provider is called. An unsupported AI server
logs once and degrades to unreported calls; failed commits are logged and do not
replace a successful result. Metadata must never contain prompts or personal data.

Compatibility tests use OpenAI 7.38.0 with synthetic custom-fetch responses, never
live API calls or credentials.
