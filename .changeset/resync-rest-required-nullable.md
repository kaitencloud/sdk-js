---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

Resync OpenAPI to Kaiten `510ec73aa` and regenerate both REST clients (343 operation declarations).
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
