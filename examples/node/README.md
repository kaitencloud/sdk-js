# Node example

Kaiten's server-side packages in a small Node backend, with no framework:

- **`GET /catalog`** reads the catalog with `@kaitencloud/client` and a read-only
  `ksh_` token, for a static pricing page. The token stays on the server.
- **`POST /webhooks/kaiten`** verifies a webhook's signature with
  `@kaitencloud/server` before trusting it.
- **`GET /flags/:key?user=…`** evaluates a feature flag with OpenFeature and its
  generic OFREP provider, `@openfeature/ofrep-provider`: Kaiten implements the
  protocol, so this route needs no Kaiten package.

```bash
vp install
vp run -r build
cd examples/node
node src/server.ts
```

Without credentials, the catalog comes from fixtures and the other routes say which
variable is missing. With an account, set:

| Variable                | Value                                                                             |
| ----------------------- | --------------------------------------------------------------------------------- |
| `KAITEN_API_URL`        | Your API's base URL, `/api` included                                              |
| `KAITEN_API_TOKEN`      | A `ksh_` token with `read:licenses`, `read:entitlements` and `read:feature_flags` |
| `KAITEN_WEBHOOK_SECRET` | The `whsec_` secret of your webhook endpoint                                      |

`vp test` runs the tests, which need neither an account nor the network.
