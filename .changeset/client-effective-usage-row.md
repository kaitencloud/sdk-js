---
"@kaitencloud/client": minor
---

A usage row, as `usage.getByInstance`, `usage.getDetail` and `reportUsage` read it, now types what a current Kaiten server adds to it. `EntitlementUsage` gains three optional members: `source`, the layer that grants the entitlement (`license` or `addon`, an open union), `provenance`, which says where the limit comes from, with the identifiers of the licence entitlement, add-ons and voucher boosts it is made of, and `limitCapExceededOveragePercent`, the allowance of the instance's effective limit (`-1` when unlimited). A server that predates them sends none, and a row built against 1.0 still compiles. The types `EntitlementProvenance` and `BoostModifierType` are exported.
