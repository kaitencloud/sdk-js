// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  Customers,
  createKaitenClient,
  Instances,
  KaitenError,
  KaitenNetworkError,
  isThresholdExceeded,
  isTransactionIdReused,
  toKaitenError,
  TransactionIdReusedError,
} from "../src/index.ts";
import type { ReportedEntitlementUsage, ReportEntitlementUsageMetricData } from "../src/index.ts";

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

    // A reused key is a client bug: the typed error names the report the key
    // was first accepted with, so the caller can see what it collided with.
    test("a usage report under a reused key throws a TransactionIdReusedError", async () => {
      const client = createKaitenClient({
        token: "t",
        baseUrl: "https://example.test",
        fetch: async () =>
          new Response(
            JSON.stringify({
              title: "Conflict",
              status: 409,
              detail: "Idempotency-Key already used",
              code: "ReportEntitlementUsageMetric.TransactionIdReused",
              errors: [
                {
                  message: "the report this key was first accepted with",
                  location: "header.Idempotency-Key",
                  value: {
                    reportSeq: 7,
                    reportedAt: "2026-10-05T08:00:00.000Z",
                    behavior: "append",
                    value: 5,
                  },
                },
              ],
            }),
            { status: 409, headers: { "content-type": "application/problem+json" } },
          ),
      });

      const error = await Instances.reportEntitlementUsageMetric({
        client,
        path: { instanceSlug: "inst-1", entitlementSlug: "tokens" },
        headers: { "Idempotency-Key": "job-42" },
        body: { value: { type: "number", value: 6 }, behavior: "append" },
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(TransactionIdReusedError);
      expect(error).toBeInstanceOf(KaitenError);
      expect(isTransactionIdReused(error)).toBe(true);
      expect(isThresholdExceeded(error)).toBe(false);
      expect((error as TransactionIdReusedError).status).toBe(409);
      expect((error as TransactionIdReusedError).transactionId).toBe("job-42");
      expect((error as TransactionIdReusedError).original).toEqual({
        reportSeq: 7,
        reportedAt: "2026-10-05T08:00:00.000Z",
        behavior: "append",
        value: 5,
      });
    });

    test("isTransactionIdReused ignores other conflicts", () => {
      expect(isTransactionIdReused(new Error("boom"))).toBe(false);
      expect(
        isTransactionIdReused(
          new KaitenError({
            title: "Conflict",
            status: 409,
            code: "ReportEntitlementUsageMetric.ThresholdExceeded",
          }),
        ),
      ).toBe(false);
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

describe("usage report keys and the usage history", () => {
  const problem = (status: number, code: string) =>
    new Response(JSON.stringify({ title: "Conflict", status, code }), {
      status,
      headers: { "content-type": "application/problem+json" },
    });

  test("a usage report sends its key in the Idempotency-Key header and not in the body", async () => {
    const { seen, fetch } = recordingFetch(
      async () =>
        new Response(JSON.stringify({ entitlementSlug: "seats", transactionId: "evt-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createKaitenClient({ token: "t", baseUrl: "https://example.test", fetch });

    await Instances.reportEntitlementUsageMetric({
      client,
      path: { instanceSlug: "inst-1", entitlementSlug: "seats" },
      headers: { "Idempotency-Key": "evt-1" },
      body: { value: { type: "number", value: 1 }, behavior: "append" },
    });

    expect(seen[0]?.headers.get("Idempotency-Key")).toBe("evt-1");
    expect(await seen[0]?.json()).toEqual({
      value: { type: "number", value: 1 },
      behavior: "append",
    });
  });

  test("a usage report without a key sends no Idempotency-Key header", async () => {
    const { seen, fetch } = recordingFetch(
      async () =>
        new Response(JSON.stringify({ entitlementSlug: "seats", transactionId: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createKaitenClient({ token: "t", baseUrl: "https://example.test", fetch });

    await Instances.reportEntitlementUsageMetric({
      client,
      path: { instanceSlug: "inst-1", entitlementSlug: "seats" },
      body: { value: { type: "number", value: 1 }, behavior: "append" },
    });

    expect(seen[0]?.headers.has("Idempotency-Key")).toBe(false);
  });

  test("the key of a usage report is a header of the generated operation, not a member of its body", () => {
    // The body is closed: a key in it would be refused by the API. The key is an
    // optional header, so a report without one still compiles.
    expectTypeOf<keyof ReportEntitlementUsageMetricData["body"]>().toEqualTypeOf<
      "behavior" | "metadata" | "value"
    >();
    expectTypeOf<NonNullable<ReportEntitlementUsageMetricData["headers"]>>().toEqualTypeOf<{
      "Idempotency-Key"?: string;
    }>();
    expectTypeOf<{
      value: { type: "number"; value: number };
    }>().toExtend<ReportEntitlementUsageMetricData["body"]>();
  });

  test("a usage report answers the key it was accepted under, null without one", () => {
    expectTypeOf<ReportedEntitlementUsage["transactionId"]>().toEqualTypeOf<string | null>();
  });

  test("the reused-key conflict is recognised by its code, with or without the original report", async () => {
    const client = createKaitenClient({
      token: "t",
      baseUrl: "https://example.test",
      fetch: async () => problem(409, "ReportEntitlementUsageMetric.TransactionIdReused"),
    });
    const error = await Instances.reportEntitlementUsageMetric({
      client,
      path: { instanceSlug: "inst-1", entitlementSlug: "seats" },
      headers: { "Idempotency-Key": "evt-1" },
      body: { value: { type: "number", value: 1 }, behavior: "append" },
    }).catch((caught: unknown) => caught);

    expect(isTransactionIdReused(error)).toBe(true);
    expect(error).toBeInstanceOf(TransactionIdReusedError);
    // The body named no original report: the error is typed all the same, and
    // still names the key the refused report was sent with.
    expect((error as TransactionIdReusedError).original).toBeUndefined();
    expect((error as TransactionIdReusedError).transactionId).toBe("evt-1");
    expect(isThresholdExceeded(error)).toBe(false);
  });

  test("a reused-key refusal names the key the request carried in its header, whatever the case of its name", async () => {
    const client = createKaitenClient({
      token: "t",
      baseUrl: "https://example.test",
      fetch: async () => problem(409, "ReportEntitlementUsageMetric.TransactionIdReused"),
    });
    const refused = async (headers?: { [name: string]: string }) =>
      (await Instances.reportEntitlementUsageMetric({
        client,
        path: { instanceSlug: "inst-1", entitlementSlug: "seats" },
        ...(headers === undefined ? {} : { headers }),
        // A `transactionId` in the metadata is the caller's data, never the key.
        body: {
          behavior: "set",
          value: { type: "number", value: 4 },
          metadata: { transactionId: "not-the-key" },
        },
      }).catch((caught: unknown) => caught)) as TransactionIdReusedError;

    const key = "A.z_9:x-0";
    for (const headers of [{ "Idempotency-Key": key }, { "idempotency-key": key }] as {
      [name: string]: string;
    }[]) {
      const error = await refused(headers);
      expect(error.transactionId, JSON.stringify(headers)).toBe(key);
      expect(error.status).toBe(409);
    }
    // A request that carried no key has nothing to name.
    expect((await refused()).transactionId).toBeUndefined();
  });

  test("toKaitenError reads the key from a Headers too", () => {
    const refusal = {
      title: "Conflict",
      status: 409,
      code: "ReportEntitlementUsageMetric.TransactionIdReused",
    };
    const error = toKaitenError(refusal, new Response(null, { status: 409 }), {
      headers: new Headers({ "IDEMPOTENCY-KEY": "evt-9" }),
    });
    expect(error).toBeInstanceOf(TransactionIdReusedError);
    expect((error as TransactionIdReusedError).transactionId).toBe("evt-9");
  });

  test("the threshold refusal is not mistaken for a reused key", async () => {
    const client = createKaitenClient({
      token: "t",
      baseUrl: "https://example.test",
      fetch: async () => problem(409, "ReportEntitlementUsageMetric.ThresholdExceeded"),
    });
    const error = await Instances.reportEntitlementUsageMetric({
      client,
      path: { instanceSlug: "inst-1", entitlementSlug: "seats" },
      headers: { "Idempotency-Key": "evt-1" },
      body: { value: { type: "number", value: 1 }, behavior: "append" },
    }).catch((caught: unknown) => caught);

    expect(isThresholdExceeded(error)).toBe(true);
    expect(isTransactionIdReused(error)).toBe(false);
    expect(error).not.toBeInstanceOf(TransactionIdReusedError);
  });

  test("the usage history is a paged read by afterSeq", async () => {
    const { seen, fetch } = recordingFetch(
      async () =>
        new Response(JSON.stringify({ items: [], nextAfterSeq: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createKaitenClient({ token: "t", baseUrl: "https://example.test", fetch });

    const { data } = await Instances.listUsageReports({
      client,
      path: { instanceSlug: "inst-1", entitlementSlug: "seats" },
      query: { afterSeq: 1, limit: 2, transactionId: "evt-1" },
    });

    expect(data?.nextAfterSeq).toBe(2);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/api/instances/inst-1/entitlements/seats/usage/reports");
    expect(url.searchParams.get("afterSeq")).toBe("1");
    expect(url.searchParams.get("transactionId")).toBe("evt-1");
  });

  test("an export streams when asked to", async () => {
    const csv = "organization_id,instance_id\no,i\n";
    const client = createKaitenClient({
      token: "t",
      baseUrl: "https://example.test",
      fetch: async () =>
        new Response(csv, { status: 200, headers: { "content-type": "text/csv" } }),
    });

    const { data } = await Instances.exportUsageReports({
      client,
      path: { instanceSlug: "inst-1", entitlementSlug: "seats" },
      query: { format: "csv" },
      parseAs: "stream",
    });

    expect(data).toBeInstanceOf(ReadableStream);
    // Typed as the body the contract declares; parseAs "stream" hands back the stream.
    expect(await new Response(data as unknown as ReadableStream).text()).toBe(csv);
  });
});
