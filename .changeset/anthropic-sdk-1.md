---
"@kaitencloud/ai-anthropic": patch
---

Accept `@anthropic-ai/sdk` 1.x: the optional peer range is now `>=0.100.0 <2.0.0`. `wrapAnthropic` reads `messages.create` and `messages.stream` as it did on 0.x, and its tests run against 1.8.0.
