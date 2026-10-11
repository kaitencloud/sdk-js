---
"@kaitencloud/client": minor
---

`@kaitencloud/client/testing` ships a double of the session client, to build a customer portal or a checkout with no Kaiten account.

- `createMockKaitenSessionClient()` implements `KaitenSessionClientLike`, so anything that takes a session client takes it. It is a fake, not a stub: a cancellation ends the subscription with its period and takes the cancel action away, a checkout of an unsubscribed instance subscribes it after saving a payment method if the customer has none and puts its first invoice at the head of the list, and a quantity moves the add-on. A call the API would refuse is refused with the same status and code, as a `KaitenError`.
- `checkout` scripts an outcome its model does not cover. `portal`, `invoices`, `prices`, `vouchers`, `addOns`, `delayMs` and `error` shape the scenario, `setPortal` and `setInvoices` swap it mid-flight, and `calls` records what was called.
- The fixtures it starts from are exported as factories: `demoPortal`, `demoUnsubscribedPortal`, `demoSessionInvoices`, `demoSessionAddOns`, `demoCheckoutPrices` and `demoVouchers`.
