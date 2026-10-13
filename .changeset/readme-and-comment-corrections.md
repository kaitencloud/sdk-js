---
"@kaitencloud/client": patch
"@kaitencloud/server": patch
---

Documentation corrections. The code that runs is unchanged.

- `@kaitencloud/server`: the README and the doc comment of `KaitenWebhookEvent` count the 55 `com.kaiten.*` events the contract declares, not 49. The README lists the 17 resource classes, `LicenseFamilies` and `Notifications` included, and names a token's expiry `expiresAt`.
- `@kaitencloud/client`: the package description says the client never holds a secret in a browser. On a server it may carry a `ksh_` token.
