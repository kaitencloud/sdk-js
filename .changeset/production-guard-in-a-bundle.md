---
"@kaitencloud/client": patch
"@kaitencloud/react": patch
"@kaitencloud/react-ui": patch
---

The development-only warnings are silent in a production bundle.

They were guarded by `typeof process !== "undefined" && process.env.NODE_ENV === "production"`. A bundler replaces `process.env.NODE_ENV` only as a whole expression and leaves the `typeof process` check, which is false in a browser, so the guard never saw production: a Vite, webpack or esbuild build printed them to its users' consoles. Each package now reads `process.env.NODE_ENV` through one helper that a bundler can replace and that counts as development where there is no `process` and nothing replaced it.

- `@kaitencloud/client`: the warning that a customer with several instances, and no `instanceId`, had one chosen for it.
- `@kaitencloud/react`: the warnings of a redundant nested `KaitenProvider`, of a `hideBranding` the license does not allow, of an entitlement slug that matched nothing, and of a paywall under a provider with no customer. That last one read `process.env.NODE_ENV` with no guard at all, and threw a `ReferenceError` from an effect in a browser that loaded the package without a bundler.
- `@kaitencloud/react-ui`: the warnings of a missing `KaitenStyleRoot`, of a `PricingTable` plan with no price, and of a hard `Paywall` with no `onUpgrade`.

The warnings' text stays in a production bundle: minifiers do not inline the helper, so they cannot drop the code behind it. It is never reached there.

The `react-ui · Paywall + KaitenProvider + KaitenStyleRoot` bundle budget rises from 52 250 to 52 650 bytes gzip (measured at 52 329, up from 52 220): the warning of a paywall under a provider with no customer used to be dropped by bundlers, and stays now that its guard is safe without one.
