# React example

Kaiten's React packages in a Vite app, running on fixture data: no account, no API
key, no network.

- **Kaiten's components**: a `PricingTable` rendered from a static catalog, and a
  `CustomerPortal` for a customer, from `@kaitencloud/react-ui`.
- **Your own UI**: the same catalog drawn with this app's own elements through
  `usePlans()`, and a `Gate` around this app's own button, from the headless
  `@kaitencloud/react`.

```bash
vp install
vp run -r build
cd examples/react-vite
vp dev
```

The fixtures come from `@kaitencloud/client/testing`. In a real app, the catalog is
read server-side (see [`examples/node`](../node)) and the portal's provider gets
`apiUrl`, `accessToken` and `customerId` instead of a fake client.

This example is also where `scripts/check-bundle-size.mjs` resolves its import
scenarios from, the way a real application's bundler would.
