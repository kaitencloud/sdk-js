---
"@kaitencloud/client": minor
"@kaitencloud/react": patch
---

A licensing snapshot read with a server credential holds every entitlement the instance has, not only those its licence grants.

- `@kaitencloud/client`: `getLicensingSnapshot` walked the licence's grants and hung the usage read off them. The usage read answers one row per entitlement the instance has, and an entitlement an attached add-on or the instance's exception grants on its own was dropped: with `seats` from the licence and `sso` from an add-on, the snapshot held `seats` alone.
  - The snapshot is now that effective set. Such an entitlement takes its name, type and presentation from another licence of the catalog that grants it, else its slug names it and its value types it (`NUMBER`, `BOOLEAN`, `CONFIG`). Its value, limit and allowance are its usage row's. A licence grant the read does not return is still there, with nothing consumed, and a failed usage read still leaves the licence's grants alone, with their usage unknown.
  - Each entitlement's layer is read from its row instead of being written as `license`: `effectiveSource` is the row's `source` (`license`, `addon` or `exception`), `source` keeps its 1.0 union (`exception` reads as `license`, as on the portal), and `provenance` is the row's.
  - The snapshot's GraphQL query selects `source`, `provenance` and `limitCapExceededOveragePercent` on each usage row, as the REST read already carried them. On that path an entitlement is now measured against the allowance of the instance's limit, an add-on's included, instead of the licence grant's. A Kaiten release that predates billing does not serve these fields, and against it the snapshot is composed over REST, without the icons and units only the GraphQL catalog carries, and reports the GraphQL failure through `onDegraded`.
  - `normalizeResolvedEntitlements` resolves the same set, and takes a new `definitions` option: grant rows of any licence, read for the name, type and presentation of an entitlement the instance's licence does not grant. A usage row that names no layer, as a server that predates billing answers, adds nothing, so a fixture built without `source` resolves as before.
  - `EntitlementUsage.source` names `exception` in its open union.
- `@kaitencloud/react`: under `mode="authenticated"`, `Show`, `Gate`, `usePaywallTrigger` and the entitlement hooks see a feature an add-on or an exception grants, which they used to refuse, and a `Gate`'s `source` and `provenance` are those of its usage row.

The bundle-size budgets of the scenarios that build a `KaitenClient` are raised by what this adds, 0.3 to 0.4 KB gzip.
