# Examples

The first two, and the storefront by default, run on fixture data, without an account.

- [`react-vite`](react-vite): the prebuilt components of `@kaitencloud/react-ui`,
  and a page that draws its own UI with the headless `@kaitencloud/react`.
- [`node`](node): a Node backend that reads the catalog for a static pricing page,
  verifies webhooks and evaluates feature flags.
- [`conformance`](conformance): a customer's whole journey through a running Kaiten with the
  two packages alone, each answer held to the API contract. It skips without a Kaiten to run
  against.
- [`storefront`](storefront): a shop on Kaiten billing, from its pricing table to a customer's
  portal: a checkout with a card saved on the payment provider's page, and the backend route that
  mints the customer's session with `@kaitencloud/server`. It runs against a stand-in for Kaiten
  unless you give it a Kaiten, and has end-to-end tests in a browser.
