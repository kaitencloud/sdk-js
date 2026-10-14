---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

Customer sessions and self-serve checkout.

- `@kaitencloud/server`: `CustomerSessions.createCustomerSession` mints a `kst_` session for one of your customers -- optionally bound to one of its instances -- from your backend, with a `ksh_` token holding `write:customer_sessions`; `CustomerSessions.revokeCustomerSession` ends one. The contract also gains the rest of the billing surface (subscriptions with add-ons and a voucher, invoices, add-ons, vouchers, publishable keys).
- `@kaitencloud/client`: with `authScheme: "bearer"` and a `tokenProvider` returning that session, `session.previewCheckout` answers what a checkout would bill today, `session.checkout` subscribes the session's instance to a public price -- answering `requires_payment_method` with a hosted setup page first when a card has to be saved, then `subscribed` with how the first payment went -- and `session.invoices` lists the customer's invoices with how to pay each. Totals come from the server. With a publishable key, the session methods refuse before sending anything.
- The public catalogue now maps the generated contract types; its output is unchanged.
