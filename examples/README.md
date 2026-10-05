# Examples

The first two run on fixture data, without an account.

- [`react-vite`](react-vite): the prebuilt components of `@kaitencloud/react-ui`,
  and a page that draws its own UI with the headless `@kaitencloud/react`.
- [`node`](node): a Node backend that reads the catalog for a static pricing page,
  verifies webhooks and evaluates feature flags.
- [`conformance`](conformance): a customer's whole journey through a running Kaiten with the
  two packages alone, each answer held to the API contract. It skips without a Kaiten to run
  against.
