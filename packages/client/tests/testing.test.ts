import { describe, expect, test } from "vite-plus/test";

import {
  createMockKaitenClient,
  demoCatalog,
  demoCatalogWithoutPrices,
  demoEntitlements,
  demoPlans,
  demoSnapshot,
} from "../src/testing/index.ts";
import { getUsageScope } from "../src/domain/entitlement-usage.ts";

describe("fixtures", () => {
  // Every fixture is a factory, so one consumer mutating what it got cannot
  // reach the next. Shared constants make tests pass or fail by ordering.
  test("each call returns a fresh object graph", () => {
    const first = demoSnapshot();
    const second = demoSnapshot();

    expect(first).not.toBe(second);
    expect(first.entitlements[0]).not.toBe(second.entitlements[0]);

    first.entitlements[0]!.name = "mutated";
    expect(second.entitlements[0]?.name).not.toBe("mutated");
  });

  // The portal joins a license to its price by slug, which only works because
  // `planFromLicense` builds every plan from a license. A fixture that broke the
  // correspondence would silently disable the join it exists to exercise.
  test("the snapshot's license matches a plan in its own catalog", () => {
    const snapshot = demoSnapshot();
    const plan = snapshot.plans.find((candidate) => candidate.slug === snapshot.license?.slug);

    expect(plan).toBeDefined();
    expect(plan?.price).toBe(7900);
  });

  // Real orgs have licenses that must never reach a public pricing page. Keeping
  // one unpublished here means every consumer of the fixtures exercises the
  // filter, not just its own unit test.
  test("the catalog includes an unpublished plan", () => {
    expect(demoPlans().some((plan) => plan.published === false)).toBe(true);
  });

  test("the metered entitlement carries a sale unit distinct from its base unit", () => {
    const tokens = demoPlans()
      .find((plan) => plan.slug === "growth")
      ?.entitlements?.find((entitlement) => entitlement.slug === "tokens");

    expect(tokens?.unitSingular).toBe("token");
    expect(tokens?.saleUnitFactor).toBe(1_000_000);

    // 40,000,000 tokens quoted in sale units is "40 × 1M tokens".
    const limit = tokens?.value?.type === "number" ? tokens.value.value : 0;
    expect(limit / (tokens?.saleUnitFactor ?? 1)).toBe(40);
  });

  // A component has to render each of these differently. Fixtures that only
  // covered the healthy case would let the other branches rot untested.
  test("resolved entitlements span every status a UI must render", () => {
    const statuses = new Set(demoEntitlements().map((entitlement) => entitlement.status));
    expect(statuses).toEqual(new Set(["enabled", "near_limit", "over_limit"]));

    expect(demoEntitlements().some((entitlement) => entitlement.unlimited)).toBe(true);
    // An internal counter, which customer-facing components must hide.
    expect(demoEntitlements().some((entitlement) => entitlement.userFacing === false)).toBe(true);
  });

  // Anti-vacuity guard. Every downstream assertion about window labels renders
  // this set; if it were uniformly lifetime, a component that never annotated
  // anything would pass them all.
  test("resolved entitlements span both usage scopes", () => {
    const scopes = demoEntitlements().map(getUsageScope);
    expect(scopes).toContain("PERIODIC");
    expect(scopes).toContain("LIFETIME");
  });

  // No price model exists server-side, so "no amount anywhere" is the shape most
  // adopters see first and the one components must handle without inventing a 0.
  test("the price-free catalog really carries no amounts", () => {
    for (const plan of demoCatalogWithoutPrices().plans) {
      expect(plan.price).toBeUndefined();
      expect(plan.annualPrice).toBeUndefined();
      expect(plan.prices).toBeUndefined();
    }
  });
});

describe("createMockKaitenClient", () => {
  test("serves the demo fixtures by default", async () => {
    const client = createMockKaitenClient();

    expect((await client.getCatalog()).plans).toHaveLength(demoPlans().length);
    expect((await client.getLicensingSnapshot("acme")).license?.slug).toBe("growth");
  });

  test("takes an explicit catalog and snapshot", async () => {
    const client = createMockKaitenClient({
      catalog: demoCatalogWithoutPrices(),
      snapshot: demoSnapshot({ license: null }),
    });

    expect((await client.getCatalog()).plans[0]?.price).toBeUndefined();
    expect((await client.getLicensingSnapshot("acme")).license).toBeNull();
  });

  // The difference between a fake and a stub. A double that only recorded the
  // call would let a usage meter look right against it and wrong against the
  // API; here the reported value moves the meter, the percentage and the status
  // together, exactly as the snapshot normalizer does.
  test("reportUsage moves the usage it reports", async () => {
    const client = createMockKaitenClient();

    await client.reportUsage("acme-production", "seats", {
      value: { type: "number", value: 3 },
      behavior: "append",
    });

    const seats = client.snapshot.entitlements.find((entitlement) => entitlement.slug === "seats");
    // 21 + 3 of 25.
    expect(seats?.currentValue).toEqual({ type: "number", value: 24 });
    expect(seats?.remaining).toBe(1);
    expect(seats?.percentageUsed).toBe(96);
    expect(seats?.status).toBe("near_limit");
  });

  // The fake counts inside the window it was given and does not roll it over —
  // a rollover is triggered server-side by a report crossing the boundary. What
  // matters here is that the row it returns says which window it counted in; a
  // double that dropped the bounds would let a component look right against it
  // and silent against the API.
  test("reportUsage returns the window it counted in", async () => {
    const client = createMockKaitenClient();

    const usage = await client.reportUsage("acme-production", "tokens", {
      value: { type: "number", value: 1_000_000 },
      behavior: "append",
    });

    expect(usage.currentPeriodStart).toBe("2026-03-01T00:00:00Z");
    expect(usage.currentPeriodEnd).toBe("2026-04-01T00:00:00Z");
  });

  test("a lifetime counter reports no window rather than a fabricated one", async () => {
    const client = createMockKaitenClient();

    const usage = await client.reportUsage("acme-production", "seats", {
      value: { type: "number", value: 1 },
      behavior: "append",
    });

    expect(usage.currentPeriodStart).toBeUndefined();
    expect(usage.currentPeriodEnd).toBeUndefined();
  });

  test("a set behaviour replaces rather than adds, and crossing the limit flips the status", async () => {
    const client = createMockKaitenClient();

    await client.reportUsage("acme-production", "seats", {
      value: { type: "number", value: 25 },
      behavior: "set",
    });

    const seats = client.snapshot.entitlements.find((entitlement) => entitlement.slug === "seats");
    expect(seats?.currentValue).toEqual({ type: "number", value: 25 });
    expect(seats?.remaining).toBe(0);
    expect(seats?.status).toBe("over_limit");
  });

  // Unlimited grants have no cap to consume toward, so usage must accumulate
  // without ever producing a remaining, a percentage or a limit status.
  test("usage on an unlimited entitlement never produces a limit", async () => {
    const client = createMockKaitenClient();

    await client.reportUsage("acme-production", "projects", {
      value: { type: "number", value: 50 },
      behavior: "append",
    });

    const projects = client.snapshot.entitlements.find(
      (entitlement) => entitlement.slug === "projects",
    );
    expect(projects?.currentValue).toEqual({ type: "number", value: 362 });
    expect(projects?.remaining).toBeNull();
    expect(projects?.percentageUsed).toBeNull();
    expect(projects?.status).toBe("enabled");
  });

  test("records every usage report for assertions", async () => {
    const calls: string[] = [];
    const client = createMockKaitenClient({
      onReportUsage: (_instance, slug) => calls.push(slug),
    });

    await client.reportUsage("acme-production", "seats", {
      value: { type: "number", value: 1 },
      behavior: "append",
    });

    expect(calls).toEqual(["seats"]);
    expect(client.usageReports).toHaveLength(1);
    expect(client.usageReports[0]?.instanceSlug).toBe("acme-production");
  });

  test("evaluates flags from the snapshot, and unknown ones fail closed", async () => {
    const client = createMockKaitenClient();

    expect(await client.evaluateFlag("new-dashboard")).toMatchObject({ value: true });
    expect(await client.evaluateFlag("never-defined")).toMatchObject({
      value: false,
      reason: "DEFAULT",
    });
    expect((await client.evaluateFlags()).flags).toHaveLength(3);
  });

  // Failure states are as much a part of a UI as the happy path, and are the
  // hardest to reach against a real API.
  test("error makes every read reject", async () => {
    const client = createMockKaitenClient({ error: new Error("backend down") });

    await expect(client.getCatalog()).rejects.toThrow("backend down");
    await expect(client.getLicensingSnapshot("acme")).rejects.toThrow("backend down");
  });

  test("the scenario can be swapped mid-flight", async () => {
    const client = createMockKaitenClient();

    client.setSnapshot(
      demoSnapshot({ license: { ...demoSnapshot().license!, slug: "enterprise" } }),
    );
    client.setCatalog(demoCatalog({ branding: { removable: true } }));

    expect((await client.getLicensingSnapshot("acme")).license?.slug).toBe("enterprise");
    expect((await client.getCatalog()).branding?.removable).toBe(true);
  });
});
