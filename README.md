# Kaiten SDK for JavaScript

TypeScript packages for [Kaiten](https://kaiten.sh): gate features on licences and
entitlements, report usage, show pricing and paywalls, and evaluate feature flags.

## Packages

| Package                                  | Use it for                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@kaitencloud/server`](packages/server) | Node backends: the full API contract behind a `ksh_` token, and webhook verification.                                                                         |
| [`@kaitencloud/client`](packages/client) | The catalogue, a customer's licensing snapshot, usage reports and flag evaluation. Built for browsers, where it never holds a secret; it runs on servers too. |

To evaluate feature flags through OpenFeature, use its generic OFREP providers:
[`@openfeature/ofrep-web-provider`](https://www.npmjs.com/package/@openfeature/ofrep-web-provider)
in a browser, [`@openfeature/ofrep-provider`](https://www.npmjs.com/package/@openfeature/ofrep-provider)
in Node. Kaiten implements the protocol, so no Kaiten provider is needed, and
[`examples/node`](examples/node) shows the Node one.

A secret key never goes in a browser bundle. This release has no credential for your end
users' browsers yet, so call Kaiten from your backend: `@kaitencloud/server` covers the
whole API, and `@kaitencloud/client` runs there too, as [`examples/node`](examples/node)
shows.

## Install

```bash
npm install @kaitencloud/client    # catalogue, snapshot, usage and flags
npm install @kaitencloud/server    # a Node backend
```

Each package's README has its quick start, and [`examples/`](examples) holds a
Node backend that runs without an account.

## Credentials

| Prefix   | What it is                                                                                            | Where it may live           | Consumed by                                              |
| -------- | ----------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `pk_`    | Publishable key, not accepted by the API yet                                                          | Browser                     | `@kaitencloud/client`                                    |
| `ksh_`   | Personal access token, scoped to one organization                                                     | Server only                 | `@kaitencloud/server`, `@kaitencloud/client` on a server |
| `ksm_`   | Platform credential: authenticates `system:kaiten`, carries **no** organization, reaches every tenant | Kaiten's control plane only | no package here                                          |
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

The Kaiten SDK for JavaScript is open source and licensed under the
[Apache License, Version 2.0](LICENSE).

By contributing to it, you agree to certify your contribution under the
[Developer Certificate of Origin 1.1](DCO.md). See
[CONTRIBUTING.md](CONTRIBUTING.md) for details.

The Kaiten name, logos, and other brand assets are not licensed under
Apache-2.0. See [TRADEMARKS.md](TRADEMARKS.md).
