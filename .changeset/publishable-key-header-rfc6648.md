---
"@kaitencloud/client": minor
---

The publishable key is sent as `Kaiten-Publishable-Key`, without the `X-` prefix that RFC 6648 deprecates. It used to be `X-Kaiten-Publishable-Key`.

- `KaitenClient` with `authScheme: "publishable"` and `KaitenAnonymousCheckoutClient` send the key under the new name, to the same routes as before and nowhere else.
- Kaiten reads both names, the new one first, so a page on an earlier version of this package keeps working. A Kaiten server that predates the rename reads only `X-Kaiten-Publishable-Key`: upgrade it before this package.
- `defaultHeaders` still cannot carry a publishable key to a route it does not belong to, under either name.
