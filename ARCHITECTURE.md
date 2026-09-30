# Architecture

This repository publishes two packages. Two boundaries shape them, and each is
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

## Contracts, not sources

The API is described by two snapshots in [`contracts/`](contracts): `openapi.yaml`
and `schema.graphql`. The generated clients come from them, and CI checks that they
match what the API publishes. Nothing here reads the API's source code.

`@kaitencloud/client` composes the catalogue and a customer's licensing snapshot
from the public API: a GraphQL aggregate first, and a REST fan-out over existing
endpoints as the fallback for older APIs, which code comments call "Option A".
There are no endpoints dedicated to the SDK.

## Internal code

The generated OpenAPI client and the transport live in `packages/client/src/core`.
`@kaitencloud/client` re-exports them, the generated surface under the `KaitenApi`
namespace; they are not a separate package. `@kaitencloud/server` generates its own
client from the same snapshot.
