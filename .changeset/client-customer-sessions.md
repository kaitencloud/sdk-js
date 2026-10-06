---
"@kaitencloud/client": minor
---

`KaitenSessionClient`: what a browser does for one signed-in customer, through the `/public/session/*` routes of Kaiten servers that ship billing, with a `kst_` customer session the vendor's backend mints.

- `new KaitenSessionClient({ apiUrl, getCustomerSession })` takes a host callback returning `{ token, expiresAt }`. The session is sent as `Authorization: Bearer kst_…` to the session routes and nowhere else, with no cookie; it is renewed 60 seconds before it expires, by one call however many requests wait, and on a 401 renewed once and the request retried once before `onAuthError` is told.
- Its calls: `getPortal`, `listInvoices`, `checkout`, `cancelSubscription`, `reactivateSubscription`, `createPortalSession`, `createPaymentMethodSession`, `completePaymentMethodSession`, `validateVoucher` and `setAddonQuantity`, with their types (`KaitenPortal`, `PortalSubscription`, `SessionInvoice`, `CheckoutInput`, `CheckoutResult`, `VoucherValidation`, …). Money follows the SDK's conventions: `currencyCode`, integer minor units, totals from the server only. Reads are retried after a network failure or a 5xx, writes never, and every refusal keeps the API's `status`, `code` and `retryAfterSeconds`.
- `KaitenSessionClientLike` is its interface. `KaitenClientLike` gains no member, so 1.0 doubles stay valid.
- `ResolvedEntitlement` gains an optional `provenance`, set on the portal's effective entitlements.
