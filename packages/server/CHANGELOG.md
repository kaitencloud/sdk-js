# @kaitencloud/server

## 1.0.1

### Patch Changes

- [#6](https://github.com/kaitencloud/sdk-js/pull/6) [`170e614`](https://github.com/kaitencloud/sdk-js/commit/170e614d35d1b9cf3928b0d4eeeba5124ea1f053) Thanks [@Alexkuva](https://github.com/Alexkuva)! - Documentation corrections. The code that runs is unchanged.

  - `@kaitencloud/server`: the README and the doc comment of `KaitenWebhookEvent` count the 55 `com.kaiten.*` events the contract declares, not 49. The README lists the 17 resource classes, `LicenseFamilies` and `Notifications` included, and names a token's expiry `expiresAt`.
  - `@kaitencloud/client`: the package description says the client never holds a secret in a browser. On a server it may carry a `ksh_` token.

## 1.0.0

First public release, on npm under the Apache License 2.0.
