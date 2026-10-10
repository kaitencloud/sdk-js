---
"@kaitencloud/server": minor
---

`CustomerSessions.createCustomerSession` mints a customer session from your backend, and `CustomerSessions.revokeCustomerSession` ends one.

- `createCustomerSession` takes a customer, optionally one of its instances, and a lifetime of 300 to 3600 seconds (30 minutes by default). It answers a `kst_` token to hand to that customer's browser, where `@kaitencloud/client`'s `KaitenSessionClient` sends it to the session routes. The token is shown once. It needs a `ksh_` token that holds `write:customer_sessions`, and is limited to 50 sessions a second per organization.
- Both classes are generated from the contract, like the other resource classes, so they follow it.
