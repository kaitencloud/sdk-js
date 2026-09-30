import { describe, expect, test } from "vite-plus/test";
import {
  Customers,
  createKaitenClient,
  Instances,
  KaitenError,
  KaitenNetworkError,
  isThresholdExceeded,
} from "../src/index.ts";

const jsonOk = async () =>
  new Response("[]", { status: 200, headers: { "content-type": "application/json" } });

/** Captures the requests a client issues, answering each with `respond`. */
function recordingFetch(respond: () => Promise<Response> = jsonOk) {
  const seen: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    seen.push(input instanceof Request ? input : new Request(input, init));
    return respond();
  };
  return { seen, fetch };
}

describe("@kaitencloud/server", () => {
  test("exposes grouped resource classes", () => {
    expect(typeof Customers.listCustomers).toBe("function");
    expect(typeof Customers.createCustomer).toBe("function");
    expect(typeof Instances.createInstance).toBe("function");
  });

  test("createKaitenClient injects Bearer auth and the base URL", async () => {
    const { seen, fetch } = recordingFetch();
    const client = createKaitenClient({
      token: "secret-token",
      baseUrl: "https://example.test",
      fetch,
    });

    await Customers.listCustomers({ client });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get("Authorization")).toBe("Bearer secret-token");
    // The contract is served under `/api` (`servers: - url: /api`) and the
    // operation paths are bare, so the prefix has to be on the base URL.
    expect(seen[0]?.url).toBe("https://example.test/api/customers");
  });

  test("accepts an async token provider", async () => {
    const { seen, fetch } = recordingFetch();
    const client = createKaitenClient({
      token: () => Promise.resolve("from-provider"),
      baseUrl: "https://example.test",
      fetch,
    });

    await Customers.listCustomers({ client });

    expect(seen[0]?.headers.get("Authorization")).toBe("Bearer from-provider");
  });

  describe("base URL normalization", () => {
    test.for([
      ["https://example.test", "https://example.test/api/customers"],
      ["https://example.test/", "https://example.test/api/customers"],
      ["https://example.test/api", "https://example.test/api/customers"],
      ["https://example.test/api/", "https://example.test/api/customers"],
      ["  https://example.test  ", "https://example.test/api/customers"],
      ["https://gw.example.test/kaiten", "https://gw.example.test/kaiten/api/customers"],
    ] as const)("%s -> %s", async ([baseUrl, expected]) => {
      const { seen, fetch } = recordingFetch();
      const client = createKaitenClient({ token: "t", baseUrl, fetch });

      await Customers.listCustomers({ client });

      expect(seen[0]?.url).toBe(expected);
    });

    test("requires a base URL: there is no default", () => {
      const withoutBaseUrl = { token: "t" } as unknown as Parameters<typeof createKaitenClient>[0];
      expect(() => createKaitenClient(withoutBaseUrl)).toThrow(TypeError);
    });

    test("rejects a base URL that is not absolute", () => {
      expect(() => createKaitenClient({ token: "t", baseUrl: "/api" })).toThrow(TypeError);
    });
  });

  describe("errors surface instead of resolving", () => {
    test("an RFC-7807 failure throws a KaitenError carrying status and detail", async () => {
      const client = createKaitenClient({
        token: "t",
        baseUrl: "https://example.test",
        fetch: async () =>
          new Response(
            JSON.stringify({
              title: "Not Found",
              status: 404,
              detail: "no such customer",
              code: "Customer.NotFound",
              errorId: "3f6b1a2c-7c1e-4d0b-9d5f-2b0a1c4e8d31",
            }),
            { status: 404, headers: { "content-type": "application/problem+json" } },
          ),
      });

      const error = await Customers.listCustomers({ client }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(KaitenError);
      expect(error).toBeInstanceOf(Error);
      expect((error as KaitenError).status).toBe(404);
      expect((error as KaitenError).detail).toBe("no such customer");
      expect((error as KaitenError).code).toBe("Customer.NotFound");
      expect((error as KaitenError).errorId).toBe("3f6b1a2c-7c1e-4d0b-9d5f-2b0a1c4e8d31");
      expect((error as KaitenError).kind).toBe("api");
    });

    test("a non-JSON failure still throws with the response status", async () => {
      const client = createKaitenClient({
        token: "t",
        baseUrl: "https://example.test",
        fetch: async () =>
          new Response("upstream exploded", { status: 502, statusText: "Bad Gateway" }),
      });

      const error = await Customers.listCustomers({ client }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(KaitenError);
      expect((error as KaitenError).status).toBe(502);
      expect((error as KaitenError).detail).toBe("upstream exploded");
    });

    test("a transport failure throws a KaitenNetworkError", async () => {
      const client = createKaitenClient({
        token: "t",
        baseUrl: "https://example.test",
        fetch: async () => {
          throw new Error("ECONNREFUSED");
        },
      });

      const error = await Customers.listCustomers({ client }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(KaitenNetworkError);
      expect((error as KaitenNetworkError).kind).toBe("network");
    });

    // The whole metering path exists to produce this signal: a 409 that resolved
    // as `{ data: undefined }` let a caller bill past the license limit.
    test("a usage report over the threshold throws and is detectable", async () => {
      const client = createKaitenClient({
        token: "t",
        baseUrl: "https://example.test",
        fetch: async () =>
          new Response(
            JSON.stringify({
              title: "Conflict",
              status: 409,
              detail: "threshold reached",
              code: "ReportEntitlementUsageMetric.ThresholdExceeded",
            }),
            { status: 409, headers: { "content-type": "application/problem+json" } },
          ),
      });

      const error = await Instances.reportEntitlementUsageMetric({
        client,
        path: { instanceSlug: "inst-1", entitlementSlug: "seats" },
        body: { value: { type: "number", value: 1 }, behavior: "append" },
      }).catch((caught: unknown) => caught);

      expect(isThresholdExceeded(error)).toBe(true);
      expect((error as KaitenError).status).toBe(409);
    });

    test("isThresholdExceeded ignores other failures", async () => {
      expect(isThresholdExceeded(new Error("boom"))).toBe(false);
      expect(isThresholdExceeded(new KaitenError({ title: "Forbidden", status: 403 }))).toBe(false);
      // Other operations answer 409 for other conflicts; only the code says which.
      expect(
        isThresholdExceeded(
          new KaitenError({ title: "Conflict", status: 409, code: "CreateCustomer.SlugTaken" }),
        ),
      ).toBe(false);
      expect(isThresholdExceeded(new KaitenError({ title: "Conflict", status: 409 }))).toBe(false);
    });
  });
});
