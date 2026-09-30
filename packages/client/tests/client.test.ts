import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient } from "../src/client/client.ts";
import { assertGraphqlResponseConforms } from "./support/graphql-conformance.ts";
import { KaitenError, KaitenNetworkError } from "../src/core/index.ts";
import { resolveUsageScope } from "../src/domain/entitlement-usage.ts";

type FetchMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A GraphQL double's success payload, checked against the committed schema
 * before it is served.
 *
 * Use this rather than `json` for any `data`-bearing GraphQL response. The three
 * field errors that killed the primary read path survived every test because the
 * doubles invented exactly the fields the documents wrongly asked for — see
 * tests/support/graphql-conformance.ts.
 */
function graphqlJson(body: { data: unknown }, status = 200): Response {
  assertGraphqlResponseConforms(body.data);
  return json(body, status);
}

function getFetchRequest(fetchMock: FetchMock, index = 0): Request {
  const input = fetchMock.mock.calls[index]?.[0];
  expect(input).toBeInstanceOf(Request);
  return input as Request;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KaitenClient transport", () => {
  test("sends bearer auth header", async () => {
    const fetchMock = vi.fn(async () => json({ id: "cust-1", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "bearer",
      tokenProvider: () => "secret-token",
      fetch: fetchMock,
    });

    await client.getCustomer("acme");

    const request = getFetchRequest(fetchMock);
    expect(request.headers.get("Authorization")).toBe("Bearer secret-token");
  });

  test("sends publishable key header", async () => {
    const fetchMock = vi.fn(async () => json({ id: "cust-1", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "publishable",
      tokenProvider: () => "pk_test",
      fetch: fetchMock,
    });

    await client.getCustomer("acme");

    const request = getFetchRequest(fetchMock);
    expect(request.headers.get("X-Kaiten-Publishable-Key")).toBe("pk_test");
  });

  test("maps HTTP errors to KaitenError", async () => {
    const fetchMock = vi.fn(async () =>
      json({ title: "Not found", status: 404, detail: "missing" }, 404),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(client.getCustomer("missing")).rejects.toBeInstanceOf(KaitenError);
    await expect(client.getCustomer("missing")).rejects.toMatchObject({
      status: 404,
      message: "Not found",
    });
  });

  test("wraps network failures in KaitenNetworkError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(client.getCustomer("acme")).rejects.toBeInstanceOf(KaitenNetworkError);
  });

  test("retries transient 5xx responses", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return json({ title: "Server error", status: 500 }, 500);
      }
      return json({ id: "cust-1", slug: "acme", name: "Acme" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      fetch: fetchMock,
    });

    const customer = await client.getCustomer("acme");
    expect(customer.slug).toBe("acme");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("composes the catalog from licenses and their entitlements", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (url.includes("/licenses/pro/entitlements")) {
        return json([
          {
            licenseSlug: "pro",
            entitlementSlug: "seats",
            entitlementName: "Seats",
            entitlementType: "NUMBER",
            value: { type: "number", value: 10 },
          },
        ]);
      }
      if (url.endsWith("/licenses")) {
        return json([
          {
            id: "lic-1",
            slug: "pro",
            name: "Pro",
            description: "Pro plan",
            type: "PAID",
            version: "1",
            lifecycleState: "PUBLISHED",
            familyId: "fam-1",
            isDefault: true,
          },
        ]);
      }
      return json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      fetch: fetchMock,
    });

    const catalog = await client.getCatalog();
    expect(catalog.plans).toHaveLength(1);
    expect(catalog.plans[0]).toMatchObject({
      slug: "pro",
      name: "Pro",
      published: true,
      lifecycleState: "PUBLISHED",
      familyId: "fam-1",
      highlighted: true,
    });
    expect(catalog.plans[0]?.entitlements?.[0]).toMatchObject({
      slug: "seats",
      name: "Seats",
      type: "NUMBER",
    });
    expect(catalog.branding).toEqual({ removable: false });
  });

  // The presentation metadata only exists on the GraphQL read path, and it
  // crosses TWO mapping steps to reach a public type: the GraphQL license →
  // catalog mapping, then the normalizer. Both dropped the sale unit, so a test
  // that stops at either one proves nothing. This drives the real `getCatalog()`
  // over a GraphQL response and asserts on the plan it returns.
  test("carries entitlement sale units from the GraphQL catalog to the public plan", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        data: {
          licenses: {
            items: [
              {
                id: "lic-1",
                slug: "pro",
                name: "Pro",
                description: "Pro plan",
                type: "PAID",
                version: "1",
                versionName: null,
                isDefault: true,
                lifecycleState: "PUBLISHED",
                family: { id: "fam-1" },
                entitlements: [
                  {
                    entitlementSlug: "tokens",
                    entitlementName: "Tokens",
                    entitlementType: "NUMBER",
                    licenseID: "lic-1",
                    licenseSlug: "pro",
                    value: { type: "number", value: 40_000_000 },
                    unlimited: false,
                    entitlement: {
                      id: "ent-1",
                      name: "Tokens",
                      slug: "tokens",
                      description: null,
                      type: "NUMBER",
                      icon: null,
                      unitSingular: "token",
                      unitPlural: "tokens",
                      saleUnitSingular: "1M tokens",
                      saleUnitPlural: "1M tokens",
                      saleUnitFactor: 1_000_000,
                      userFacing: true,
                      displayOrder: 1,
                      entitlementGroups: [],
                    },
                  },
                ],
              },
            ],
            hasMore: false,
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      fetch: fetchMock,
    });

    const catalog = await client.getCatalog();
    const entitlement = catalog.plans[0]?.entitlements?.[0];

    expect(entitlement).toMatchObject({
      slug: "tokens",
      unitSingular: "token",
      saleUnitSingular: "1M tokens",
      saleUnitPlural: "1M tokens",
      saleUnitFactor: 1_000_000,
    });

    // One GraphQL round-trip, no REST fallback — otherwise the assertion above
    // would be passing on a path that never carries the definition.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getFetchRequest(fetchMock).url).toContain("/graphql");
  });

  // The catalog lists every version, whatever its state: a pricing page decides
  // what to offer from `published`, and an instance on an archived version keeps
  // its entitlements. The state has to cross both mapping steps to reach a plan.
  test("carries each license's lifecycle state and family from the GraphQL catalog", async () => {
    const version = (number: string, lifecycleState: string) => ({
      id: `lic-${number}`,
      slug: `pro-v${number}`,
      name: "Pro",
      description: "Pro plan",
      type: "PAID",
      version: number,
      versionName: null,
      isDefault: false,
      lifecycleState,
      family: { id: "fam-pro" },
      entitlements: [],
    });
    const fetchMock = vi.fn(async () =>
      json({
        data: {
          licenses: {
            items: [version("1", "ARCHIVED"), version("2", "PUBLISHED"), version("3", "DRAFT")],
            hasMore: false,
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      fetch: fetchMock,
    });

    const { plans } = await client.getCatalog();
    const bySlug = new Map(plans.map((plan) => [plan.slug, plan]));

    expect(bySlug.get("pro-v1")).toMatchObject({ published: false, lifecycleState: "ARCHIVED" });
    expect(bySlug.get("pro-v2")).toMatchObject({ published: true, lifecycleState: "PUBLISHED" });
    expect(bySlug.get("pro-v3")).toMatchObject({ published: false, lifecycleState: "DRAFT" });
    expect(new Set(plans.map((plan) => plan.familyId))).toEqual(new Set(["fam-pro"]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // There is no default scheme: publishable keys are not served yet, and a
  // default that sent a header no endpoint reads failed every call silently.
  test("requires an authScheme", () => {
    const withoutScheme = { apiUrl: "https://api.test" } as unknown as ConstructorParameters<
      typeof KaitenClient
    >[0];
    expect(() => new KaitenClient(withoutScheme)).toThrow(TypeError);
  });

  test("supports relative apiUrl paths in non-browser runtimes", async () => {
    const fetchMock = vi.fn(async () => json({ id: "cust-1", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      authScheme: "publishable",
      apiUrl: "/api",
      fetch: fetchMock,
    });

    const customer = await client.getCustomer("acme");
    expect(customer.slug).toBe("acme");

    const request = getFetchRequest(fetchMock);
    expect(request.url).toBe("http://localhost/api/customers/acme");
  });

  test("evaluates a feature flag via OFREP", async () => {
    const fetchMock = vi.fn(async () =>
      json({ key: "flag-a", value: true, variant: "on", reason: "DEFAULT" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      fetch: fetchMock,
    });

    const result = await client.evaluateFlag("flag-a", { plan: "pro" });
    expect(result).toMatchObject({ key: "flag-a", value: true });

    const request = getFetchRequest(fetchMock);
    expect(request.url).toContain("/ofrep/v1/evaluate/flags/flag-a");
    expect(request.method).toBe("POST");
    expect(await request.text()).toBe(JSON.stringify({ context: { plan: "pro" } }));
  });
});

// ---------------------------------------------------------------------------
// Snapshot identity: which customer, and which instance
// ---------------------------------------------------------------------------

const CUSTOMER_ID = "11111111-2222-3333-4444-555555555555";

function instanceRow(slug: string, over: Record<string, unknown> = {}) {
  return {
    id: `inst-${slug}`,
    slug,
    name: slug,
    description: "",
    customerId: CUSTOMER_ID,
    customerSlug: "acme",
    licenseId: "lic-1",
    licenseSlug: "pro",
    deploymentZoneId: null,
    startLicenseDate: "2026-01-01T00:00:00Z",
    endLicenseDate: "2027-01-01T00:00:00Z",
    metadata: {},
    createdBy: { id: "u1", name: "u" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedBy: { id: "u1", name: "u" },
    updatedAt: "2026-01-01T00:00:00Z",
    entitlementUsage: [],
    ...over,
  };
}

const licenseRow = {
  id: "lic-1",
  slug: "pro",
  name: "Pro",
  description: "Pro plan",
  type: "PAID",
  version: "1",
  versionName: null,
  isDefault: true,
  lifecycleState: "PUBLISHED",
  family: { id: "fam-1" },
  entitlements: [],
};

/**
 * A fake API serving BOTH read paths from one set of instances. `graphqlOrder`
 * and `restOrder` exist so a test can hand the two paths the same instances in
 * different orders — which is exactly what a real deployment does, the two
 * listings having no reason to agree.
 */
function installSnapshotApi(options: {
  graphqlOrder: ReturnType<typeof instanceRow>[];
  restOrder?: ReturnType<typeof instanceRow>[];
  graphqlAvailable?: boolean;
  customerSlugLookupFails?: boolean;
  customers?: unknown[] | null;
}): FetchMock {
  const rest = options.restOrder ?? options.graphqlOrder;

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input)).pathname;

    if (url.includes("/graphql")) {
      if (options.graphqlAvailable === false) {
        return json({ errors: [{ message: "unknown field" }] });
      }
      return graphqlJson({
        data: {
          licenses: { items: [licenseRow], hasMore: false },
          customer: {
            id: CUSTOMER_ID,
            slug: "acme",
            name: "Acme",
            externalCustomerId: null,
            createdBy: { id: "u1", name: "u" },
            createdAt: "2026-01-01T00:00:00Z",
            updatedBy: { id: "u1", name: "u" },
            updatedAt: "2026-01-01T00:00:00Z",
            instances: options.graphqlOrder,
          },
        },
      });
    }
    if (url.includes("/ofrep/")) return json({ flags: [] });
    if (url.includes("/entitlements/usage")) return json([]);
    if (url.includes("/licenses/pro/entitlements")) return json([]);
    if (url.endsWith("/licenses")) return json([licenseRow]);
    if (url.endsWith("/instances")) return json(rest);
    if (url.endsWith("/customers")) {
      if (options.customers === null) return json({ title: "Forbidden", status: 403 }, 403);
      return json(options.customers ?? [{ id: CUSTOMER_ID, slug: "acme", name: "Acme" }]);
    }
    if (url.includes("/customers/")) {
      if (options.customerSlugLookupFails) {
        return json({ title: "Not found", status: 404 }, 404);
      }
      return json({ id: CUSTOMER_ID, slug: "acme", name: "Acme" });
    }
    return json([]);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as FetchMock;
}

describe("snapshot instance selection", () => {
  // The defect with teeth. Both paths defaulted to "the first instance", but of
  // DIFFERENT lists — GraphQL of the customer's own, REST of the global listing
  // filtered by owner. A fallback could therefore hand back another instance,
  // and with it another license and other quotas. Same inputs in different
  // orders must now produce the same answer.
  test("both read paths pick the same instance when none is named", async () => {
    const alpha = instanceRow("alpha");
    const beta = instanceRow("beta");

    installSnapshotApi({ graphqlOrder: [beta, alpha] });
    const viaGraphql = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot("acme");

    vi.unstubAllGlobals();

    installSnapshotApi({
      graphqlOrder: [beta, alpha],
      restOrder: [alpha, beta],
      graphqlAvailable: false,
    });
    const viaRest = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot("acme");

    expect(viaGraphql.instance?.slug).toBe("alpha");
    expect(viaRest.instance?.slug).toBe(viaGraphql.instance?.slug);
  });

  // There is deliberately no "a soft-deleted instance is never picked" test any
  // more. It used to pass by feeding the GraphQL double an `Instance.deletedAt`
  // that no backend can send: kaiten has no `deleted_at` column on
  // `instance` and `DeleteInstance` is a hard, cascading delete, so a row that
  // comes back is live by construction. The double invented the field, the SDK
  // filtered on it, and the test graded the pair against each other — while the
  // real schema had never heard of it. `graphql-conformance.test.ts` is what now
  // stops a double from serving fields the schema does not declare.

  test("an explicitly named instance is still honoured over the implicit pick", async () => {
    installSnapshotApi({ graphqlOrder: [instanceRow("alpha"), instanceRow("beta")] });

    const snapshot = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot("acme", "beta");

    expect(snapshot.instance?.slug).toBe("beta");
  });

  test("warns in development when it picks among several instances", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installSnapshotApi({ graphqlOrder: [instanceRow("alpha"), instanceRow("beta")] });

    await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot("warn-many");

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("alpha");
    expect(warn.mock.calls[0]?.[0]).toContain("beta");
    warn.mockRestore();
  });

  // The single-instance customer is the ordinary case and the SDK is not really
  // choosing anything. Warning there would train adopters to ignore the warning.
  test("stays silent when the customer has exactly one instance", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installSnapshotApi({ graphqlOrder: [instanceRow("only")] });

    await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot("warn-one");

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("onDegraded", () => {
  // The fallback works, so nothing looks wrong — while every license costs its
  // own request and the presentation metadata silently disappears. Whether that
  // is a permanent schema mismatch or a passing outage was unknowable, because
  // the error went into a bare `catch`.
  test("fires with the error that closed the GraphQL path", async () => {
    const onDegraded = vi.fn();
    installSnapshotApi({ graphqlOrder: [instanceRow("alpha")], graphqlAvailable: false });

    await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      onDegraded,
    }).getLicensingSnapshot("acme");

    expect(onDegraded).toHaveBeenCalledOnce();
    expect(onDegraded.mock.calls[0]?.[0]).toMatchObject({ operation: "getLicensingSnapshot" });
    expect(String(onDegraded.mock.calls[0]?.[0]?.error)).toContain("unknown field");
  });

  test("fires for the public catalog read too", async () => {
    const onDegraded = vi.fn();
    installSnapshotApi({ graphqlOrder: [], graphqlAvailable: false });

    await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      onDegraded,
    }).getCatalog();

    expect(onDegraded).toHaveBeenCalledOnce();
    expect(onDegraded.mock.calls[0]?.[0]).toMatchObject({ operation: "getCatalog" });
  });

  test("stays quiet when GraphQL answers", async () => {
    const onDegraded = vi.fn();
    installSnapshotApi({ graphqlOrder: [instanceRow("alpha")] });

    await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      onDegraded,
    }).getLicensingSnapshot("acme");

    expect(onDegraded).not.toHaveBeenCalled();
  });

  // An unknown customer routes to REST on purpose, so the not-found keeps its
  // canonical 404 shape — with GraphQL working perfectly. Reporting that as a
  // degradation would fire on every lookup of a customer that isn't there, and
  // an alert that cries wolf is worse than no alert.
  test("does not fire when GraphQL simply has no such customer", async () => {
    const onDegraded = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (url.includes("/graphql"))
        return graphqlJson({ data: { licenses: { items: [], hasMore: false }, customer: null } });
      if (url.includes("/ofrep/")) return json({ flags: [] });
      if (url.includes("/customers/")) return json({ title: "Not found", status: 404 }, 404);
      return json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new KaitenClient({
        authScheme: "publishable",
        apiUrl: "https://api.test",
        onDegraded,
      }).getLicensingSnapshot("ghost"),
    ).rejects.toBeInstanceOf(KaitenError);

    expect(onDegraded).not.toHaveBeenCalled();
  });

  // One event, one report. The REST snapshot builds a catalog too, and letting
  // it retry the GraphQL it just watched fail would both double-report and pay
  // for a doomed round-trip.
  test("reports once per degraded read, not once per composed leg", async () => {
    const onDegraded = vi.fn();
    const fetchMock = installSnapshotApi({
      graphqlOrder: [instanceRow("alpha")],
      graphqlAvailable: false,
    });

    await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      onDegraded,
    }).getLicensingSnapshot("acme");

    expect(onDegraded).toHaveBeenCalledOnce();
    const graphqlCalls = fetchMock.mock.calls.filter(([input]) =>
      (input instanceof Request ? input.url : String(input)).includes("/graphql"),
    );
    expect(graphqlCalls).toHaveLength(1);
  });

  // Degrading is already the unhappy path; a host's logging mistake must not
  // turn it into a failed read.
  test("a throwing callback cannot break the read it reports on", async () => {
    installSnapshotApi({ graphqlOrder: [instanceRow("alpha")], graphqlAvailable: false });

    const snapshot = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      onDegraded: () => {
        throw new Error("host logger exploded");
      },
    }).getLicensingSnapshot("acme");

    expect(snapshot.instance?.slug).toBe("alpha");
  });
});

describe("snapshot customer identity", () => {
  // GraphQL takes a slug or a UUID; `GET /customers/{customerSlug}` takes a
  // slug. A host identifying customers by id therefore worked until the first
  // fallback and then 404'd — an intermittent failure that reads as an outage.
  test("the REST path resolves a customer passed by id", async () => {
    installSnapshotApi({
      graphqlOrder: [instanceRow("alpha")],
      graphqlAvailable: false,
      customerSlugLookupFails: true,
    });

    const snapshot = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot(CUSTOMER_ID);

    expect(snapshot.customer?.id).toBe(CUSTOMER_ID);
    expect(snapshot.customer?.slug).toBe("acme");
  });

  // A UUID that matches no customer, and a listing that cannot be read, must
  // both surface the original not-found — not a permissions error from the
  // lookup, and not a silent null customer.
  test("an unresolvable id keeps the original not-found error", async () => {
    installSnapshotApi({
      graphqlOrder: [instanceRow("alpha")],
      graphqlAvailable: false,
      customerSlugLookupFails: true,
      customers: [],
    });

    await expect(
      new KaitenClient({
        authScheme: "publishable",
        apiUrl: "https://api.test",
      }).getLicensingSnapshot(CUSTOMER_ID),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("a forbidden customer listing does not mask the not-found", async () => {
    installSnapshotApi({
      graphqlOrder: [instanceRow("alpha")],
      graphqlAvailable: false,
      customerSlugLookupFails: true,
      customers: null,
    });

    await expect(
      new KaitenClient({
        authScheme: "publishable",
        apiUrl: "https://api.test",
      }).getLicensingSnapshot(CUSTOMER_ID),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("cursor pagination", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("follows nextCursor to the end of a paginated list", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(input instanceof Request ? input.url : String(input));
      seen.push(parsed.pathname);
      if (!parsed.pathname.includes("/instances")) return json([]);

      // Page 2 is requested with the cursor page 1 handed back.
      if (parsed.searchParams.get("cursor") === "page2") {
        return json({ items: [instanceRow("beta")], hasMore: false });
      }
      // The maximum page size the API accepts, asked for on every page.
      expect(parsed.searchParams.get("limit")).toBe("200");
      return json({ items: [instanceRow("alpha")], hasMore: true, nextCursor: "page2" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const instances = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).listInstances();

    // The regression this guards: reading only page one. `resolveSnapshotInstance`
    // filters a GLOBAL instance listing down to one customer, so an instance
    // sitting past the first page resolved a snapshot with no instance at all —
    // and a snapshot without an instance opens every gate.
    expect(instances?.map((instance) => instance.slug)).toEqual(["alpha", "beta"]);
    expect(seen.filter((url) => url.includes("/instances")).length).toBe(2);
  });

  // The GraphQL aggregate reads `licenses` from the same cursor-paginated field
  // the REST path walks, and until now it read page one and stopped: `hasMore`
  // was selected only to report the truncation as a degradation. A host past 200
  // licenses got a pricing table missing plans and a `licensesBySlug` that could
  // not resolve the license an instance points at — which reads as "no
  // entitlements", not as a short read.
  test("follows the licenses cursor on the GraphQL catalog path", async () => {
    const cursors: Array<string | null> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(String(input));
      if (!new URL(request.url).pathname.endsWith("/graphql")) return json([]);

      const body = (await request.json()) as { variables?: { cursor?: string } };
      const cursor = body.variables?.cursor ?? null;
      cursors.push(cursor);

      if (cursor === "page2") {
        return graphqlJson({
          data: { licenses: { items: [{ ...licenseRow, slug: "team" }], hasMore: false } },
        });
      }
      return graphqlJson({
        data: { licenses: { items: [licenseRow], hasMore: true, nextCursor: "page2" } },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getCatalog();

    expect(catalog.plans.map((plan) => plan.slug)).toEqual(["pro", "team"]);
    // Page one asks for no cursor; page two asks with the one page one handed back.
    expect(cursors).toEqual([null, "page2"]);
  });

  // The snapshot document carries the customer and its instances alongside page
  // one, so the extra pages come back through the catalog document instead —
  // re-asking for the customer on every page would multiply the round trip the
  // aggregate exists to collapse.
  test("pages a snapshot's licenses without re-reading the customer", async () => {
    let customerReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(String(input));
      const path = new URL(request.url).pathname;
      if (path.includes("/ofrep/")) return json({ flags: [] });
      if (!path.endsWith("/graphql")) return json([]);

      const body = (await request.json()) as {
        query: string;
        variables?: { cursor?: string };
      };
      if (body.variables?.cursor === "page2") {
        return graphqlJson({
          data: { licenses: { items: [{ ...licenseRow, slug: "team" }], hasMore: false } },
        });
      }

      customerReads += 1;
      return graphqlJson({
        data: {
          licenses: { items: [licenseRow], hasMore: true, nextCursor: "page2" },
          customer: {
            id: CUSTOMER_ID,
            slug: "acme",
            name: "Acme",
            externalCustomerId: null,
            createdBy: { id: "u1", name: "u" },
            createdAt: "2026-01-01T00:00:00Z",
            updatedBy: { id: "u1", name: "u" },
            updatedAt: "2026-01-01T00:00:00Z",
            instances: [],
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot(CUSTOMER_ID);

    expect(snapshot.plans?.map((plan) => plan.slug)).toEqual(["pro", "team"]);
    expect(customerReads).toBe(1);
  });

  // A cursor that does not advance cannot be followed to the end, and the page
  // it did read must not pass for the whole catalog. Throwing out of the GraphQL
  // path is what hands the read to the REST fan-out, which walks the same
  // pagination properly — so the host ends up with a COMPLETE catalog and a
  // degradation report, rather than a short one and silence.
  test("refuses a catalog cut short by a stalled cursor, and degrades to REST", async () => {
    const degraded: Array<{ operation: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(String(input));
      const path = new URL(request.url).pathname;
      if (path.endsWith("/graphql")) {
        return graphqlJson({
          data: { licenses: { items: [licenseRow], hasMore: true, nextCursor: "stuck" } },
        });
      }
      if (path.endsWith("/licenses")) {
        return json({ items: [licenseRow, { ...licenseRow, slug: "team" }], hasMore: false });
      }
      return json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
      onDegraded: (info) => degraded.push(info),
    }).getCatalog();

    expect(catalog.plans.map((plan) => plan.slug)).toEqual(["pro", "team"]);
    expect(degraded.map((info) => info.operation)).toContain("getCatalog");
  });

  test("throws instead of returning a truncated list when the page stop is reached", async () => {
    let pages = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(input instanceof Request ? input.url : String(input));
      if (!parsed.pathname.includes("/instances")) return json([]);
      pages += 1;
      // Always more to read: the list never ends.
      return json({ items: [instanceRow(`i${pages}`)], hasMore: true, nextCursor: `page${pages}` });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Returning the rows collected so far would be indistinguishable from a
    // complete list, and `resolveSnapshotInstance` filters this listing to find
    // the customer's instance — a missing one opens every gate.
    await expect(
      new KaitenClient({ authScheme: "publishable", apiUrl: "https://api.test" }).listInstances(),
    ).rejects.toThrow(/stopped after 100 pages/);
    expect(pages).toBe(100);
  });

  test("throws when the API hands back a cursor that does not advance", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(input instanceof Request ? input.url : String(input));
      if (!parsed.pathname.includes("/instances")) return json([]);
      return json({ items: [instanceRow("alpha")], hasMore: true, nextCursor: "stuck" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new KaitenClient({ authScheme: "publishable", apiUrl: "https://api.test" }).listInstances(),
    ).rejects.toThrow(/same cursor twice/);
    // Caught on the second page, not after a hundred round-trips.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("accepts a bare array from an API that predates pagination", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (!url.includes("/instances")) return json([]);
      return json([instanceRow("alpha")]);
    });
    vi.stubGlobal("fetch", fetchMock);

    // The REST fan-out exists for deployments without the GraphQL aggregate, and
    // those predate the envelope. Requiring it would drop the compatibility the
    // fallback is there to provide.
    const instances = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).listInstances();

    expect(instances?.map((instance) => instance.slug)).toEqual(["alpha"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("secret credentials never leave a browser", () => {
  // The check lives in the transport and is keyed on the runtime, not on the auth
  // scheme: a guard on `authScheme === "publishable"` alone covers the one mode
  // the backend does not serve, and lets an org-scoped `ksh_` passed as a bearer
  // token go into a bundle without a word.
  const browser = () => {
    vi.stubGlobal("window", { document: {} });
  };

  test.for([["ksh_live_abc"], ["sk_live_abc"], ["ksm_live_abc"]] as const)(
    "%s is refused in a browser, whatever the scheme",
    async ([token]) => {
      browser();
      const fetchMock = vi.fn(async () => json({ ok: true }));
      vi.stubGlobal("fetch", fetchMock);

      const client = new KaitenClient({
        apiUrl: "https://api.test",
        authScheme: "bearer",
        tokenProvider: () => token,
        fetch: fetchMock,
      });

      const error = await client.getCustomer("acme").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(KaitenError);
      expect((error as KaitenError).message).toMatch(/secret credential used in a browser/i);
      expect((error as KaitenError).detail).toMatch(new RegExp(token.slice(0, 3), "i"));
      // Refused before the request, not after: nothing was sent, and it is not
      // classified as a network failure, so the transport does not replay it.
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("a publishable key is untouched in a browser", async () => {
    browser();
    const fetchMock = vi.fn(async () => json({ id: "cust-1", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "publishable",
      tokenProvider: () => "pk_live_abc",
      fetch: fetchMock,
    });

    await expect(client.getCustomer("acme")).resolves.toMatchObject({ slug: "acme" });
  });

  test("a secret key is fine on a server, which is where it belongs", async () => {
    // No `window` stubbed: this is the Node path a backend actually runs.
    const fetchMock = vi.fn(async () => json({ id: "cust-1", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "bearer",
      tokenProvider: () => "ksh_live_abc",
      fetch: fetchMock,
    });

    await expect(client.getCustomer("acme")).resolves.toMatchObject({ slug: "acme" });
    expect(getFetchRequest(fetchMock).headers.get("Authorization")).toBe("Bearer ksh_live_abc");
  });

  test("an async token provider is covered too", async () => {
    browser();
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "bearer",
      tokenProvider: async () => "ksh_live_abc",
      fetch: fetchMock,
    });

    await expect(client.getCustomer("acme")).rejects.toThrow(/secret credential/i);
  });
});

// ---------------------------------------------------------------------------
// Usage windows
// ---------------------------------------------------------------------------

describe("the usage window travels only where it was actually read", () => {
  const entitlementRow = {
    entitlementSlug: "tokens",
    entitlementName: "Tokens",
    entitlementType: "NUMBER",
    licenseSlug: "pro",
    value: { type: "number", value: 100 },
  };

  // The GraphQL grant carries the presentation object the REST row does not.
  const gqlEntitlementRow = {
    ...entitlementRow,
    unlimited: false,
    entitlement: {
      id: "ent-1",
      name: "Tokens",
      slug: "tokens",
      description: null,
      type: "NUMBER",
      icon: null,
      unitSingular: "token",
      unitPlural: "tokens",
      saleUnitSingular: null,
      saleUnitPlural: null,
      saleUnitFactor: null,
      userFacing: true,
      displayOrder: 1,
      entitlementGroups: [],
    },
  };

  const usageRow = {
    entitlementId: "ent-1",
    entitlementSlug: "tokens",
    licenseId: "lic-1",
    licenseSlug: "pro",
    value: { type: "number", value: 40 },
    limit: { type: "number", value: 100 },
    currentPeriodStart: "2026-03-01T00:00:00Z",
    currentPeriodEnd: "2026-04-01T00:00:00Z",
  };

  // A lifetime entitlement: the API omits BOTH bounds exactly when no reset
  // period is configured, which is the signal the SDK reads as "lifetime".
  const lifetimeUsageRow = {
    entitlementId: usageRow.entitlementId,
    entitlementSlug: usageRow.entitlementSlug,
    licenseId: usageRow.licenseId,
    licenseSlug: usageRow.licenseSlug,
    value: usageRow.value,
    limit: usageRow.limit,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  };

  function installUsageApi(options: { graphqlAvailable: boolean; periodic?: boolean }): FetchMock {
    const row = options.periodic === false ? lifetimeUsageRow : usageRow;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input)).pathname;

      if (url.includes("/graphql")) {
        if (!options.graphqlAvailable) return json({ errors: [{ message: "unknown field" }] });
        return graphqlJson({
          data: {
            licenses: {
              items: [{ ...licenseRow, entitlements: [gqlEntitlementRow] }],
              hasMore: false,
            },
            customer: {
              id: CUSTOMER_ID,
              slug: "acme",
              name: "Acme",
              externalCustomerId: null,
              createdBy: { id: "u1", name: "u" },
              createdAt: "2026-01-01T00:00:00Z",
              updatedBy: { id: "u1", name: "u" },
              updatedAt: "2026-01-01T00:00:00Z",
              instances: [instanceRow("alpha", { entitlementUsage: [{ ...row }] })],
            },
          },
        });
      }
      if (url.includes("/ofrep/")) return json({ flags: [] });
      if (url.includes("/entitlements/usage")) return json([row]);
      if (url.includes("/licenses/pro/entitlements")) return json([entitlementRow]);
      if (url.endsWith("/licenses")) return json([licenseRow]);
      if (url.endsWith("/instances")) return json([instanceRow("alpha")]);
      if (url.endsWith("/customers"))
        return json([{ id: CUSTOMER_ID, slug: "acme", name: "Acme" }]);
      if (url.includes("/customers/")) return json({ id: CUSTOMER_ID, slug: "acme", name: "Acme" });
      return json([]);
    });

    vi.stubGlobal("fetch", fetchMock);
    return fetchMock as FetchMock;
  }

  test("the REST path delivers the window", async () => {
    installUsageApi({ graphqlAvailable: false });

    const snapshot = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot("acme");
    const tokens = snapshot.entitlements.find((entitlement) => entitlement.slug === "tokens");

    expect(tokens?.currentPeriodStart).toBe("2026-03-01T00:00:00Z");
    expect(tokens?.currentPeriodEnd).toBe("2026-04-01T00:00:00Z");
    expect(resolveUsageScope(tokens ?? {})).toBe("PERIODIC");
  });

  // The one that has to hold. The GraphQL path is the PRIMARY read path, so it is
  // the one that decides what a meter says for almost every reader. It used to
  // answer UNKNOWN — deliberately, because its document did not select the
  // bounds and an unmarked silence would have printed "Lifetime" over a monthly
  // quota. Now that the document selects them, UNKNOWN would be its own kind of
  // lie: the window was read, so it must be reported. Both paths must agree, and
  // the REST expectation above is the same three assertions.
  test("the GraphQL path delivers the window, same as REST", async () => {
    installUsageApi({ graphqlAvailable: true });

    const snapshot = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot("acme");
    const tokens = snapshot.entitlements.find((entitlement) => entitlement.slug === "tokens");

    expect(tokens?.usageWindowUnknown).toBeUndefined();
    expect(tokens?.currentPeriodStart).toBe("2026-03-01T00:00:00Z");
    expect(tokens?.currentPeriodEnd).toBe("2026-04-01T00:00:00Z");
    expect(resolveUsageScope(tokens ?? {})).toBe("PERIODIC");
  });

  // The other half of the same rule: bounds genuinely absent on a successful
  // read are the entitlement saying "lifetime counter", and now that the
  // document asks for them the GraphQL path is entitled to say so. Before this
  // change it could not — every counter was UNKNOWN — so this assertion had no
  // way to exist.
  test("the GraphQL path reports a lifetime counter when the bounds are absent", async () => {
    installUsageApi({ graphqlAvailable: true, periodic: false });

    const snapshot = await new KaitenClient({
      authScheme: "publishable",
      apiUrl: "https://api.test",
    }).getLicensingSnapshot("acme");
    const tokens = snapshot.entitlements.find((entitlement) => entitlement.slug === "tokens");

    expect(tokens?.usageWindowUnknown).toBeUndefined();
    expect(resolveUsageScope(tokens ?? {})).toBe("LIFETIME");
  });
});
