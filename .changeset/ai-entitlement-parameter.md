---
"@kaitencloud/client": minor
"@kaitencloud/ai-openai": minor
"@kaitencloud/ai-anthropic": minor
"@kaitencloud/ai-vercel": minor
"@kaitencloud/ai-claude-agent": minor
"@kaitencloud/ai-codex": minor
"@kaitencloud/ai-copilot": minor
---

Use `entitlement` instead of `pool` in high-level AI target options and provider
wrappers. This aligns the unreleased AI API with the existing Entitlement resource;
the HTTP `entitlementSlug` path, pricing, reservations and credit-pool semantics
are unchanged. Update AI call sites from `{ instance, pool }` to
`{ instance, entitlement }`.
