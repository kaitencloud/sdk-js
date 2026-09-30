import { describe, expect, test } from "vite-plus/test";

import {
  getUsageScope,
  isPeriodicEntitlement,
  resolveUsageScope,
} from "../src/domain/entitlement-usage.ts";

const WINDOW = {
  currentPeriodStart: "2026-03-01T00:00:00Z",
  currentPeriodEnd: "2026-04-01T00:00:00Z",
};

describe("isPeriodicEntitlement", () => {
  test("both bounds make a window", () => {
    expect(isPeriodicEntitlement(WINDOW)).toBe(true);
    expect(getUsageScope(WINDOW)).toBe("PERIODIC");
  });

  // A half-populated pair is not half a window. Either bound alone would be a
  // row the API cannot produce, and reading it as a cadence would let a
  // malformed response present itself as one.
  test.for([
    ["start only", { currentPeriodStart: WINDOW.currentPeriodStart }],
    ["end only", { currentPeriodEnd: WINDOW.currentPeriodEnd }],
    ["neither", {}],
    ["explicit nulls", { currentPeriodStart: null, currentPeriodEnd: null }],
  ] as const)("%s is a lifetime counter", ([, bounds]) => {
    expect(isPeriodicEntitlement(bounds)).toBe(false);
    expect(getUsageScope(bounds)).toBe("LIFETIME");
  });
});

describe("resolveUsageScope", () => {
  test("agrees with getUsageScope when the window was read", () => {
    expect(resolveUsageScope(WINDOW)).toBe("PERIODIC");
    expect(resolveUsageScope({})).toBe("LIFETIME");
  });

  // The two states the Kaiten app does not have, and the whole reason this SDK
  // needs a third value. On the same object, the two-valued rule answers
  // LIFETIME — which would print "Lifetime" over a monthly quota.
  test("a failed usage read is not a lifetime counter", () => {
    const failedRead = { currentPeriodStart: null, currentPeriodEnd: null, usageUnavailable: true };
    // Same object, two answers: the business rule has nothing to go on and says
    // LIFETIME, which over a monthly quota would be a printed falsehood.
    expect(getUsageScope(failedRead)).toBe("LIFETIME");
    expect(resolveUsageScope(failedRead)).toBe("UNKNOWN");
  });

  test("a read path that carries no bounds is not a lifetime counter", () => {
    const noBoundsFetched = {
      currentPeriodStart: null,
      currentPeriodEnd: null,
      usageWindowUnknown: true,
    };
    expect(getUsageScope(noBoundsFetched)).toBe("LIFETIME");
    expect(resolveUsageScope(noBoundsFetched)).toBe("UNKNOWN");
  });

  // Unknown beats known: if the path did not carry the window, bounds that
  // somehow arrived cannot be trusted to be this entitlement's.
  test("unknown wins over bounds that are present", () => {
    expect(resolveUsageScope({ ...WINDOW, usageWindowUnknown: true })).toBe("UNKNOWN");
  });
});
