// The rule the styled components read usage by is the Kaiten console's, ported as it is. The first
// cases below are the console's own test cases, with its status names in the SDK's spelling.

import { expect, test } from "vite-plus/test";

import { getUsageBadge } from "../src/components/shared/usage-badge.ts";
import {
  getAllowancePercent,
  getUsageCeiling,
  getUsageRatio,
  getUsageState,
  getUsageTone,
  isUsageAtRisk,
  readQuota,
  type UsageState,
} from "../src/components/shared/usage-state.ts";

test("usage is banded against a hard limit", () => {
  expect(getUsageState(10, 100)).toBe("healthy");
  expect(getUsageState(50, 100)).toBe("watch");
  expect(getUsageState(80, 100)).toBe("near_limit");
  expect(getUsageState(99, 100)).toBe("near_limit");
  // The API accepts a report that lands exactly on the ceiling and rejects the next one: the grant
  // is spent there, and breached past it.
  expect(getUsageState(100, 100)).toBe("at_limit");
  expect(getUsageState(101, 100)).toBe("over_limit");
});

// A soft limit still has room at the granted value, so it must not be called spent while the API
// keeps accepting reports.
test("usage under the grant is banded against the stretched ceiling of a soft limit", () => {
  expect(getUsageState(100, 100, 25)).toBe("near_limit");
  expect(getUsageState(70, 100, 25)).toBe("watch");
  // 60 of a granted 100 is a watch under a hard limit, and healthy once the grant allows 125.
  expect(getUsageState(60, 100)).toBe("watch");
  expect(getUsageState(60, 100, 25)).toBe("healthy");
});

test("usage past the grant but under the ceiling is in its allowance, whatever the saturation", () => {
  expect(getUsageState(101, 100, 25)).toBe("in_allowance");
  expect(getUsageState(124, 100, 25)).toBe("in_allowance");
  // The ceiling itself is still accepted, and spends the allowance.
  expect(getUsageState(125, 100, 25)).toBe("at_limit");
  expect(getUsageState(126, 100, 25)).toBe("over_limit");
  // A wide allowance leaves the saturation in the watch band; the grant is spent all the same.
  expect(getUsageState(105, 100, 50)).toBe("in_allowance");
  expect(getUsageRatio(105, 100, 50)).toBeCloseTo(0.7, 10);
  // A hard limit has no allowance to be in.
  expect(getUsageState(101, 100)).toBe("over_limit");
  expect(getUsageState(101, 100, 0)).toBe("over_limit");
});

test("a grant of 100 with a 20% allowance walks through every state", () => {
  const at = (used: number) => getUsageState(used, 100, 20);
  // 80% of the 120 ceiling is 96: that is where the near-limit band starts.
  expect(at(95)).toBe("watch");
  expect(at(96)).toBe("near_limit");
  expect(at(100)).toBe("near_limit");
  expect(at(101)).toBe("in_allowance");
  expect(at(119)).toBe("in_allowance");
  expect(at(120)).toBe("at_limit");
  expect(at(121)).toBe("over_limit");
  expect(at(60)).toBe("watch");
  expect(at(59)).toBe("healthy");
});

test("an unlimited or unset grant has no bound", () => {
  expect(getUsageState(1000, -1)).toBe("unbounded");
  expect(getUsageState(1000, -1, -1)).toBe("unbounded");
  expect(getUsageState(1000, null)).toBe("unbounded");
  expect(getUsageState(1000, undefined)).toBe("unbounded");
  expect(getUsageCeiling(-1, 25)).toBeNull();
  expect(getUsageRatio(5, null)).toBeNull();
});

test("any usage on a grant of nothing is over its limit", () => {
  // Spent before the first report: there was nothing to spend.
  expect(getUsageState(0, 0)).toBe("at_limit");
  expect(getUsageState(1, 0)).toBe("over_limit");
  expect(getUsageState(1, 0, 20)).toBe("over_limit");
  expect(getUsageRatio(1, 0)).toBe(Number.POSITIVE_INFINITY);
  expect(getUsageRatio(0, 0)).toBe(1);
});

test("the allowance is a whole, positive percentage or nothing", () => {
  for (const unread of [undefined, null, -1, -20, 0, 12.5, Number.NaN]) {
    expect(getAllowancePercent(unread), String(unread)).toBe(0);
  }
  expect(getAllowancePercent(25)).toBe(25);
  // A fraction is not an allowance, so the ceiling stays the grant.
  expect(getUsageCeiling(100, 12.5)).toBe(100);
  expect(getUsageCeiling(100, -1)).toBe(100);
});

test("the ceiling is the grant and its allowance, never floored", () => {
  expect(getUsageCeiling(100)).toBe(100);
  expect(getUsageCeiling(100, 25)).toBe(125);
  expect(getUsageCeiling(0, 25)).toBe(0);
  // 999 granted with 53% permits 1528.47 — the ceiling keeps its fraction.
  expect(getUsageCeiling(999, 53)).toBeCloseTo(1528.47, 10);
});

test("only the four states that call for a look are at risk", () => {
  const atRisk: UsageState[] = ["near_limit", "in_allowance", "at_limit", "over_limit"];
  const calm: UsageState[] = ["healthy", "watch", "unbounded"];
  for (const state of atRisk) expect(isUsageAtRisk(state), state).toBe(true);
  for (const state of calm) expect(isUsageAtRisk(state), state).toBe(false);
});

test("the fill and the text of a state share one reading", () => {
  expect(getUsageTone("over_limit")).toEqual({
    fill: "bg-ktn-destructive",
    text: "text-destructive-subtle-foreground",
  });
  expect(getUsageTone("at_limit")).toEqual(getUsageTone("over_limit"));
  expect(getUsageTone("in_allowance")).toEqual({
    fill: "bg-ktn-warning",
    text: "text-warning-subtle-foreground",
  });
  expect(getUsageTone("near_limit")).toEqual(getUsageTone("in_allowance"));
  expect(getUsageTone("watch").fill).toBe("bg-ktn-success");
  expect(getUsageTone("healthy").fill).toBe("bg-ktn-success");
  // Never the fill colours as text on a light surface.
  for (const state of ["near_limit", "in_allowance", "at_limit", "over_limit"] as const) {
    expect(getUsageTone(state).text).toContain("subtle-foreground");
  }
});

test("a badge wears the console's look for each state", () => {
  expect(getUsageBadge("healthy").variant).toBe("success");
  expect(getUsageBadge("watch").variant).toBe("outline");
  expect(getUsageBadge("near_limit")).toEqual({
    variant: "secondary",
    className: "text-warning-subtle-foreground",
  });
  expect(getUsageBadge("in_allowance").variant).toBe("outline");
  expect(getUsageBadge("in_allowance").className).toContain("text-warning-subtle-foreground");
  expect(getUsageBadge("at_limit")).toEqual({ variant: "destructive" });
  expect(getUsageBadge("over_limit")).toEqual({ variant: "destructive" });
  expect(getUsageBadge("unbounded").variant).toBe("outline");
});

// --- Reading an entitlement --------------------------------------------------------------------

function quota(overrides: Record<string, unknown> = {}) {
  return {
    limitValue: { type: "number", value: 100 },
    currentValue: { type: "number", value: 110 },
    limitCapExceededOveragePercent: 20,
    ...overrides,
  } as Parameters<typeof readQuota>[0];
}

test("an entitlement is read for its figures, its ceiling and its state", () => {
  const reading = readQuota(quota());
  expect(reading).toMatchObject({
    used: 110,
    limit: 100,
    overagePercent: 20,
    ceiling: 120,
    unavailable: false,
    state: "in_allowance",
    // Of the GRANT and not capped: 110 of 100 is 110%.
    percentOfGrant: 110,
  });
  expect(reading.ratio).toBeCloseTo(110 / 120, 10);
});

test("a failed usage read has no state, and is not zero used", () => {
  const reading = readQuota(
    quota({ currentValue: null, usageUnavailable: true, limitCapExceededOveragePercent: 0 }),
  );
  expect(reading.unavailable).toBe(true);
  expect(reading.state).toBeNull();
});

test("an unlimited entitlement, by flag or by sentinel, has no ceiling", () => {
  expect(readQuota(quota({ unlimited: true })).state).toBe("unbounded");
  const sentinel = readQuota(quota({ limitValue: { type: "number", value: -1 } }));
  expect(sentinel.state).toBe("unbounded");
  expect(sentinel.limit).toBeNull();
  expect(sentinel.ceiling).toBeNull();
  expect(sentinel.percentOfGrant).toBe(0);
});

test("an entitlement that is not a number has nothing to cap", () => {
  const reading = readQuota(
    quota({ limitValue: { type: "boolean", value: true }, currentValue: null }),
  );
  expect(reading.state).toBe("unbounded");
});

test("an entitlement with no usage row reads as nothing used, and no allowance as a hard limit", () => {
  const reading = readQuota(
    quota({ currentValue: undefined, limitCapExceededOveragePercent: undefined }),
  );
  expect(reading).toMatchObject({ used: 0, overagePercent: 0, ceiling: 100, state: "healthy" });
});

test("a grant of nothing is spent, whatever the percentage of it", () => {
  const reading = readQuota(
    quota({
      limitValue: { type: "number", value: 0 },
      currentValue: { type: "number", value: 0 },
    }),
  );
  expect(reading.state).toBe("at_limit");
  expect(reading.percentOfGrant).toBe(0);
});

// The console's own cases for the ceiling and the ratio, pinned as they are so that the two
// readings cannot drift apart.
test("the ceiling and the ratio are the console's, case for case", () => {
  expect(getUsageCeiling(100, 20)).toBe(120);
  expect(getUsageCeiling(1000, 5)).toBe(1050);
  expect(getUsageCeiling(100, 0)).toBe(100);
  expect(getUsageCeiling(100)).toBe(100);
  expect(getUsageCeiling(0, 0)).toBe(0);
  expect(getUsageCeiling(0, 25)).toBe(0);
  expect(getUsageCeiling(-1, -1)).toBeNull();
  expect(getUsageCeiling(null, null)).toBeNull();
  expect(getUsageCeiling(-5)).toBeNull();

  expect(getUsageRatio(60, 100, 20)).toBe(0.5);
  expect(getUsageRatio(120, 100, 20)).toBe(1);
  expect(getUsageRatio(240, 100, 20)).toBe(2);
  expect(getUsageRatio(1000, -1)).toBeNull();
  expect(getUsageRatio(1000, null)).toBeNull();
  expect(getUsageRatio(0, 0)).toBe(1);
  expect(getUsageRatio(5, 0)).toBe(Number.POSITIVE_INFINITY);
});
