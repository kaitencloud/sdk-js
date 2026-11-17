// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expectTypeOf, test } from "vite-plus/test";
import type { NumberEntitlementValue, ReportUsageInput } from "../src/index.ts";

// The usage route counts numbers only: it answers 422 `InvalidValueType` to any
// other value and 422 `InvalidBehavior` to a report without a behavior. The type
// says so, so such a report fails where it is written rather than on the wire.
// These are type assertions: `vp check` type-checks this file, and an
// `@ts-expect-error` that no longer has an error to expect fails it.
test("a usage report takes a number and a behavior", () => {
  expectTypeOf<ReportUsageInput["value"]>().toEqualTypeOf<NumberEntitlementValue>();

  const reports: ReportUsageInput[] = [
    { value: { type: "number", value: 500 }, behavior: "append" },
    // @ts-expect-error a boolean value is refused with InvalidValueType
    { value: { type: "boolean", value: true }, behavior: "set" },
    // @ts-expect-error a configuration value is refused with InvalidValueType
    { value: { type: "object", value: { tier: "gold" } }, behavior: "set" },
    // @ts-expect-error a report without a behavior is refused with InvalidBehavior
    { value: { type: "number", value: 500 } },
  ];
  expectTypeOf(reports).toEqualTypeOf<ReportUsageInput[]>();
});
