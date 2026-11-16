---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

The generated operations that take a publishable key name its header `Kaiten-Publishable-Key`, as the API contract now does: `KaitenApi.getPublicCatalog` and `KaitenApi.createCheckoutSession` in the client, `Public.getPublicCatalog` and `Public.createCheckoutSession` in the server.

- A call that passes the key in the `auth` option now sends it as `Kaiten-Publishable-Key`. A Kaiten server that predates the rename reads only `X-Kaiten-Publishable-Key`: upgrade it first, or set that header yourself instead of passing `auth`.
- `KaitenClient` and `KaitenAnonymousCheckoutClient` do not go through these operations.
