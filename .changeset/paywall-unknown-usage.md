---
"@kaitencloud/react": minor
"@kaitencloud/react-ui": minor
---

A paywall says why it is up when the usage could not be read or there is too little quota left, a usage nobody could read is no longer drawn as zero, and a wall that comes up no longer clears the content under it.

- `@kaitencloud/react`: `usePaywallTrigger`, and so `Gate` and `Paywall`, gave the reason `not_entitled`, and offered to change plan, in two cases where the plan does include the feature.
  - A quota whose usage could not be read (`usageUnavailable`) now gives the reason `usage_unavailable`, with `metered: false` and no `recommendedAction`. It follows `onError`, as a failed read does: `"block"`, the default, keeps the wall up; `"allow"` lets the customer through. It used to block whatever `onError` said.
  - A quota with some left, but less than the `min` asked for (95 of 100 with `min: 10`), now gives the reason `insufficient_quota`, whose `recommendedAction` falls back to adding quota. A quota with nothing left is still `over_limit`.
  - `PaywallReason` names both, and the trigger's result carries `remaining`, what the quota has left. A `switch` over the reason with a default, as the open union asks, needs no change.
  - The language packs (English, French, German, Spanish) gain `paywall.usageUnavailable`, `paywall.usageUnavailableDescription`, `paywall.insufficientQuota` and `paywall.insufficientQuotaDescription`.
- `@kaitencloud/react-ui`:
  - `Paywall` titles the two new reasons ("Usage unavailable", "Not enough quota") and says what they mean: that the usage could not be read, with no figures and no upgrade button; and how much the action needs against how much is left ("This needs 10, and 5 are left."), with "Add quota". A feature the plan does not include says so (`paywall.flagDisabledDescription`) instead of "You've used 0 of 1 allowed".
  - `UsageMeters` and `EntitlementStatusBar` say "Usage unavailable" for a quota whose usage could not be read, as `BillingSummary` does, instead of "0 / limit", a 0% badge and an empty bar. Unstyled too.
  - `Paywall` in `mode="hard"` keeps a refusal behind the wall, no longer the warning before the limit: at `near_limit` it shows the inline wall with its dismiss button, as `soft` does, where it used to lock the content from 80% with no way out. Its modal is for `over_limit`, `insufficient_quota` and `not_entitled`, and its upgrade button closes it before calling `onUpgrade`, so a checkout opened from there is not left under it.
  - A wall coming up or down no longer unmounts the content it covers: the content stays in the same elements, which are only made `inert`, so a form being filled when a read crosses the threshold keeps what was typed. With no wall up, those two elements take no part in the layout (`display: contents`). And the wall takes the focus only when it was inside the content it covers; a focus elsewhere on the page stays where it is.
