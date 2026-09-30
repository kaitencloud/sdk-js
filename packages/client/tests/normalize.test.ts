import { describe, expect, test } from "vite-plus/test";

import {
  normalizeResolvedEntitlements,
  planFromLicense,
  resolveLicenseTerm,
} from "../src/client/normalize.ts";
import { resolveUsageScope } from "../src/domain/entitlement-usage.ts";
import type {
  Instance,
  License,
  LicenseEntitlement,
  LicenseEntitlementRow,
} from "../src/client/types.ts";

// Minimal LicenseEntitlement fixture — only the fields the normalizers read.
// Cast through `unknown` so tests need not build the full readonly audit shape.
function licenseEntitlement(over: Partial<LicenseEntitlement>): LicenseEntitlement {
  return {
    entitlementName: "Customers",
    entitlementSlug: "customers",
    entitlementType: "NUMBER",
    licenseSlug: "growth",
    value: { type: "number", value: 120 },
    ...over,
  } as unknown as LicenseEntitlement;
}

const license = {
  slug: "growth",
  name: "Growth",
  lifecycleState: "PUBLISHED",
  familyId: "fam-1",
} as unknown as License;

describe("entitlement group → category/tags mapping", () => {
  test("normalizeResolvedEntitlements surfaces the first group name as category and group slugs as tags", () => {
    const [resolved] = normalizeResolvedEntitlements(
      [
        licenseEntitlement({
          entitlementGroups: [
            { id: "g1", name: "Plateforme", slug: "platform" },
            { id: "g2", name: "Avancé", slug: "advanced" },
          ],
        }),
      ],
      [],
    );

    expect(resolved.category).toBe("Plateforme");
    expect(resolved.tags).toEqual(["platform", "advanced"]);
  });

  test("planFromLicense carries category/tags onto plan entitlements", () => {
    const plan = planFromLicense(license, [
      licenseEntitlement({
        entitlementGroups: [{ id: "g1", name: "Licensing & accès", slug: "licensing" }],
      }),
    ]);

    expect(plan.entitlements?.[0]?.category).toBe("Licensing & accès");
    expect(plan.entitlements?.[0]?.tags).toEqual(["licensing"]);
  });

  test("entitlements without groups keep category/tags null (no fabricated data)", () => {
    const [resolved] = normalizeResolvedEntitlements([licenseEntitlement({})], []);
    expect(resolved.category).toBeNull();
    expect(resolved.tags).toBeNull();

    const plan = planFromLicense(license, [licenseEntitlement({})]);
    expect(plan.entitlements?.[0]?.category).toBeNull();
    expect(plan.entitlements?.[0]?.tags).toBeNull();
  });
});

// The sale unit is what turns a price into a quotable one: an entitlement can be
// metered in tokens and sold per million. The fields ride the entitlement
// DEFINITION, which only the GraphQL read path attaches — the REST projection
// carries no definition at all, hence the "absent" case below.
describe("license lifecycle state → plan", () => {
  // `published` came from `isActive`, which the contract no longer carries, so it
  // was undefined for every plan: a page filtering on `published !== false`
  // showed drafts and withdrawn versions alike.
  test.each([
    ["PUBLISHED", true],
    ["DRAFT", false],
    ["ARCHIVED", false],
  ] as const)("a %s license gives a plan with published %s", (lifecycleState, published) => {
    const plan = planFromLicense({ ...license, lifecycleState }, []);
    expect(plan).toMatchObject({ published, lifecycleState, familyId: "fam-1" });
  });
});

describe("sale unit metadata", () => {
  const tokens: LicenseEntitlementRow = {
    entitlementName: "Tokens",
    entitlementSlug: "tokens",
    entitlementType: "NUMBER",
    licenseSlug: "growth",
    value: { type: "number", value: 40_000_000 },
    entitlement: {
      slug: "tokens",
      name: "Tokens",
      unitSingular: "token",
      unitPlural: "tokens",
      saleUnitSingular: "1M tokens",
      saleUnitPlural: "1M tokens",
      saleUnitFactor: 1_000_000,
    },
  };

  test("normalizeResolvedEntitlements surfaces the sale unit alongside the base unit", () => {
    const [resolved] = normalizeResolvedEntitlements([tokens], []);

    expect(resolved.unitSingular).toBe("token");
    expect(resolved.saleUnitSingular).toBe("1M tokens");
    expect(resolved.saleUnitPlural).toBe("1M tokens");
    expect(resolved.saleUnitFactor).toBe(1_000_000);
  });

  test("planFromLicense carries the sale unit onto plan entitlements", () => {
    const plan = planFromLicense(license, [tokens]);

    expect(plan.entitlements?.[0]?.saleUnitSingular).toBe("1M tokens");
    expect(plan.entitlements?.[0]?.saleUnitFactor).toBe(1_000_000);
  });

  // The factor is what a caller divides by to quote a limit in sale units. It
  // has to survive as a number, not a string or a stringified null — that is the
  // whole point of exposing it rather than the label alone.
  test("the factor divides a base-unit limit into sale units", () => {
    const [resolved] = normalizeResolvedEntitlements([tokens], []);
    const limit = resolved.limitValue.type === "number" ? resolved.limitValue.value : 0;

    expect(limit / resolved.saleUnitFactor!).toBe(40);
  });

  // No definition = REST read path. Everything presentational stays undefined,
  // and the sale unit must not be invented (a defaulted factor of 1 would read
  // as a real "sold per unit" claim the server never made).
  test("rows without an entitlement definition carry no sale unit", () => {
    const [resolved] = normalizeResolvedEntitlements([licenseEntitlement({})], []);

    expect(resolved.saleUnitSingular).toBeUndefined();
    expect(resolved.saleUnitPlural).toBeUndefined();
    expect(resolved.saleUnitFactor).toBeUndefined();
  });

  // A definition that carries a base unit but no sale unit is the normal shape
  // for a seat-style entitlement: sold in the unit it is metered in.
  test("a definition without sale-unit fields keeps them null, not fabricated", () => {
    const seats: LicenseEntitlementRow = {
      entitlementName: "Seats",
      entitlementSlug: "seats",
      entitlementType: "NUMBER",
      licenseSlug: "growth",
      value: { type: "number", value: 10 },
      entitlement: {
        slug: "seats",
        name: "Seats",
        unitSingular: "seat",
        unitPlural: "seats",
        saleUnitSingular: null,
        saleUnitPlural: null,
        saleUnitFactor: null,
      },
    };

    const [resolved] = normalizeResolvedEntitlements([seats], []);
    expect(resolved.unitSingular).toBe("seat");
    expect(resolved.saleUnitFactor).toBeNull();
  });
});

describe("resolveLicenseTerm", () => {
  const instanceAt = (start: string, end: string) =>
    ({ startLicenseDate: start, endLicenseDate: end }) as Instance;

  test("reports the period as active inside it", () => {
    const term = resolveLicenseTerm(
      instanceAt("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"),
      new Date("2026-08-11T00:00:00Z"),
    );
    expect(term).toEqual({
      status: "active",
      startsAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
    });
  });

  // The regression this exists for: endLicenseDate crossed the wire, was mapped
  // onto Instance, and then read by nothing — so an expired license kept every
  // entitlement it granted.
  test("reports the period as expired past the end date", () => {
    const term = resolveLicenseTerm(
      instanceAt("2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
      new Date("2026-08-11T00:00:00Z"),
    );
    expect(term?.status).toBe("expired");
  });

  test("reports a period that has not begun", () => {
    const term = resolveLicenseTerm(
      instanceAt("2027-01-01T00:00:00Z", "2028-01-01T00:00:00Z"),
      new Date("2026-08-11T00:00:00Z"),
    );
    expect(term?.status).toBe("not_started");
  });

  test("the end date is exclusive", () => {
    const term = resolveLicenseTerm(
      instanceAt("2026-01-01T00:00:00Z", "2026-08-11T00:00:00Z"),
      new Date("2026-08-11T00:00:00Z"),
    );
    expect(term?.status).toBe("expired");
  });

  // An unknown term must not read as expired: that would lock out a live
  // customer over a missing or malformed field.
  test("yields null when there is no instance or the dates are unusable", () => {
    expect(resolveLicenseTerm(null)).toBeNull();
    expect(resolveLicenseTerm(instanceAt("not-a-date", "2027-01-01T00:00:00Z"))).toBeNull();
    expect(resolveLicenseTerm({} as Instance)).toBeNull();
  });
});

describe("usage window bounds", () => {
  const usageRow = (over: Record<string, unknown> = {}) =>
    ({
      entitlementId: "ent-1",
      entitlementSlug: "customers",
      licenseId: "lic-1",
      licenseSlug: "growth",
      value: { type: "number", value: 42 },
      ...over,
    }) as never;

  test("the bounds survive normalization", () => {
    const [resolved] = normalizeResolvedEntitlements(
      [licenseEntitlement({})],
      [
        usageRow({
          currentPeriodStart: "2026-03-01T00:00:00Z",
          currentPeriodEnd: "2026-04-01T00:00:00Z",
        }),
      ],
    );

    expect(resolved.currentPeriodStart).toBe("2026-03-01T00:00:00Z");
    expect(resolved.currentPeriodEnd).toBe("2026-04-01T00:00:00Z");
    expect(resolveUsageScope(resolved)).toBe("PERIODIC");
  });

  // The API zero-fills usage for entitlements never reported into, bounds
  // included, so a successful read with no bounds is a fact about the
  // entitlement — not a gap to be filled in. The SDK never computes a window:
  // that arithmetic is server-side and, for a LICENSE_START anchor, phased off
  // each instance's own license start date.
  test("absent bounds are a lifetime counter, not missing data", () => {
    const [resolved] = normalizeResolvedEntitlements([licenseEntitlement({})], [usageRow()]);

    expect(resolved.currentPeriodStart).toBeNull();
    expect(resolved.currentPeriodEnd).toBeNull();
    expect(resolveUsageScope(resolved)).toBe("LIFETIME");
  });

  test("a failed usage read leaves the window unknown, not lifetime", () => {
    const [resolved] = normalizeResolvedEntitlements([licenseEntitlement({})], null, {
      usageUnavailable: true,
    });

    expect(resolved.usageUnavailable).toBe(true);
    expect(resolved.currentPeriodStart).toBeUndefined();
    expect(resolveUsageScope(resolved)).toBe("UNKNOWN");
  });

  // The GraphQL path: rows are real, the window was never selected. Marking it
  // unknown is what stops a monthly quota from being labelled "Lifetime" — and
  // "Lifetime" is worse than nothing, because it is an answer rather than a
  // silence.
  test("a read path that carries no bounds leaves the window unknown", () => {
    const [resolved] = normalizeResolvedEntitlements([licenseEntitlement({})], [usageRow()], {
      usageWindowUnknown: true,
    });

    expect(resolved.usageWindowUnknown).toBe(true);
    expect(resolved.currentPeriodStart).toBeUndefined();
    expect(resolveUsageScope(resolved)).toBe("UNKNOWN");
  });
});

// A soft limit keeps serving usage past the value the customer bought, up to
// `value + value × percent / 100`. Read against the raw value, every grant in
// that band looked spent — a paywall where the server would have answered.
describe("soft limits", () => {
  const usageRow = (value: number) =>
    ({
      entitlementId: "ent-1",
      entitlementSlug: "customers",
      licenseId: "lic-1",
      licenseSlug: "growth",
      value: { type: "number", value },
    }) as never;

  const softGrant = licenseEntitlement({
    value: { type: "number", value: 100 },
    limitCapExceededOveragePercent: 10,
  } as never);

  test("counts what is left against the ceiling, not the granted value", () => {
    const [atValue] = normalizeResolvedEntitlements([softGrant], [usageRow(100)]);
    expect(atValue.remaining).toBe(10);
    expect(atValue.status).toBe("near_limit");

    const [inOverage] = normalizeResolvedEntitlements([softGrant], [usageRow(105)]);
    expect(inOverage.remaining).toBe(5);
    expect(inOverage.status).toBe("near_limit");
  });

  test("is spent only where the server starts refusing", () => {
    const [atCeiling] = normalizeResolvedEntitlements([softGrant], [usageRow(110)]);
    expect(atCeiling.remaining).toBe(0);
    expect(atCeiling.status).toBe("over_limit");
  });

  // The meter still reads against what was bought, so crossing the included
  // value is visible rather than rescaled away.
  test("keeps the percentage a share of the granted value", () => {
    const [inOverage] = normalizeResolvedEntitlements([softGrant], [usageRow(105)]);
    expect(inOverage.percentageUsed).toBe(105);
  });

  test("carries the allowance and the ceiling for the host to read", () => {
    const [resolved] = normalizeResolvedEntitlements([softGrant], [usageRow(105)]);
    expect(resolved.limitCapExceededOveragePercent).toBe(10);
    expect(resolved.maximumAllowedUsage).toBe(110);
  });

  test("leaves a hard limit exactly where it was", () => {
    const hard = licenseEntitlement({
      value: { type: "number", value: 100 },
      limitCapExceededOveragePercent: 0,
    } as never);

    const [atValue] = normalizeResolvedEntitlements([hard], [usageRow(100)]);
    expect(atValue.remaining).toBe(0);
    expect(atValue.status).toBe("over_limit");
    expect(atValue.maximumAllowedUsage).toBe(100);
  });

  // A grant written before the field existed reads as a hard limit, the same
  // default the server applies.
  test("reads a missing allowance as a hard limit", () => {
    const [atValue] = normalizeResolvedEntitlements(
      [licenseEntitlement({ value: { type: "number", value: 100 } })],
      [usageRow(100)],
    );
    expect(atValue.remaining).toBe(0);
    expect(atValue.status).toBe("over_limit");
  });

  test("leaves an unlimited grant uncapped", () => {
    const [resolved] = normalizeResolvedEntitlements(
      [
        licenseEntitlement({
          value: { type: "number", value: -1 },
          limitCapExceededOveragePercent: -1,
        } as never),
      ],
      [usageRow(5000)],
    );
    expect(resolved.remaining).toBeNull();
    expect(resolved.maximumAllowedUsage).toBeNull();
    expect(resolved.status).toBe("enabled");
  });
});
