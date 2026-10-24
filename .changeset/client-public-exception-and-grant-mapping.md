---
"@kaitencloud/client": minor
---

Read every newly exposed public entitlement layer and voucher part. `ResolvedEntitlement.effectiveSource` preserves the portal's actual source in an optional open union, including `exception`, while the 1.0 closed `source` union stays compatible. `EntitlementProvenance` gains optional `exception`, `number.afterBoosts` and `boosts[].value`, preserving supplied nulls and omission on older servers. Exception kind is open; its reason and author are never exposed.

Voucher validation keeps BOOLEAN/CONFIG `boosts[].value` and `flagGrants` alongside a composite's discount. Its open voucher type names `FLAG_GRANT` and `COMPOSITE`. The testing double carries these parts; the `LAUNCH` fixture demonstrates them. `BillingPrice.displayOrder` and catalogue grant overage/override fields are now typed and accessible as the API supplies them. No pending subscription, cancellation reason or family billing policy is inferred from vendor-only contract members.

The public mappings add executable fields to client bundles. Measured after a dependency-order build: `KaitenClient` alone is 13,807 gzip bytes (old budget 13,800), `Gate + KaitenProvider` and its react-ui re-export 26,136 (26,100), `useEntitlementCheck + KaitenProvider` 25,242 (25,200), and `Show + KaitenProvider` 25,452 (25,400). Only these five budgets gain 200 bytes each, leaving 148–193 bytes of measured headroom. The headless/unstyled dependency checks still apply, and the other budgets do not change.
