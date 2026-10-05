import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { formatKaitenUsageWindowBound } from "../src/localization/date.ts";
import { usageWindowLabel } from "../src/lib/entitlement-usage-window.ts";
import { defaultLocalization } from "../src/localization/defaults.ts";
import { fr } from "../src/localization/locales/fr.ts";
import type { ResolvedEntitlement } from "../src/types.ts";

const START = "2026-03-01T00:00:00Z";
const END = "2026-04-01T00:00:00Z";

// Pinned west of Greenwich for this file, and not left to the host's zone. A
// runner in UTC cannot tell a UTC-pinned formatter from an unpinned one, so the
// guard below would be vacuous in CI — which is exactly where it has to hold.
// Node re-reads `TZ` per formatting call, so setting it here is enough.
const HOST_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  process.env.TZ = HOST_TZ;
});

function entitlement(over: Partial<ResolvedEntitlement> = {}): ResolvedEntitlement {
  return {
    id: "growth:tokens",
    slug: "tokens",
    name: "Tokens",
    type: "NUMBER",
    source: "license",
    limitValue: { type: "number", value: 100 },
    currentValue: { type: "number", value: 40 },
    status: "enabled",
    ...over,
  } as ResolvedEntitlement;
}

describe("formatKaitenUsageWindowBound", () => {
  // The whole reason this helper exists. Under the zone pinned above,
  // `2026-03-01T00:00:00Z` renders as "Feb 28" unless the formatter is held to
  // UTC — a March calendar window presented as starting in February.
  test("is pinned to UTC and says so", () => {
    const rendered = formatKaitenUsageWindowBound(START, { locale: "en-US" });

    expect(rendered).toMatch(/Mar\b/);
    expect(rendered).not.toMatch(/Feb\b/);
    expect(rendered).toMatch(/UTC/);
  });

  // Guards the trap that made delegating to `formatKaitenDate` unsafe: it forces
  // `dateStyle`, `Intl` throws when `dateStyle` meets components, and its `catch`
  // swallows that into a date-only string in the HOST's zone. No time and no zone
  // name is exactly the fingerprint of having fallen into it.
  test("renders a time, so a silent fallback cannot pass for success", () => {
    expect(formatKaitenUsageWindowBound(START, { locale: "en-US" })).toMatch(/\d{1,2}:\d{2}/);
  });

  test("an unparseable bound falls back instead of throwing", () => {
    expect(formatKaitenUsageWindowBound("not-a-date")).toBe("not-a-date");
  });
});

describe("usageWindowLabel", () => {
  test("a periodic counter announces its window", () => {
    const label = usageWindowLabel(
      entitlement({ currentPeriodStart: START, currentPeriodEnd: END }),
      defaultLocalization,
    );

    expect(label).toMatch(/This period/);
    expect(label).toMatch(/Mar/);
    expect(label).toMatch(/Apr/);
  });

  test("a lifetime counter says so", () => {
    expect(usageWindowLabel(entitlement(), defaultLocalization)).toBe("All time");
  });

  // A mistake already made once while building this feature: a window is a
  // property of a counter, and these have none.
  test.for([
    ["boolean", { type: "boolean", value: true }],
    ["config", { type: "object", value: {} }],
  ] as const)("a %s grant gets no window label at all", ([, limitValue]) => {
    expect(
      usageWindowLabel(
        entitlement({ limitValue: limitValue as ResolvedEntitlement["limitValue"] }),
        defaultLocalization,
      ),
    ).toBeNull();
  });

  // A numeric grant whose `type` the SDK's three-member union cannot name — an AI
  // credit is the real case. The guard is on `limitValue.type`, so it is labelled
  // like any other counter instead of slipping through unannotated.
  test("a numeric grant with an unmodelled type is still labelled", () => {
    const label = usageWindowLabel(
      entitlement({
        type: "NUMBER_AI_CREDIT" as ResolvedEntitlement["type"],
        currentPeriodStart: START,
        currentPeriodEnd: END,
      }),
      defaultLocalization,
    );

    expect(label).toMatch(/This period/);
  });

  test.for([
    ["a failed usage read", { usageUnavailable: true }],
    ["a read path with no bounds", { usageWindowUnknown: true }],
  ] as const)("%s says nothing rather than claiming a cadence", ([, over]) => {
    expect(usageWindowLabel(entitlement(over), defaultLocalization)).toBeNull();
  });

  test("the label follows the locale pack, dates included", () => {
    const label = usageWindowLabel(
      entitlement({ currentPeriodStart: START, currentPeriodEnd: END }),
      { ...defaultLocalization, usageMeters: fr.usageMeters },
    );

    expect(label).toMatch(/Sur cette période/);
    expect(label).toMatch(/UTC/);
  });
});
