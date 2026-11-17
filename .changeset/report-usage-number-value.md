---
"@kaitencloud/client": major
"@kaitencloud/react": major
---

BREAKING: a usage report's `value` is typed as a number, the only value the API counts.

- `@kaitencloud/client`: `ReportUsageInput.value` is a `NumberEntitlementValue` (`{ type: "number", value }`) instead of any `EntitlementValue`. The API has always refused a boolean or configuration value with 422 `InvalidValueType`, so such a report could only fail: it now fails to compile instead of failing on the wire. `behavior` stays required, as the API refuses a report without one with 422 `InvalidBehavior`. Nothing changes on the wire: a report is still sent as the caller wrote it, and a value that arrives untyped, from JavaScript or through a cast, is still refused by the API with its own error. AI credits are reported through `ai.reserve` and `ai.commit`, as before.
- `@kaitencloud/react`: `useReportUsage` takes the same `ReportUsageInput`, so its `input` is narrowed the same way.

A host that reported a boolean or configuration value removes that call: it never counted anything.
