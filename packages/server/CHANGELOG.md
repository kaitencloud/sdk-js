# @kaitencloud/server

## 1.1.0

### Minor Changes

- [#15](https://github.com/kaitencloud/sdk-js/pull/15) [`53c89ad`](https://github.com/kaitencloud/sdk-js/commit/53c89ad0c014d2eee5617da5735ed9ce278c70ad) Thanks [@Lleios](https://github.com/Lleios)! - Resync the OpenAPI snapshot to Kaiten's billing contract at `57283b6f5dcfcc8bdabe139ec0ff097f0733b556` and regenerate both REST clients (343 operation declarations, including webhook payloads).

  The public portal now describes entitlement exceptions and the value of boolean/config voucher boosts; voucher validation also exposes flag grants. The vendor gains three entitlement-exception operations, generated on the server's resource classes. No pending subscription selection, cancellation reason or add-on increase-billing policy is added to the public payloads by this sync.

- [#15](https://github.com/kaitencloud/sdk-js/pull/15) [`53c89ad`](https://github.com/kaitencloud/sdk-js/commit/53c89ad0c014d2eee5617da5735ed9ce278c70ad) Thanks [@Lleios](https://github.com/Lleios)! - Resync OpenAPI to Kaiten `510ec73aa` and regenerate both REST clients (343 operation declarations).
  Required nullable members now remain present and nullable in the generated types: add-ons, voucher
  grants, provider capabilities, invoice handoffs, health and usage history. Nullable PUT inputs are
  serialized as supplied; null keeps the stored value on the API, not a client-side erasure.

  The customer-session mapper now reads `incompleteExpiresAt`, `canceledAt` and the system-only
  `cancellationReason`, preserving nulls instead of inventing dates or vendor text. These additions
  stay optional on host-constructed SDK subscription fixtures; actual mapped responses always have
  the nullable members. Completed payment methods keep a nullable `attachedAt`, unlike the portal's
  payment method, which has no such member. Integer price amounts stay absent when `unitAmount` is
  null; their exact decimal remains available. Catalogue grants now declare `NUMBER_AI_CREDIT`.

  The portal and checkout show supplied expiry/cancellation dates and known system cancellation
  reasons in en/fr/es/de, without timing out access or guessing unknown reasons. Refresh the testing
  fixtures and storefront responses against the synced contract, documenting the newly added nulls.

  The required-nullable/lifecycle mappings and copy measure 70,465 gzip bytes for anonymous checkout
  (previous budget 70,450) and 114,893 for react-ui's full import (114,850). Only those budgets become
  70,600 and 115,050, leaving 135/157 bytes of measured headroom. The other budgets and dependency
  boundaries remain enforced.

- [#15](https://github.com/kaitencloud/sdk-js/pull/15) [`53c89ad`](https://github.com/kaitencloud/sdk-js/commit/53c89ad0c014d2eee5617da5735ed9ce278c70ad) Thanks [@Lleios](https://github.com/Lleios)! - The generated resource classes follow Kaiten's billing contract: 340 operations, up from 162.

  - New classes: `Addons`, `Billing`, `CustomerSessions`, `Public`, `PublishableKeys` and `Vouchers`. The existing ones gain operations, the usage history and its two exports among them, and the `Idempotency-Key` header of the usage report, which answers a `ReportedEntitlementUsage` that echoes the key as `transactionId`. Its `source` and `provenance` are always present, and `null` on a replay (`Idempotent-Replayed`), whose answer is rebuilt from a journal that keeps neither.
  - Lists of add-ons, vouchers, voucher redemptions and publishable keys answer a page (`items`, `hasMore`, `nextCursor`). Members that have no value are `null`, nullable objects included (a subscription's `scheduledChange`, a portal's `paymentMethod`), and the generated types say `X | null` for them.
  - The webhook of a cancelled plan change is named `com.kaiten.instance.billing.v1.plan_change_canceled`, as the contract spells it, and its payload and request types follow (`OnInstanceBillingPlanChangeCanceledWebhookPayload`). Every webhook request now types its `headers` (`EventHeaders`: the trace context of the request that produced the event, and the instance it concerns).
  - A subscription's status may be `INCOMPLETE`: a public checkout waiting for its first payment. The statuses of an instance's billing, a session's subscription, the billing events and a portal's instances all take it.
  - An invoice says whether it is `overdue` when read, the grace period of automatic collection included, which is what the list's `overdue` filter selects; the answers of writes and the event payloads carry `false`. A draft may be held because its provider cannot take that many lines (`holdReason: "PROVIDER_ITEM_LIMIT"`) as well as for its usage journal.
  - The event sent when a trial's reminder is due, `com.kaiten.instance.billing.v1.trial_will_end` (`OnInstanceBillingTrialWillEndWebhookPayload`), joins the webhook unions. Its `data` is a `TrialWillEnd`: the instance's billing, with what a reminder e-mail needs, read when it is emitted (the `customer` and its `billingEmail`, the `instance`, the plan's `licenseName` and `familySlug`, `daysLeft`, `reminderAt`, the `charge` the conversion would make and the `paymentMethod` it would be made to). The list of metadata fields takes `includeArchived`.
  - The event of an updated instance carries an `InstanceUpdate`, an instance with the `licenseChangeReason` (`BILLING_FALLBACK` when a subscription that ended moved it to its family's fallback).
  - A publishable key can open anonymous checkouts (`anonymousCheckout`, with a Turnstile site key and a write-only secret, `turnstileSecretConfigured` on reads), and the catalogue says so. The routes of the anonymous checkout itself belong to the browser, and are in `Public`.
  - Six events join the webhook unions: `com.kaiten.checkout_session.v1.started`, `.completed` and `.abandoned`, and `com.kaiten.instance.entitlement_exception.v1.created`, `.revoked` and `.expired`.
  - Two new classes, `Identity` (`getAuthorization`) and `Users` (`getMe`, the organization's users and roles), come with the contract's new `/me`, `/authorization`, `/users` and `/roles` routes.
  - The contract then gained three operations, 340 in all. The new class `CheckoutSessions` is the vendor's reads of the anonymous checkouts, `listCheckoutSessions` (`GET /checkout-sessions`, filtered by `status`, `email` and `clientReferenceId`, paged) and `getCheckoutSessionAdmin` (`GET /checkout-sessions/{sessionId}`), which need `read:billing` and never return a `ksc_` or a voucher code. They are generated and outside the stability guarantee, like the rest of the resource classes. `Public` gains `redeemSessionVoucher`, the customer session's redemption of a code, which a browser calls.
  - The payload of a webhook event is now typed as the event is delivered: each `Foo` of an event is `FooDelivered` (`SystemTokenIssuanceDelivered`, `IssuedInvoiceDelivered`, …), which adds `via` (`customer_session` or `checkout_session`, absent otherwise) and, with it, the `customerSessionId` or the `checkoutSessionId` the write came through. The event names do not change. The twelve payload names that 1.0.0 published (`SystemTokenIssuance`, `Deployment`, `InstanceStatusChanged`, `FeatureFlagEvaluated` and eight more) and the writable form of one stay exported, deprecated, as the delivered type, which only adds optional members; a payload added since has the delivered name alone. The audit trail names the actor of an entry (`AuditActor`).
  - The resource classes and their types are generated from the contract and are outside the stability guarantee of 1.x: a contract change can change them in a minor release.

- [#15](https://github.com/kaitencloud/sdk-js/pull/15) [`53c89ad`](https://github.com/kaitencloud/sdk-js/commit/53c89ad0c014d2eee5617da5735ed9ce278c70ad) Thanks [@Lleios](https://github.com/Lleios)! - `KaitenBilling` reads the invoices of the organization and drains its handoff queue, over a client from `createKaitenClient`.

  - `billing.handoff.claim({ limit?, leaseSeconds? })` leases the oldest invoices waiting for the organization's accounting system under one lease, and `billing.handoff.ack(invoiceId, { leaseId?, externalReference? })` records that the ledger booked one. The queue delivers at least once, so a consumer books on the invoice `id`.
  - `billing.invoices.list(filters)` is one page of invoices, `listAll(filters)` follows the cursor to the last page, `get(invoiceId)` reads one, and `markPaid(invoiceId, { paidAt?, externalReference?, note? })` records the payment of a manual invoice. Amounts are integer minor units next to the invoice's `currency`.
  - A call that fails throws a `KaitenError`, and none is sent again by itself. Write-off, void, recompose and the export stay on the generated `Billing` class.

  `KaitenWebhookType` and `KaitenWebhookEvent` name the 109 events of the regenerated contract, billing's among them, and narrow an event to the payload of its type. They follow the contract: an event the API starts to send is a new member, so a `switch` over `event.type` keeps a `default`.

- [#15](https://github.com/kaitencloud/sdk-js/pull/15) [`53c89ad`](https://github.com/kaitencloud/sdk-js/commit/53c89ad0c014d2eee5617da5735ed9ce278c70ad) Thanks [@Lleios](https://github.com/Lleios)! - `CustomerSessions.createCustomerSession` mints a customer session from your backend, and `CustomerSessions.revokeCustomerSession` ends one.

  - `createCustomerSession` takes a customer, optionally one of its instances, and a lifetime of 300 to 3600 seconds (30 minutes by default). It answers a `kst_` token to hand to that customer's browser, where `@kaitencloud/client`'s `KaitenSessionClient` sends it to the session routes. The token is shown once. It needs a `ksh_` token that holds `write:customer_sessions`, and is limited to 50 sessions a second per organization.
  - Both classes are generated from the contract, like the other resource classes, so they follow it.

- [#15](https://github.com/kaitencloud/sdk-js/pull/15) [`53c89ad`](https://github.com/kaitencloud/sdk-js/commit/53c89ad0c014d2eee5617da5735ed9ce278c70ad) Thanks [@Lleios](https://github.com/Lleios)! - A usage report refused because its key was already used for another report (409 `ReportEntitlementUsageMetric.TransactionIdReused`) now throws `TransactionIdReusedError`, a `KaitenError` that carries the key the request's `Idempotency-Key` header held, as `transactionId`, and names the original report. `isTransactionIdReused` recognizes it.

- [#15](https://github.com/kaitencloud/sdk-js/pull/15) [`53c89ad`](https://github.com/kaitencloud/sdk-js/commit/53c89ad0c014d2eee5617da5735ed9ce278c70ad) Thanks [@Lleios](https://github.com/Lleios)! - `isQuotaExceeded`, `isRateLimited`, `isBoundaryPending` and `isProviderUnavailable` recognize the refusals of the billing routes that call for a reaction of their own (422 `*.QuotaExceeded`, 429 `*.RateLimited`, 409 `*.BoundaryPending`, 503 `*.ProviderUnavailable`), as `isThresholdExceeded` does for a usage report over its limit. `KaitenError` gains an optional `retryAfterSeconds`, the `Retry-After` of the response in seconds, absent when there is none.

## 1.0.1

### Patch Changes

- [#6](https://github.com/kaitencloud/sdk-js/pull/6) [`170e614`](https://github.com/kaitencloud/sdk-js/commit/170e614d35d1b9cf3928b0d4eeeba5124ea1f053) Thanks [@Alexkuva](https://github.com/Alexkuva)! - Documentation corrections. The code that runs is unchanged.

  - `@kaitencloud/server`: the README and the doc comment of `KaitenWebhookEvent` count the 55 `com.kaiten.*` events the contract declares, not 49. The README lists the 17 resource classes, `LicenseFamilies` and `Notifications` included, and names a token's expiry `expiresAt`.
  - `@kaitencloud/client`: the package description says the client never holds a secret in a browser. On a server it may carry a `ksh_` token.

## 1.0.0

First public release, on npm under the Apache License 2.0.
