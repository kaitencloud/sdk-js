import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient } from "../src/client/client.ts";
import { defaultActions } from "../src/client/normalize.ts";
import { isEvaluationFailure, isEvaluationSuccess } from "../src/client/feature-flags.ts";
import type { EvaluationResult, ReportUsageInput } from "../src/client/types.ts";
import { assertGraphqlResponseConforms } from "./support/graphql-conformance.ts";

type FetchMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Routes a mocked fetch by `"METHOD /pathname"` (query string ignored for matching). */
function router(routes: Record<string, (req: Request) => unknown>): FetchMock {
  return vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    const url = new URL(req.url);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) {
      return json(
        { title: "Unmatched route", status: 404, detail: `${req.method} ${url.pathname}` },
        404,
      );
    }
    const body = handler(req);
    // A GraphQL double may only serve fields the committed schema declares.
    // Doubles that invented fields are what made a dead query look alive for
    // weeks — see tests/support/graphql-conformance.ts.
    if (url.pathname === "/graphql" && body && typeof body === "object" && "data" in body) {
      assertGraphqlResponseConforms((body as { data: unknown }).data);
    }
    return json(body);
  });
}

function findRequest(fetchMock: FetchMock, pathname: string, method = "GET"): Request | undefined {
  for (const [input] of fetchMock.mock.calls) {
    const req = input as Request;
    if (req instanceof Request && new URL(req.url).pathname === pathname && req.method === method) {
      return req;
    }
  }
  return undefined;
}

function makeClient(fetchMock: FetchMock): KaitenClient {
  return new KaitenClient({ apiUrl: "https://api.test", authScheme: "none", fetch: fetchMock });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KaitenClient resource facades", () => {
  test("customers facade lists and fetches by slug", async () => {
    const fetchMock = router({
      "GET /customers": () => [{ id: "cust-1", slug: "acme", name: "Acme" }],
      "GET /customers/acme": () => ({ id: "cust-1", slug: "acme", name: "Acme" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    await expect(client.customers.list()).resolves.toEqual([
      { id: "cust-1", slug: "acme", name: "Acme" },
    ]);
    await expect(client.customers.get("acme")).resolves.toMatchObject({ slug: "acme" });
  });

  test("instances facade lists and fetches by slug", async () => {
    const fetchMock = router({
      "GET /instances": () => [{ id: "inst-1", slug: "demo", name: "Demo" }],
      "GET /instances/demo": () => ({ id: "inst-1", slug: "demo", name: "Demo" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    await expect(client.instances.list()).resolves.toEqual([
      { id: "inst-1", slug: "demo", name: "Demo" },
    ]);
    await expect(client.instances.get("demo")).resolves.toMatchObject({ slug: "demo" });
  });

  test("licenses facade lists, fetches, and reads entitlements", async () => {
    const fetchMock = router({
      "GET /licenses": () => [{ id: "lic-1", slug: "pro", name: "Pro" }],
      "GET /licenses/pro": () => ({ id: "lic-1", slug: "pro", name: "Pro" }),
      "GET /licenses/pro/entitlements": () => [
        { licenseSlug: "pro", entitlementSlug: "seats", entitlementName: "Seats" },
      ],
      "GET /licenses/pro/entitlements/seats": () => ({
        licenseSlug: "pro",
        entitlementSlug: "seats",
        entitlementName: "Seats",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    await expect(client.licenses.list()).resolves.toMatchObject([{ slug: "pro" }]);
    await expect(client.licenses.get("pro")).resolves.toMatchObject({ slug: "pro" });
    await expect(client.licenses.listEntitlements("pro")).resolves.toMatchObject([
      { entitlementSlug: "seats" },
    ]);
    await expect(client.licenses.getEntitlement("pro", "seats")).resolves.toMatchObject({
      entitlementSlug: "seats",
    });

    expect(findRequest(fetchMock, "/licenses/pro/entitlements/seats")?.url).toContain(
      "/licenses/pro/entitlements/seats",
    );
  });

  test("usage facade reads per-instance, per-entitlement, and per-group metrics", async () => {
    const fetchMock = router({
      "GET /instances/demo/entitlements/usage": () => [
        { entitlementSlug: "seats", value: { type: "number", value: 12 } },
      ],
      "GET /instances/demo/entitlements/seats/usage": () => ({
        entitlementSlug: "seats",
        value: { type: "number", value: 12 },
      }),
      "GET /entitlement-groups/team/usage": () => [
        { entitlementSlug: "seats", value: { type: "number", value: 12 } },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    await expect(client.usage.getByInstance("demo")).resolves.toMatchObject([
      { entitlementSlug: "seats" },
    ]);
    await expect(client.usage.getDetail("demo", "seats")).resolves.toMatchObject({
      entitlementSlug: "seats",
    });
    await expect(client.usage.getByGroup("team", "demo")).resolves.toMatchObject([
      { entitlementSlug: "seats" },
    ]);

    // getByGroup forwards the instance slug as a query param, not a path segment.
    const groupReq = findRequest(fetchMock, "/entitlement-groups/team/usage");
    expect(new URL(groupReq!.url).searchParams.get("instance")).toBe("demo");
  });

  test("usage.report POSTs the usage payload as JSON", async () => {
    const fetchMock = router({
      "POST /instances/demo/entitlements/seats/usage": () => ({
        entitlementSlug: "seats",
        value: { type: "number", value: 13 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const input: ReportUsageInput = {
      value: { type: "number", value: 1 },
      behavior: "append",
    };
    await expect(client.usage.report("demo", "seats", input)).resolves.toMatchObject({
      entitlementSlug: "seats",
    });

    const req = findRequest(fetchMock, "/instances/demo/entitlements/seats/usage", "POST");
    expect(req?.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(await req!.clone().text())).toEqual(input);
  });

  test("flags.evaluateAll posts the context and returns the bulk flags", async () => {
    const fetchMock = router({
      "POST /ofrep/v1/evaluate/flags": () => ({
        flags: [
          { key: "a", value: true, reason: "TARGETING_MATCH" },
          { key: "b", errorCode: "FLAG_NOT_FOUND", errorDetails: "nope" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const result = await client.flags.evaluateAll({ plan: "pro" });
    expect(result.flags).toHaveLength(2);
    expect(result.flags[0]).toMatchObject({ key: "a", value: true });

    const req = findRequest(fetchMock, "/ofrep/v1/evaluate/flags", "POST");
    expect(JSON.parse(await req!.clone().text())).toEqual({ context: { plan: "pro" } });
  });

  test("flags.evaluateAll defaults to an empty list when the API omits flags", async () => {
    const fetchMock = router({ "POST /ofrep/v1/evaluate/flags": () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    await expect(client.flags.evaluateAll()).resolves.toEqual({ flags: [] });
  });

  test("getCatalog composes plans from licenses and defaults branding", async () => {
    const fetchMock = router({
      "GET /licenses": () => [
        {
          id: "lic-1",
          slug: "pro",
          name: "Pro",
          description: "Pro plan",
          lifecycleState: "PUBLISHED",
          familyId: "fam-1",
          isDefault: true,
        },
      ],
      "GET /licenses/pro/entitlements": () => [
        {
          licenseSlug: "pro",
          entitlementSlug: "seats",
          entitlementName: "Seats",
          entitlementType: "NUMBER",
          value: { type: "number", value: 10 },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const catalog = await client.components.getCatalog();
    expect(catalog.plans[0]).toMatchObject({
      slug: "pro",
      name: "Pro",
      published: true,
      highlighted: true,
    });
    expect(catalog.plans[0]?.entitlements?.[0]).toMatchObject({
      slug: "seats",
      name: "Seats",
      type: "NUMBER",
    });
    expect(catalog.branding).toEqual({ removable: false });
  });

  test("getCatalog prefers GraphQL and carries presentation metadata", async () => {
    const fetchMock = router({
      "POST /graphql": () => ({
        data: {
          licenses: {
            items: [
              {
                id: "lic-1",
                name: "Pro",
                slug: "pro",
                description: "Pro plan",
                type: "PAID",
                version: "1",
                versionName: "v1",
                isDefault: true,
                lifecycleState: "PUBLISHED",
                family: { id: "fam-1" },
                entitlements: [
                  {
                    entitlementSlug: "seats",
                    entitlementName: "Seats",
                    entitlementType: "NUMBER",
                    licenseSlug: "pro",
                    value: { type: "number", value: 10 },
                    entitlement: {
                      id: "ent-1",
                      name: "Seats",
                      slug: "seats",
                      description: "Number of seats",
                      type: "NUMBER",
                      icon: "lucide:users",
                      unitSingular: "seat",
                      unitPlural: "seats",
                      saleUnitSingular: null,
                      saleUnitPlural: null,
                      saleUnitFactor: null,
                      userFacing: true,
                      displayOrder: 10,
                      entitlementGroups: [{ id: "g1", name: "Platform", slug: "platform" }],
                    },
                  },
                ],
              },
            ],
            hasMore: false,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const catalog = await client.components.getCatalog();
    expect(catalog.plans[0]?.entitlements?.[0]).toMatchObject({
      slug: "seats",
      unitSingular: "seat",
      unitPlural: "seats",
      userFacing: true,
      displayOrder: 10,
      icon: "lucide:users",
      category: "Platform",
      tags: ["platform"],
    });
    // GraphQL served the whole catalog — the REST fan-out must not have run.
    expect(findRequest(fetchMock, "/licenses")).toBeUndefined();
    expect(findRequest(fetchMock, "/licenses/pro/entitlements")).toBeUndefined();
  });

  test("getCatalog falls back to REST when GraphQL responds with errors", async () => {
    const fetchMock = router({
      "POST /graphql": () => ({
        errors: [{ message: 'Cannot query field "entitlements" on type "License"' }],
      }),
      "GET /licenses": () => [
        {
          id: "lic-1",
          slug: "pro",
          name: "Pro",
          description: "Pro plan",
          lifecycleState: "PUBLISHED",
          familyId: "fam-1",
        },
      ],
      "GET /licenses/pro/entitlements": () => [
        {
          licenseSlug: "pro",
          entitlementSlug: "seats",
          entitlementName: "Seats",
          entitlementType: "NUMBER",
          value: { type: "number", value: 10 },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const catalog = await client.components.getCatalog();
    expect(catalog.plans[0]?.entitlements?.[0]).toMatchObject({ slug: "seats", name: "Seats" });
    // Presentation fields are simply absent on the REST path.
    expect(catalog.plans[0]?.entitlements?.[0]?.unitPlural).toBeUndefined();
  });
});

describe("KaitenClient.getLicensingSnapshot", () => {
  test("composes a snapshot from customer, instance, license and usage", async () => {
    const fetchMock = router({
      "GET /customers/cust-1": () => ({ id: "cust-1", slug: "cust-1", name: "Acme" }),
      "GET /instances/inst-1": () => ({
        id: "inst-1",
        slug: "inst-1",
        name: "Prod",
        customerSlug: "cust-1",
        licenseSlug: "pro",
      }),
      "GET /licenses": () => [
        {
          id: "lic-1",
          slug: "pro",
          name: "Pro",
          lifecycleState: "PUBLISHED",
          familyId: "fam-1",
          isDefault: true,
        },
      ],
      "GET /licenses/pro": () => ({
        id: "lic-1",
        slug: "pro",
        name: "Pro",
        lifecycleState: "PUBLISHED",
        familyId: "fam-1",
        isDefault: true,
      }),
      "GET /licenses/pro/entitlements": () => [
        {
          licenseSlug: "pro",
          entitlementSlug: "seats",
          entitlementName: "Seats",
          entitlementType: "NUMBER",
          value: { type: "number", value: 10 },
        },
      ],
      "GET /instances/inst-1/entitlements/usage": () => [
        { entitlementSlug: "seats", value: { type: "number", value: 4 } },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const snapshot = await client.getLicensingSnapshot("cust-1", "inst-1");

    expect(snapshot.source).toBe("snapshot");
    expect(snapshot.customer).toMatchObject({ slug: "cust-1" });
    expect(snapshot.instance).toMatchObject({ slug: "inst-1" });
    expect(snapshot.license).toMatchObject({ slug: "pro" });
    expect(snapshot.plans[0]).toMatchObject({ slug: "pro", name: "Pro" });
    expect(snapshot.entitlements[0]).toMatchObject({
      slug: "seats",
      type: "NUMBER",
      limitValue: { type: "number", value: 10 },
      currentValue: { type: "number", value: 4 },
      remaining: 6,
      status: "enabled",
    });

    // Commerce concepts are not modelled server-side and default to empty.
    expect(snapshot.actions).toEqual(defaultActions());
    expect(snapshot.capabilities).toEqual({
      paymentMethods: false,
      invoices: false,
      unsubscribe: false,
      checkout: false,
    });
    expect(snapshot.addOns).toEqual([]);
    expect(snapshot.credits).toEqual([]);
    expect(snapshot.flags).toEqual([]);
    expect(snapshot.branding).toEqual({ removable: false });
  });

  test("treats a negative numeric limit as unlimited (no remaining/percentage, healthy status)", async () => {
    const fetchMock = router({
      "GET /customers/cust-1": () => ({ id: "cust-1", slug: "cust-1", name: "Acme" }),
      "GET /instances/inst-1": () => ({
        id: "inst-1",
        slug: "inst-1",
        name: "Prod",
        customerSlug: "cust-1",
        licenseSlug: "pro",
      }),
      "GET /licenses": () => [
        {
          id: "lic-1",
          slug: "pro",
          name: "Pro",
          lifecycleState: "PUBLISHED",
          familyId: "fam-1",
          isDefault: true,
        },
      ],
      "GET /licenses/pro": () => ({
        id: "lic-1",
        slug: "pro",
        name: "Pro",
        lifecycleState: "PUBLISHED",
        familyId: "fam-1",
        isDefault: true,
      }),
      "GET /licenses/pro/entitlements": () => [
        {
          licenseSlug: "pro",
          entitlementSlug: "api_calls",
          entitlementName: "API calls",
          entitlementType: "NUMBER",
          value: { type: "number", value: -1 },
        },
      ],
      "GET /instances/inst-1/entitlements/usage": () => [
        { entitlementSlug: "api_calls", value: { type: "number", value: 4200 } },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const snapshot = await client.getLicensingSnapshot("cust-1", "inst-1");

    // -1 is the "unlimited" sentinel: usage is tracked but there is no cap, so the
    // resolved entitlement must not read as exhausted (remaining 0 / over_limit).
    expect(snapshot.entitlements[0]).toMatchObject({
      slug: "api_calls",
      limitValue: { type: "number", value: -1 },
      currentValue: { type: "number", value: 4200 },
      remaining: null,
      percentageUsed: null,
      status: "enabled",
    });
  });

  test("degrades gracefully when an optional leg fails instead of rejecting the whole snapshot", async () => {
    // The usage route is omitted on purpose -> 404 -> getInstanceUsage throws.
    // The composer must catch it and still return customer/license/plans/entitlements
    // (before the per-leg .catch, this one failing endpoint rejected the whole snapshot).
    const fetchMock = router({
      "GET /customers/cust-1": () => ({ id: "cust-1", slug: "cust-1", name: "Acme" }),
      "GET /instances/inst-1": () => ({
        id: "inst-1",
        slug: "inst-1",
        name: "Prod",
        customerSlug: "cust-1",
        licenseSlug: "pro",
      }),
      "GET /licenses": () => [
        {
          id: "lic-1",
          slug: "pro",
          name: "Pro",
          lifecycleState: "PUBLISHED",
          familyId: "fam-1",
          isDefault: true,
        },
      ],
      "GET /licenses/pro": () => ({
        id: "lic-1",
        slug: "pro",
        name: "Pro",
        lifecycleState: "PUBLISHED",
        familyId: "fam-1",
        isDefault: true,
      }),
      "GET /licenses/pro/entitlements": () => [
        {
          licenseSlug: "pro",
          entitlementSlug: "seats",
          entitlementName: "Seats",
          entitlementType: "NUMBER",
          value: { type: "number", value: 10 },
        },
      ],
      // GET /instances/inst-1/entitlements/usage intentionally omitted -> 404.
    });
    vi.stubGlobal("fetch", fetchMock);
    const degraded: { operation: string; error: unknown }[] = [];
    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      fetch: fetchMock,
      onDegraded: (info) => degraded.push(info),
    });

    // Must resolve (not reject) despite the failing usage leg.
    const snapshot = await client.getLicensingSnapshot("cust-1", "inst-1");

    expect(snapshot.customer).toMatchObject({ slug: "cust-1" });
    expect(snapshot.license).toMatchObject({ slug: "pro" });
    expect(snapshot.plans[0]).toMatchObject({ slug: "pro" });

    // The grant still resolves, but its consumption is UNKNOWN — not zero.
    // Reporting a failed usage read as "0 consumed" left every numeric quota
    // looking empty, so no paywall fired and every check said allowed.
    expect(snapshot.entitlements[0]).toMatchObject({
      slug: "seats",
      limitValue: { type: "number", value: 10 },
      usageUnavailable: true,
    });
    expect(snapshot.entitlements[0]?.currentValue).toBeNull();
    expect(snapshot.entitlements[0]?.remaining).toBeNull();
    expect(snapshot.entitlements[0]?.percentageUsed).toBeNull();

    // And the host is told, instead of the failure being swallowed.
    expect(degraded.map((info) => info.operation)).toContain("getLicensingSnapshot.usage");
  });

  test("populates feature flags from the bulk evaluation (enabled derived from the boolean value, failures dropped)", async () => {
    const fetchMock = router({
      "GET /customers/cust-1": () => ({ id: "cust-1", slug: "cust-1", name: "Acme" }),
      "GET /instances/inst-1": () => ({
        id: "inst-1",
        slug: "inst-1",
        customerSlug: "cust-1",
        licenseSlug: "pro",
      }),
      "GET /licenses": () => [
        {
          id: "lic-1",
          slug: "pro",
          name: "Pro",
          lifecycleState: "PUBLISHED",
          familyId: "fam-1",
          isDefault: true,
        },
      ],
      "GET /licenses/pro": () => ({
        id: "lic-1",
        slug: "pro",
        name: "Pro",
        lifecycleState: "PUBLISHED",
        familyId: "fam-1",
        isDefault: true,
      }),
      "GET /licenses/pro/entitlements": () => [],
      "GET /instances/inst-1/entitlements/usage": () => [],
      "POST /ofrep/v1/evaluate/flags": () => ({
        flags: [
          {
            key: "new-dashboard",
            value: true,
            variant: "on",
            reason: "TARGETING_MATCH",
            metadata: { team: "fe" },
          },
          // Flag is ON but this customer is excluded from the rollout: the
          // evaluated boolean must win over the non-DISABLED reason.
          { key: "excluded-rollout", value: false, reason: "TARGETING_MATCH" },
          // Non-boolean value: fall back to reason !== DISABLED.
          { key: "theme", value: "dark", variant: "dark", reason: "STATIC" },
          { key: "legacy", value: false, reason: "DISABLED" },
          { key: "broken", errorCode: "GENERAL" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const snapshot = await client.getLicensingSnapshot("cust-1", "inst-1");

    // EvaluationFailure ("broken") is dropped; enabled is the evaluated value
    // when boolean, else derives from reason !== DISABLED.
    expect(snapshot.flags).toHaveLength(4);
    expect(snapshot.flags[0]).toMatchObject({
      key: "new-dashboard",
      enabled: true,
      value: true,
      variant: "on",
      reason: "TARGETING_MATCH",
      percentage: null,
    });
    expect(snapshot.flags[1]).toMatchObject({
      key: "excluded-rollout",
      enabled: false,
      value: false,
      reason: "TARGETING_MATCH",
      percentage: null,
    });
    expect(snapshot.flags[2]).toMatchObject({
      key: "theme",
      enabled: true,
      value: "dark",
      variant: "dark",
      reason: "STATIC",
      percentage: null,
    });
    expect(snapshot.flags[3]).toMatchObject({
      key: "legacy",
      enabled: false,
      value: false,
      reason: "DISABLED",
      percentage: null,
    });
  });

  test("resolves the customer's first instance when no instanceId is given", async () => {
    const fetchMock = router({
      "GET /customers/cust-1": () => ({ id: "cust-1", slug: "cust-1", name: "Acme" }),
      "GET /instances": () => [
        { id: "inst-x", slug: "other", customerSlug: "someone-else", licenseSlug: "x" },
        { id: "inst-1", slug: "demo", customerSlug: "cust-1", licenseSlug: "pro" },
      ],
      "GET /licenses": () => [
        {
          id: "lic-1",
          slug: "pro",
          name: "Pro",
          lifecycleState: "PUBLISHED",
          familyId: "fam-1",
          isDefault: false,
        },
      ],
      "GET /licenses/pro": () => ({
        id: "lic-1",
        slug: "pro",
        name: "Pro",
        lifecycleState: "PUBLISHED",
        familyId: "fam-1",
        isDefault: false,
      }),
      "GET /licenses/pro/entitlements": () => [],
      "GET /instances/demo/entitlements/usage": () => [],
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const snapshot = await client.getLicensingSnapshot("cust-1");

    expect(snapshot.instance).toMatchObject({ slug: "demo", customerSlug: "cust-1" });
    expect(snapshot.license).toMatchObject({ slug: "pro" });
  });

  test("rejects when the explicit instance does not belong to the customer", async () => {
    const fetchMock = router({
      "GET /customers/cust-1": () => ({ id: "cust-1", slug: "cust-1", name: "Acme" }),
      "GET /licenses": () => [],
      "GET /instances/inst-other": () => ({
        id: "inst-other",
        slug: "inst-other",
        customerId: "someone-else",
        customerSlug: "someone-else",
        licenseSlug: "pro",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    await expect(client.getLicensingSnapshot("cust-1", "inst-other")).rejects.toThrow(
      /does not belong to customer/,
    );
  });

  // The composed LicensingSnapshot GraphQL payload: customer + instances (with
  // usage) + the full catalog, as the API returns it in one round-trip.
  function gqlSnapshotPayload() {
    return {
      data: {
        licenses: {
          items: [
            {
              id: "lic-1",
              name: "Pro",
              slug: "pro",
              description: "Pro plan",
              type: "PAID",
              version: "1",
              versionName: "v1",
              isDefault: true,
              lifecycleState: "PUBLISHED",
              family: { id: "fam-1" },
              entitlements: [
                {
                  entitlementSlug: "seats",
                  entitlementName: "Seats",
                  entitlementType: "NUMBER",
                  licenseSlug: "pro",
                  value: { type: "number", value: 10 },
                  unlimited: false,
                  entitlement: {
                    id: "ent-1",
                    name: "Seats",
                    slug: "seats",
                    description: "Number of seats",
                    type: "NUMBER",
                    icon: "lucide:users",
                    unitSingular: "seat",
                    unitPlural: "seats",
                    saleUnitSingular: null,
                    saleUnitPlural: null,
                    saleUnitFactor: null,
                    userFacing: true,
                    displayOrder: 10,
                    entitlementGroups: [{ id: "g1", name: "Platform", slug: "platform" }],
                  },
                },
                {
                  entitlementSlug: "api-calls",
                  entitlementName: "API calls",
                  entitlementType: "NUMBER",
                  licenseSlug: "pro",
                  value: { type: "number", value: -1 },
                  unlimited: true,
                  entitlement: {
                    id: "ent-2",
                    name: "API calls",
                    slug: "api-calls",
                    description: null,
                    type: "NUMBER",
                    icon: null,
                    unitSingular: "call",
                    unitPlural: "calls",
                    saleUnitSingular: null,
                    saleUnitPlural: null,
                    saleUnitFactor: null,
                    userFacing: true,
                    displayOrder: 20,
                    entitlementGroups: [],
                  },
                },
              ],
            },
          ],
          hasMore: false,
        },
        customer: {
          id: "cust-uuid",
          slug: "cust-1",
          name: "Acme",
          externalCustomerId: null,
          createdBy: { id: "u1", name: "Ada" },
          createdAt: "2026-01-01T00:00:00Z",
          updatedBy: { id: "u1", name: "Ada" },
          updatedAt: "2026-01-01T00:00:00Z",
          instances: [
            {
              id: "inst-uuid",
              slug: "inst-1",
              name: "Prod",
              description: "Production",
              customerId: "cust-uuid",
              customerSlug: "cust-1",
              licenseId: "lic-1",
              licenseSlug: "pro",
              deploymentZoneId: null,
              startLicenseDate: "2026-01-01T00:00:00Z",
              endLicenseDate: "2027-01-01T00:00:00Z",
              metadata: null,
              createdBy: { id: "u1", name: "Ada" },
              createdAt: "2026-01-01T00:00:00Z",
              updatedBy: { id: "u1", name: "Ada" },
              updatedAt: "2026-01-01T00:00:00Z",
              entitlementUsage: [
                {
                  entitlementId: "ent-1",
                  entitlementSlug: "seats",
                  licenseId: "lic-1",
                  licenseSlug: "pro",
                  value: { type: "number", value: 4, event_count: 2 },
                },
                {
                  entitlementId: "ent-2",
                  entitlementSlug: "api-calls",
                  licenseId: "lic-1",
                  licenseSlug: "pro",
                  value: { type: "number", value: 4200 },
                },
              ],
            },
          ],
        },
      },
    };
  }

  test("prefers the composed GraphQL snapshot: one query, no REST fan-out", async () => {
    const fetchMock = router({
      "POST /graphql": () => gqlSnapshotPayload(),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const snapshot = await client.getLicensingSnapshot("cust-1", "inst-1");

    expect(snapshot.customer).toMatchObject({ slug: "cust-1", name: "Acme" });
    expect(snapshot.instance).toMatchObject({
      slug: "inst-1",
      customerSlug: "cust-1",
      licenseSlug: "pro",
    });
    expect(snapshot.license).toMatchObject({ slug: "pro" });
    expect(snapshot.plans[0]).toMatchObject({ slug: "pro" });
    // Usage joined server-side data: 4/10 seats with presentation metadata.
    expect(snapshot.entitlements[0]).toMatchObject({
      slug: "seats",
      currentValue: { type: "number", value: 4 },
      remaining: 6,
      status: "enabled",
      unlimited: false,
      unitPlural: "seats",
      displayOrder: 10,
    });
    // The unlimited flag comes from the server, not the client sentinel check.
    expect(snapshot.entitlements[1]).toMatchObject({
      slug: "api-calls",
      unlimited: true,
      remaining: null,
      percentageUsed: null,
      status: "enabled",
    });
    // Everything came from the single GraphQL round-trip.
    expect(findRequest(fetchMock, "/customers/cust-1")).toBeUndefined();
    expect(findRequest(fetchMock, "/instances/inst-1")).toBeUndefined();
    expect(findRequest(fetchMock, "/licenses")).toBeUndefined();
    expect(findRequest(fetchMock, "/instances/inst-1/entitlements/usage")).toBeUndefined();
  });

  test("GraphQL snapshot: server unlimited flag wins over the raw value", async () => {
    // A negative-but-not-sentinel threshold: the server enforces it (unlimited:
    // false), while the legacy client heuristic would have read it as unlimited.
    const payload = gqlSnapshotPayload();
    const grant = payload.data.licenses.items[0]?.entitlements[1];
    if (!grant) throw new Error("fixture grant missing");
    grant.value = { type: "number", value: -5 };
    grant.unlimited = false;

    const fetchMock = router({ "POST /graphql": () => payload });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const snapshot = await client.getLicensingSnapshot("cust-1", "inst-1");
    expect(snapshot.entitlements[1]).toMatchObject({ slug: "api-calls", unlimited: false });
  });

  test("GraphQL snapshot: explicit instance outside the customer's list rejects", async () => {
    const fetchMock = router({
      "POST /graphql": () => gqlSnapshotPayload(),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    // Must throw the domain error — not silently fall back to REST.
    await expect(client.getLicensingSnapshot("cust-1", "inst-other")).rejects.toThrow(
      /not found for customer/,
    );
  });

  test("falls back to the REST fan-out when GraphQL responds with errors", async () => {
    const fetchMock = router({
      "POST /graphql": () => ({
        errors: [{ message: 'Cannot query field "entitlementUsage" on type "Instance"' }],
      }),
      "GET /customers/cust-1": () => ({ id: "cust-1", slug: "cust-1", name: "Acme" }),
      "GET /instances/inst-1": () => ({
        id: "inst-1",
        slug: "inst-1",
        name: "Prod",
        customerSlug: "cust-1",
        licenseSlug: "pro",
      }),
      "GET /licenses": () => [
        {
          id: "lic-1",
          slug: "pro",
          name: "Pro",
          lifecycleState: "PUBLISHED",
          familyId: "fam-1",
          isDefault: true,
        },
      ],
      "GET /licenses/pro/entitlements": () => [
        {
          licenseSlug: "pro",
          entitlementSlug: "seats",
          entitlementName: "Seats",
          entitlementType: "NUMBER",
          value: { type: "number", value: 10 },
        },
      ],
      "GET /instances/inst-1/entitlements/usage": () => [
        { entitlementSlug: "seats", value: { type: "number", value: 4 } },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    const snapshot = await client.getLicensingSnapshot("cust-1", "inst-1");
    expect(snapshot.customer).toMatchObject({ slug: "cust-1" });
    expect(snapshot.entitlements[0]).toMatchObject({ slug: "seats", remaining: 6 });
    // The REST fan-out actually ran.
    expect(findRequest(fetchMock, "/customers/cust-1")).toBeDefined();
  });

  test("falls back to REST when the customer is absent from GraphQL, keeping the canonical 404", async () => {
    const payload = gqlSnapshotPayload();
    const fetchMock = router({
      "POST /graphql": () => ({ data: { licenses: payload.data.licenses, customer: null } }),
      // No REST customer route: the fallback's GET /customers/missing 404s.
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(fetchMock);

    await expect(client.getLicensingSnapshot("missing")).rejects.toThrow();
    expect(findRequest(fetchMock, "/customers/missing")).toBeDefined();
  });
});

describe("feature-flag evaluation guards", () => {
  test("narrow success vs failure by the OpenFeature errorCode and expose .value", () => {
    const results: EvaluationResult[] = [
      { key: "beta", value: true, variant: "on", reason: "TARGETING_MATCH" },
      { key: "missing", errorCode: "FLAG_NOT_FOUND", errorDetails: "no such flag" },
    ];

    const successes = results.filter(isEvaluationSuccess);
    const failures = results.filter(isEvaluationFailure);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    // After the guard, `.value` is accessible without a cast (TS narrowing).
    expect(successes[0]!.value).toBe(true);
    expect(failures[0]!.errorCode).toBe("FLAG_NOT_FOUND");
  });
});

// Guards an invariant, not a fix. An audit flagged `licensesBySlug` as losing
// one version of a license to another, since a license row IS a version and the
// map is keyed by slug. It cannot: kaiten constrains
// UNIQUE (organization_id, slug) and derives each slug with a random suffix
// (slugutil.GenerateUnique, retried on conflict), so two versions never share
// one. `instance.license_slug` is not stored either — every query projects
// `l.slug AS license_slug` by joining on `license_id` — so the slug on an
// instance is always the current slug of exactly the row it points at, and
// joining by slug is equivalent to joining by id.
//
// This test pins that, so a future "fix" that swaps the key has to explain
// itself, and so a backend change that made slugs non-unique fails here.
test("two versions of one license keep their own entitlements, and the instance gets its own", async () => {
  const version = (slug: string, version: string, seats: number) => ({
    id: `lic-${slug}`,
    name: "Pro",
    slug,
    description: "Pro plan",
    type: "PAID",
    version,
    versionName: null,
    isDefault: false,
    lifecycleState: "PUBLISHED",
    family: { id: "fam-pro" },
    entitlements: [
      {
        entitlementSlug: "seats",
        entitlementName: "Seats",
        entitlementType: "NUMBER",
        licenseSlug: slug,
        value: { type: "number", value: seats },
        unlimited: false,
        entitlement: {
          id: "ent-seats",
          name: "Seats",
          slug: "seats",
          description: null,
          type: "NUMBER",
          icon: null,
          unitSingular: null,
          unitPlural: null,
          saleUnitSingular: null,
          saleUnitPlural: null,
          saleUnitFactor: null,
          userFacing: true,
          displayOrder: 1,
          entitlementGroups: [],
        },
      },
    ],
  });

  const fetchMock = router({
    "POST /graphql": () => ({
      data: {
        licenses: {
          items: [version("pro", "1", 10), version("pro-a1b2", "2", 50)],
          hasMore: false,
        },
        customer: {
          id: "cust-1",
          slug: "cust-1",
          name: "Acme",
          externalCustomerId: null,
          createdBy: { id: "u", name: "u" },
          createdAt: "2026-01-01T00:00:00Z",
          updatedBy: { id: "u", name: "u" },
          updatedAt: "2026-01-01T00:00:00Z",
          instances: [
            {
              id: "inst-1",
              slug: "inst-1",
              name: "Prod",
              description: "",
              customerId: "cust-1",
              customerSlug: "cust-1",
              licenseId: "lic-pro-a1b2",
              // The instance is on VERSION 2.
              licenseSlug: "pro-a1b2",
              deploymentZoneId: null,
              startLicenseDate: "2026-01-01T00:00:00Z",
              endLicenseDate: "2027-01-01T00:00:00Z",
              metadata: {},
              createdBy: { id: "u", name: "u" },
              createdAt: "2026-01-01T00:00:00Z",
              updatedBy: { id: "u", name: "u" },
              updatedAt: "2026-01-01T00:00:00Z",
              entitlementUsage: [],
            },
          ],
        },
      },
    }),
    "POST /ofrep/v1/evaluate/flags": () => ({ flags: [] }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = makeClient(fetchMock);

  const snapshot = await client.getLicensingSnapshot("cust-1", "inst-1");

  // Version 2's grant, not version 1's — the two did not collapse.
  expect(snapshot.license?.slug).toBe("pro-a1b2");
  expect(snapshot.entitlements[0]).toMatchObject({
    slug: "seats",
    limitValue: { type: "number", value: 50 },
  });
  // Both versions still stand as their own plans.
  expect(snapshot.plans.map((plan) => plan.slug).sort()).toEqual(["pro", "pro-a1b2"]);
});
