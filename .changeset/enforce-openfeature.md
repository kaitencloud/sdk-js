---
"@kaitencloud/client": major
"@kaitencloud/server": major
"@kaitencloud/react": major
"@kaitencloud/react-ui": major
---

BREAKING: enforce OpenFeature SDK + official OFREP providers for all flag decisions. Remove direct client evaluation methods/facades, generated client and server OFREP operations, evaluation helpers and React evaluation hooks. Licensing reads no longer evaluate flags and return an empty flag display list. Remove flag conditions from `Show` and `flagKey` from `Gate`, `usePaywallTrigger` and `Paywall`; entitlement gating and management CRUD are unchanged.

Use `@openfeature/server-sdk` with `@openfeature/ofrep-provider` on your backend. Browser/React integrations use the official Web/React SDK and `@openfeature/ofrep-web-provider` only with an authorized, browser-safe OFREP endpoint; never expose a Kaiten `ksh_` secret. See `MIGRATION-2.md` for removed symbols, context/authentication and failure handling. Already-published 1.x versions and immutable consumer fixtures are not rewritten; there are no compatibility aliases.
