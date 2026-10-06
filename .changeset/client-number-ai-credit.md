---
"@kaitencloud/client": minor
---

`EntitlementType` names `NUMBER_AI_CREDIT`, a number entitlement counted in AI credits. Kaiten servers already return it, and the client already passed it through as `ResolvedEntitlement.type` and `PlanEntitlement.type`; the type now says so.

This widens a union that 1.0.0 published as closed, which is why it ships in a minor release and is called out here. A `switch` over `EntitlementType` that has no `default` and checks exhaustiveness (by assigning the remaining value to `never`) stops compiling until it has a `NUMBER_AI_CREDIT` case. The new type carries a `number` value and is metered like `NUMBER`, so the case can share its branch; branching on `limitValue.type` instead needs no change. Nothing changes at runtime, and the union stays closed at these four types.
