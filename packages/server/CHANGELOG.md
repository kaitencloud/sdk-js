# @kaitencloud/server

## 2.0.0

### Major Changes

- [#20](https://github.com/kaitencloud/sdk-js/pull/20) [`16006f7`](https://github.com/kaitencloud/sdk-js/commit/16006f71e23820a1be1cd6a8d5f39b7451600b5a) Thanks [@tomflenner](https://github.com/tomflenner)! - BREAKING: enforce OpenFeature SDK + official OFREP providers for all flag decisions. Remove direct client evaluation methods/facades, generated client and server OFREP operations, evaluation helpers and React evaluation hooks. Licensing reads no longer evaluate flags and return an empty flag display list. Remove flag conditions from `Show` and `flagKey` from `Gate`, `usePaywallTrigger` and `Paywall`; entitlement gating and management CRUD are unchanged.

  Use `@openfeature/server-sdk` with `@openfeature/ofrep-provider` on your backend. Browser/React integrations use the official Web/React SDK and `@openfeature/ofrep-web-provider` only with an authorized, browser-safe OFREP endpoint; never expose a Kaiten `ksh_` secret. See `MIGRATION-2.md` for removed symbols, context/authentication and failure handling. Already-published 1.x versions and immutable consumer fixtures are not rewritten; there are no compatibility aliases.

  Sync the published OpenAPI contract and regenerate the management clients: add voucher deletion and its webhook payload, plus the assigned license term state on instance detail reads. Direct OFREP evaluation operations remain excluded from both SDKs.

### Minor Changes

- [#14](https://github.com/kaitencloud/sdk-js/pull/14) [`b81cae0`](https://github.com/kaitencloud/sdk-js/commit/b81cae0bcf9ead11ab7edc3b2f8f48613b721bfb) Thanks [@tomflenner](https://github.com/tomflenner)! - Regenerate REST and GraphQL snapshots from the KTN-201 Kaiten branch, expose AI
  model/conversion-rule/inference reads, and replace the temporary hand-written AI
  wire bridge with generated aliases. The numeric report helper rejects non-numeric
  read-value variants locally; AI reports use the generated write-only union.

- [#29](https://github.com/kaitencloud/sdk-js/pull/29) [`56d7157`](https://github.com/kaitencloud/sdk-js/commit/56d715752b48b06239f59cfbf85e9b6cb0d536bb) Thanks [@Alexkuva](https://github.com/Alexkuva)! - AI credits (preview), explainable charges. Requires Kaiten 26.11.3 or later; the AI credits feature stays off until it is enabled on the platform.

  - `ai.commit` takes an optional `vendorCost`: what the provider charged, in USD, as an exact decimal string, recorded beside the cost Kaiten computes and never changing the credits charged. It is validated locally, refused on a `NOT_SENT` commit, sent byte-identical on retries, and dropped with a warning, the commit going on, when the API predates it. The SDK never computes a cost.
  - Every provider integration takes a `vendorCost` reader and an `onCommitError` hook: a commit that fails after its retries is handed over with a `retry()` that resends it byte for byte, instead of only being logged.
  - Report answers carry the pricing `rule`; `AiUsageWarning` is an open union that includes `NO_RESERVATION`, `COUNTER_PRECISION_DEGRADED` and `PRICING_SNAPSHOT_UNREADABLE`.
  - `ai.release()`, a `NOT_SENT` commit: without a reservation it leaves a tombstone, and a later reserve or commit under the same `transactionId` throws `TransactionIdReusedError`.
  - Inference rows carry the pricing snapshot, licence, warnings, `reportSeq`, vendor cost, refunds and `credits.refunded`; `ai.listInferences` takes the `authorized`, `modelSlug`, `model` and `requestType` filters, and fills `refunds` and `warnings` with `[]` on a row from an older API.
  - `ai.listOrganizationInferences()` lists the organization's inferences across instances and pools, cursor-paginated like `ai.listInferences`.
  - `ai.refund()` gives credits of a committed inference back. Its idempotency key is generated when omitted and reused on retries; refusals throw `AiRefundError` and its subclasses (`AiInferenceNotFoundError`, `AiInferenceNotCommittedError`, `NothingToRefundError`, `RefundExceedsRefundableError`, `RefundIdempotencyKeyReusedError`, `AiPoolNotGrantedError`).
  - A pool that is not an AI credit pool now throws `NotAnAiCreditPoolError` on every call, in `run` and in every wrapper, instead of degrading to unmetered calls. Degradation remains for an API that predates AI credits.
  - Settlement fixes: a stream the provider answered is never settled `NOT_SENT`, even when closed before its first event (OpenAI, Anthropic, Vercel); a cancellation is `CUSTOMER_ERROR` and a timeout `PROVIDER_ERROR`, never `NOT_SENT`; `classifyProviderError` reads the AI SDK's `statusCode`; a Vercel call whose provider sends no usage no longer fails after the provider answered; a Codex or Claude Agent failure mid-stream is `PROVIDER_ERROR`, no longer `CUSTOMER_ERROR`.
  - `@kaitencloud/server`: the regenerated `Instances.refundAiInference`, `Instances.listOrganizationAiInferences` and the new inference and conversion-rule members.

- [#25](https://github.com/kaitencloud/sdk-js/pull/25) [`76107a8`](https://github.com/kaitencloud/sdk-js/commit/76107a82f6987b7f5b2db40c70aafa7985e41110) Thanks [@fuzcap](https://github.com/fuzcap)! - An anonymous checkout names the customer after the buyer's company.

  - `@kaitencloud/client`: `startCheckout` takes an optional `customerName`, at most 255 characters, which the completion names the new customer and its instance after. Kaiten trims it, and names both after the `email` when it is left out. `getCheckoutSession` and `confirmCheckout` read it back as `customerName`, `null` when the start gave none. The mock client does the same.
  - `@kaitencloud/server`: the generated types carry `customerName` on the checkout session draft and on both session reads.
  - `@kaitencloud/react`: `useAnonymousCheckout` sends `selection.company`, trimmed, as the `customerName`; with no company, `selection.name`; with neither, nothing. It used to keep both in the tab and send neither, so every customer was named after an e-mail address.
  - `@kaitencloud/react-ui`: `collectCompany` and `collectName` say that the company, else the name, names the customer.

- [#36](https://github.com/kaitencloud/sdk-js/pull/36) [`1ffd653`](https://github.com/kaitencloud/sdk-js/commit/1ffd6531c66e8db3be520b2dad1f4d94716b0f3f) Thanks [@Lleios](https://github.com/Lleios)! - Beside the AI credits operations, the contracts the clients are generated from bring a dashboard summary, a member of the billing capabilities and a GraphQL argument.

  - `@kaitencloud/client`: `KaitenApi.getDashboardSummary` reads `GET /dashboard/summary`, an organization's figures in one response: what needs attention (limits reached, refused usage reports, silent instances, Licenses ending, archived versions, expiring tokens, zones behind), the figures of the period, the meters closest to their limits, usage reports per day and per instance, evaluations per flag, who runs which License version, what runs where and who talks to Kaiten. It takes a `range` of `7d`, `30d` (the default) or `90d`, and needs `read:customers`, `read:instances` and `read:licenses`. The answer is a `KaitenApi.DashboardSummary`, with the `Dashboard*` types it is made of; `billing`, `featureFlags` and `integrations` are absent when the caller cannot read their module. Its `range` says from when each figure is read, in `usageHistoryFrom` and `auditTrailFrom`: later than the start of the period when the organization keeps its usage history or its audit trail for less.
  - `@kaitencloud/server`: the same operation is `Dashboard.getDashboardSummary`, the one method of a new resource class, and its types are exported with the others. The README's "Resources" section names every generated class: `Dashboard`, `Identity`, `Users`, `CheckoutSessions`, `Models` and `Ai` were missing from it.
  - `BillingCapabilities`, which `getBillingCapabilities` answers, gains an optional `featureCheckUnavailable`: the capabilities whose plan grant is temporarily unknown. Their member of `features` stays `false`, and a caller can retry instead of reading it as a refusal. In the client this is `KaitenApi.BillingCapabilities`; the client's own `BillingCapabilities` type is a different one and does not gain it.
  - The GraphQL schema gains the `changesOnly` argument of `organizationAuditTrails`. Neither of the client's two GraphQL operations uses it, and its generated documents do not change.

- [#39](https://github.com/kaitencloud/sdk-js/pull/39) [`83e0b3d`](https://github.com/kaitencloud/sdk-js/commit/83e0b3d4da8be8cf2876738763a317669ef5efba) Thanks [@Lleios](https://github.com/Lleios)! - The generated operations that take a publishable key name its header `Kaiten-Publishable-Key`, as the API contract now does: `KaitenApi.getPublicCatalog` and `KaitenApi.createCheckoutSession` in the client, `Public.getPublicCatalog` and `Public.createCheckoutSession` in the server.

  - A call that passes the key in the `auth` option now sends it as `Kaiten-Publishable-Key`. A Kaiten server that predates the rename reads only `X-Kaiten-Publishable-Key`: upgrade it first, or set that header yourself instead of passing `auth`.
  - `KaitenClient` and `KaitenAnonymousCheckoutClient` do not go through these operations.

### Patch Changes

- [#49](https://github.com/kaitencloud/sdk-js/pull/49) [`80139ae`](https://github.com/kaitencloud/sdk-js/commit/80139ae2d5c55142f4f8ef427e3a97049ebf3efc) Thanks [@Lleios](https://github.com/Lleios)! - The READMEs and the doc comments name the Kaiten release the billing features need: 26.11.3. Kaiten serves billing's routes from 26.10.7 on, and reads the publishable key as `Kaiten-Publishable-Key`, the name this version sends, from 26.11.3 on. They used to say that no Kaiten release carried billing yet.

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
