---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

Follow the contracts the Kaiten API publishes: `@kaitencloud/openapi` 2.5.0, up from 2.3.0, and `@kaitencloud/graphql-schema` 2.1.0, up from 2.0.0. They only add: no operation, type or member is removed or changes shape.

- `@kaitencloud/client`: `KaitenApi.getDashboardSummary` reads `GET /dashboard/summary`, an organization's figures in one response: what needs attention (limits reached, refused usage reports, silent instances, Licenses ending, archived versions, expiring tokens, zones behind), the figures of the period, the meters closest to their limits, usage reports per day and per instance, evaluations per flag, who runs which License version, what runs where and who talks to Kaiten. It takes a `range` of `7d`, `30d` (the default) or `90d`, and needs `read:customers`, `read:instances` and `read:licenses`. The answer is a `KaitenApi.DashboardSummary`, with the `Dashboard*` types it is made of; `billing`, `featureFlags` and `integrations` are absent when the caller cannot read their module.
- `@kaitencloud/server`: the same operation is `Dashboard.getDashboardSummary`, the one method of a new resource class, and its types are exported with the others.
- `BillingCapabilities`, which `getBillingCapabilities` answers, gains an optional `featureCheckUnavailable`: the capabilities whose plan grant is temporarily unknown. Their member of `features` stays `false`, and a caller can retry instead of reading it as a refusal. The contract now describes `features` as the shipped billing capabilities the organization may use, where it said the parts of billing the release ships. In the client this is `KaitenApi.BillingCapabilities`; the client's own `BillingCapabilities`, the one a licensing snapshot carries, does not change.
- The GraphQL schema gains the `changesOnly` argument of `organizationAuditTrails`. Neither of the client's two GraphQL operations uses it, and its generated documents do not change.
