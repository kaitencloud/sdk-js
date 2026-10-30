# Node example

Kaiten's server-side packages in a small Node backend, with no framework:

- **`GET /catalog`** reads the catalog with `@kaitencloud/client` and a read-only
  `ksh_` token, for a pricing page rendered with `<KaitenProvider mode="static">`.
  The token stays on the server.
- **`POST /webhooks/kaiten`** verifies a webhook's signature with
  `@kaitencloud/server` before trusting it.
- **`GET /flags/:key`** evaluates a feature flag with OpenFeature and its
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

The HTTP sample has no authentication middleware and evaluates only `anonymous`.
It does not accept a query parameter to impersonate a customer. In a real backend,
derive the targeting key and optional `kaiten.instanceSlug` from your authenticated
principal and an authorized instance; the server credential scopes the organization.
Each call passes its own context, and provider errors/wrong types use the false default.
The provider uses a dedicated OpenFeature domain and a per-request header factory
for caller-owned token rotation; it never closes a supplied fetch implementation.
See [the 2.0 migration](../../MIGRATION-2.md) for browser-safe integration constraints.
