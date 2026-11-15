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

The fixtures come from `@kaitencloud/client/testing`. This example uses two of the
provider's modes, and a real app picks the ones that fit its credentials:

- **`mode="static"`** is the pricing section. It takes a catalog the host already holds
  and makes no request. In a real app, the catalog is read server-side (see
  [`examples/node`](../node)) and passed in as plain data.
- **`mode="authenticated"`** is the portal section, with a fake client in place of the
  API. A real app gives it `apiUrl`, `accessToken` and `customerId` instead, and the
  token is one it is prepared to expose in a browser: it carries rights over a whole
  organization.
- **`mode="customer-session"`** is not drawn here. With Kaiten billing, it is how a page
  reads one signed-in customer's subscription, entitlements and invoices. The host's
  backend mints a customer session (`CustomerSessions.createCustomerSession` of `@kaitencloud/server`), and the
  page builds a `KaitenSessionClient` that fetches it from there:

  ```tsx
  const sessionClient = new KaitenSessionClient({
    apiUrl: "https://kaiten.example.com/api",
    getCustomerSession: () => fetch("/billing/session", { method: "POST" }).then((r) => r.json()),
  });

  function Plan() {
    const { data: portal } = usePortal();
    return <p>{portal?.subscription?.status}</p>;
  }

  <KaitenProvider mode="customer-session" sessionClient={sessionClient}>
    <Plan />
  </KaitenProvider>;
  ```

  Without an account, `createMockKaitenSessionClient` from `@kaitencloud/client/testing`
  stands in for the client. The core's README has the whole section:
  [Customer session](../../packages/react/README.md#customer-session).

This example is also where `scripts/check-bundle-size.mjs` resolves its import
scenarios from, the way a real application's bundler would.
