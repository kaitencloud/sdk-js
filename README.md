# Kaiten SDK for JavaScript

TypeScript packages for [Kaiten](https://kaiten.sh): gate features on licences and
entitlements, report usage, and show pricing and paywalls. Flag decisions use OpenFeature.

## Packages

| Package                                      | Use it for                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@kaitencloud/server`](packages/server)     | Node backends: the full API contract behind a `ksh_` token, and webhook verification.                                                                         |
| [`@kaitencloud/client`](packages/client)     | The catalogue, a customer's licensing snapshot, usage reports and flag evaluation. Built for browsers, where it never holds a secret; it runs on servers too. |
| [`@kaitencloud/react`](packages/react)       | React, headless: the provider, the hooks and `Gate` / `Show`, for apps that draw their own UI.                                                                |
| [`@kaitencloud/react-ui`](packages/react-ui) | React components: `PricingTable`, `Paywall`, `CustomerPortal` and more, themed through `appearance`. It re-exports `@kaitencloud/react`.                      |

All four packages are on npm. The React packages read the public catalogue and the
customer sessions that Kaiten billing serves; see the "Kaiten version" section below.

The design tokens the components use ship separately, as
[`@kaitencloud/theme`](https://www.npmjs.com/package/@kaitencloud/theme).

**Flag evaluation is exclusively OpenFeature SDK + official OFREP provider**, never a Kaiten SDK method.
See [the breaking 2.0 migration](MIGRATION-2.md). Use its official providers:
[`@openfeature/ofrep-web-provider`](https://www.npmjs.com/package/@openfeature/ofrep-web-provider)
in a browser, [`@openfeature/ofrep-provider`](https://www.npmjs.com/package/@openfeature/ofrep-provider)
in Node. Kaiten implements the protocol, so no Kaiten provider is needed, and
[`examples/node`](examples/node) shows the Node one.

A secret key never goes in a browser bundle. A browser holds one of two credentials of
its own: a publishable key (`pk_`), which reads the catalogue, and a customer session
(`kst_`), which your backend mints for a signed-in customer and which reads that
customer's licensing snapshot and billing. `@kaitencloud/server` issues both, as
[its README](packages/server#publishable-keys) explains, and `@kaitencloud/client` is
the one that uses them. Everything else goes through your backend: `@kaitencloud/server`
covers the whole API, and `@kaitencloud/client` runs there too, as
[`examples/node`](examples/node) shows. A React page can render what a backend read:
`<KaitenProvider mode="static">` takes a catalogue as plain data, with no credential and
no request.

## Install

```bash
npm install @kaitencloud/client      # catalogue, snapshot and usage
npm install @kaitencloud/server      # a Node backend
```

For React:

```bash
npm install @kaitencloud/react-ui    # the React components, with the headless core
npm install @kaitencloud/react       # the headless React core only
```

Each package's README has its quick start, and [`examples/`](examples) holds a
React app and a Node backend that run without an account.

## Kaiten version

Minimum Kaiten version for the billing features: **the first Kaiten release with billing.** No Kaiten release carries billing yet.

What needs it is the billing surface: the public catalogue read with a publishable key, a
customer session and the portal and checkout it opens, and the `Idempotency-Key` header of a
usage report (its `transactionId`). Everything `@kaitencloud/client` and `@kaitencloud/server` 1.0.0 did works against
the Kaiten releases it worked against, and `mode="static"` of the React packages makes no
request. Each package's README says what it asks of the server.

## Credentials

| Prefix   | What it is                                                                                            | Where it may live           | Consumed by                                              |
| -------- | ----------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `pk_`    | Publishable key: reads the catalogue and nothing that belongs to a customer                           | Browser                     | `@kaitencloud/client`, `@kaitencloud/react`              |
| `kst_`   | Customer session: minted by your backend for one customer, valid for 5 to 60 minutes                  | Browser                     | `@kaitencloud/client`, `@kaitencloud/react`              |
| `ksh_`   | Access token, scoped to one organization                                                              | Server only                 | `@kaitencloud/server`, `@kaitencloud/client` on a server |
| `ksm_`   | Platform credential: authenticates `system:kaiten`, carries **no** organization, and reaches them all | Kaiten's control plane only | no package here                                          |
| `sk_`    | Secret key of a future in-app mode, reserved and not issued yet                                       | Server only                 | —                                                        |
| `whsec_` | Webhook signing secret, not an API credential                                                         | Server only                 | `@kaitencloud/server` (`verifyKaitenWebhook`)            |

`ksm_` is listed even though nothing here uses it, because the browser guard has to
recognise it: it is the widest credential the platform issues, and an unrecognised
prefix would be reported as a malformed publishable key.

The three server-only API prefixes are refused at request time by
`@kaitencloud/client`'s transport whenever a `window` exists. That check catches a
mistake early; it is not a security boundary. A secret that reached a browser is
already public and has to be rotated.

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) covers building, testing and releasing, and
[ARCHITECTURE.md](ARCHITECTURE.md) explains why the packages are split the way they
are. Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

Kaiten SDK for JavaScript is open source and licensed under the
[Apache License, Version 2.0](./LICENSE).

By contributing, you agree to certify your contribution under the
[Developer Certificate of Origin 1.1](./DCO.md).

The Kaiten name and logos are not licensed under Apache-2.0. See the
[Kaiten trademark policy](https://github.com/kaitencloud/kaiten/blob/main/TRADEMARKS.md).
