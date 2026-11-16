# Kaiten middleware for Vercel AI SDK

Server-side only; optional peer `ai` 7. Supports language-model V4 calls.

```ts
import { wrapLanguageModel } from "ai";
import { kaitenMiddleware } from "@kaitencloud/ai-vercel";
const metered = wrapLanguageModel({
  model,
  middleware: kaitenMiddleware({ kaiten, instance: "acme", entitlement: "credits" }),
});
```

Each generation or streaming model call (including tool-loop steps) reserves
before execution, then reports disjoint usage. Output total includes reasoning;
it is not added twice. `estimator(params)` overrides the default heuristic.
Streaming finishes, error events and explicit reader cancellation settle the call.
Consume or cancel the returned stream; an untouched stream expires server-side.

Refused reserves prevent model execution; unsupported APIs degrade with a log;
failed commits preserve provider results. No runtime `ai` import, pricing, prompt
or completion reporting. Tested through AI 7.0.143's real `wrapLanguageModel` API
with a synthetic V4 model; no network requests.

`vendorCost` (optional) reads what the provider charged for a call off its answer
and returns an exact decimal string in USD, committed beside the cost Kaiten
computes; it never changes the credits charged. The package never computes one:
pass only a figure the provider or a gateway reports. A reader that throws or
returns anything but a decimal string is logged, and the commit goes on without
it. `onCommitError(error, failed)` receives a commit that failed after its
retries; `failed.retry()` resends it byte for byte. Without it the failure is
logged. A pool that is not an AI credit pool throws `NotAnAiCreditPoolError` on
every call; only an API that predates AI credits degrades.
