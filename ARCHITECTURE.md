# Architecture

This repository publishes four packages. Three boundaries shape them, and each is
enforced by the package graph rather than by convention.

## Browser and server

`@kaitencloud/client` is what a browser bundle imports. In a browser it never
holds a secret, and it never depends on `@kaitencloud/server`. On a server, the
same client may carry a `ksh_` token, as `examples/node` does.
`@kaitencloud/server` carries the full API contract behind a `ksh_` token and never
ships to a browser.

Underneath, the client's transport refuses to send a `ksh_`, `ksm_` or `sk_`
credential whenever a `window` exists. That check catches a mistake; it is not the
boundary. A secret that reached a browser is already public and has to be rotated.

The Platform API (`/api/platform/**`, authenticated by `ksm_` credentials) is not
modelled here. Its audience is Kaiten's own control plane, not the applications
these packages serve, and its contract is not published.

## Headless and components

`@kaitencloud/react` is the headless core: the provider, the hooks and the control
primitives (`Gate`, `Show`, `KaitenLoaded`, …). It renders no DOM and ships no
stylesheet. An application that draws everything in its own design system installs
it alone.

`@kaitencloud/react-ui` adds the styled components (`PricingTable`, `Paywall`,
`CustomerPortal`, …), `KaitenStyleRoot` and a precompiled stylesheet, and
re-exports the core. An application that wants Kaiten's components installs it.

The two version independently. The core is the stable surface; the components are
`@experimental`, as [`packages/react/STABILITY.md`](packages/react/STABILITY.md)
records. A change to a component never forces a release on an application that
only uses the hooks, and a headless application never pays for the components'
dependencies or stylesheet.

## Contracts, not sources

The API is described by two snapshots in [`contracts/`](contracts): `openapi.yaml`
and `schema.graphql`. The generated clients come from them, and CI checks that they
match what the API publishes. The code here is written against those snapshots and
never reads the API's source code.

The answers recorded in `packages/client/tests/fixtures` are the one place Kaiten's
code is involved: they were produced by running it once, in a throwaway test, and
are checked in. A test holds each of them to its schema in the snapshot, so a sync
that moves the contract fails where a fixture no longer fits.

## What the API serves to these clients

Kaiten serves routes made for these clients under `/public/`, and the contract
describes them like any other. A publishable key (`pk_`) reads the catalogue from
`GET /public/catalog` and from nothing else; the client refuses every other call
locally. A customer session (`kst_`), minted by the vendor's backend, is sent to
the `/public/session/*` routes of a portal and a checkout, through
`KaitenSessionClient`, and to nothing else.

With any other credential, `@kaitencloud/client` composes the catalogue and a
customer's licensing snapshot from the public API: a GraphQL aggregate first, and a
REST fan-out over existing endpoints as the fallback for older APIs, which code
comments call "Option A".

The design tokens come from the published `@kaitencloud/theme` package.
`@kaitencloud/react-ui` inlines them in its stylesheet, under the `--ktn-*` names
that `appearance.variables` overrides.

## Internal code

The generated OpenAPI client and the transport live in `packages/client/src/core`.
`@kaitencloud/client` re-exports them, the generated surface under the `KaitenApi`
namespace; they are not a separate package. `@kaitencloud/server` generates its own
client from the same snapshot.
