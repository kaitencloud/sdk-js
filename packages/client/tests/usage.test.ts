import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient } from "../src/client/client.ts";
import { KaitenError, TransactionIdReusedError } from "../src/core/index.ts";

type Answer = (request: Request) => Response | Promise<Response>;

const usage = {
  entitlementId: "e",
  entitlementSlug: "tokens",
  licenseId: "l",
  value: { type: "number", value: 1200, eventCount: 1 },
  limit: { type: "number", value: 5000 },
};

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function problem(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ title: "Error", status, ...body }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

/** A client whose requests are answered by `answers` in turn, the last one repeating. */
function givenClient(...answers: Answer[]) {
  const requests: Request[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const text = await request.clone().text();
    bodies.push(text ? (JSON.parse(text) as Record<string, unknown>) : {});
    const answer = answers[Math.min(requests.length - 1, answers.length - 1)]!;
    return answer(request);
  });
  const client = new KaitenClient({
    apiUrl: "https://api.test",
    authScheme: "bearer",
    tokenProvider: () => "ksh_test",
    fetch,
  });
  return { client, requests, bodies };
}

const report = { value: { type: "number" as const, value: 1200 }, behavior: "append" as const };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usage report transactionId", () => {
  test("sends the key only when given", async () => {
    const keyed = givenClient(() => json(usage));
    await keyed.client.reportUsage("acme", "tokens", {
      ...report,
      transactionId: "llm-call:9f2c:tokens",
    });
    expect(keyed.bodies[0]).toMatchObject({ transactionId: "llm-call:9f2c:tokens" });

    const plain = givenClient(() => json(usage));
    await plain.client.reportUsage("acme", "tokens", report);
    expect(plain.bodies[0]).not.toHaveProperty("transactionId");
  });

  test("a keyed report is retried on 5xx under the same key; an unkeyed one is not", async () => {
    const keyed = givenClient(
      () => problem(503, { code: "ReportEntitlementUsageMetric.LedgerUnavailable" }),
      () => json(usage),
    );
    await keyed.client.reportUsage("acme", "tokens", { ...report, transactionId: "evt-1" });
    expect(keyed.requests).toHaveLength(2);
    expect(keyed.bodies.map((body) => body.transactionId)).toEqual(["evt-1", "evt-1"]);

    const plain = givenClient(
      () => problem(503, {}),
      () => json(usage),
    );
    await expect(plain.client.reportUsage("acme", "tokens", report)).rejects.toBeInstanceOf(
      KaitenError,
    );
    expect(plain.requests).toHaveLength(1);
  });

  test("a reused key throws TransactionIdReusedError, never retried", async () => {
    const { client, requests } = givenClient(() =>
      problem(409, {
        code: "ReportEntitlementUsageMetric.TransactionIdReused",
        errors: [
          {
            location: "body.transactionId",
            message: "the report this transactionId was first accepted with",
            value: { reportSeq: 2 },
          },
        ],
      }),
    );

    const error = await client
      .reportUsage("acme", "tokens", { ...report, transactionId: "evt-1" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TransactionIdReusedError);
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).errors?.[0]?.value).toEqual({ reportSeq: 2 });
    expect(requests).toHaveLength(1);
  });

  test("a malformed key is refused before any request", async () => {
    const { client, requests } = givenClient(() => json(usage));
    for (const key of ["has space", "x".repeat(129), "a/b", ""]) {
      await expect(
        client.reportUsage("acme", "tokens", { ...report, transactionId: key }),
      ).rejects.toBeInstanceOf(TypeError);
    }
    expect(requests).toHaveLength(0);
  });

  test("reportDetailed reads the replay and dropped-metadata headers", async () => {
    const { client } = givenClient(() =>
      json(usage, 200, { "Idempotent-Replayed": "true", "Kaiten-Metadata-Dropped": "too_large" }),
    );
    const result = await client.usage.reportDetailed("acme", "tokens", {
      ...report,
      transactionId: "evt-1",
    });
    expect(result).toMatchObject({ replayed: true, metadataDropped: true });
    expect(result.usage.entitlementSlug).toBe("tokens");

    const plain = givenClient(() => json(usage));
    expect(await plain.client.usage.reportDetailed("acme", "tokens", report)).toMatchObject({
      replayed: false,
      metadataDropped: false,
    });
  });

  test("an API without transactionId: the report is resent without it, and keys stop for good", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, requests, bodies } = givenClient((request) =>
      request
        .clone()
        .text()
        .then((text) =>
          text.includes("transactionId")
            ? problem(422, {
                code: "UNPROCESSABLE",
                errors: [{ location: "body.transactionId", message: "unexpected property" }],
              })
            : json(usage),
        ),
    );

    await client.reportUsage("acme", "tokens", { ...report, transactionId: "evt-1" });
    expect(requests).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty("transactionId");

    await client.reportUsage("acme", "tokens", { ...report, transactionId: "evt-2" });
    expect(requests).toHaveLength(3);
    expect(bodies[2]).not.toHaveProperty("transactionId");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("a new API's malformed-key code is not mistaken for an old API", async () => {
    const { client, requests } = givenClient(() =>
      problem(422, {
        code: "ReportEntitlementUsageMetric.InvalidTransactionId",
        errors: [{ location: "body.transactionId", message: "invalid" }],
      }),
    );
    await expect(
      client.reportUsage("acme", "tokens", { ...report, transactionId: "evt-1" }),
    ).rejects.toBeInstanceOf(KaitenError);
    expect(requests).toHaveLength(1);
  });
});

describe("usage history", () => {
  const item = (reportSeq: number) => ({
    reportSeq,
    reportedAt: "2026-10-05T08:00:00Z",
    behavior: "append",
    aggregationMethod: "SUM",
    reportedValue: "1",
    valueBefore: String(reportSeq - 1),
    valueAfter: String(reportSeq),
    delta: "1",
    overageDelta: "0",
    eventCountAfter: reportSeq,
    instanceId: "11111111-1111-1111-1111-111111111111",
    entitlementId: "22222222-2222-2222-2222-222222222222",
    licenseId: "33333333-3333-3333-3333-333333333333",
  });

  test("walks the pages by afterSeq", async () => {
    const { client, requests } = givenClient(
      () => json({ items: [item(1), item(2)], nextAfterSeq: 2 }),
      () => json({ items: [item(3)] }),
    );

    const reports = await client.usage.history("acme", "tokens", {
      from: new Date("2026-10-01T00:00:00Z"),
      transactionId: "evt-1",
    });

    expect(reports.map((report) => report.reportSeq)).toEqual([1, 2, 3]);
    const first = new URL(requests[0]!.url);
    const second = new URL(requests[1]!.url);
    expect(first.pathname).toMatch(/\/instances\/acme\/entitlements\/tokens\/usage\/reports$/);
    expect(first.searchParams.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(first.searchParams.get("transactionId")).toBe("evt-1");
    expect(first.searchParams.get("limit")).toBe("500");
    expect(first.searchParams.has("afterSeq")).toBe(false);
    expect(second.searchParams.get("afterSeq")).toBe("2");
  });

  test("stops at the limit", async () => {
    const { client, requests } = givenClient(() =>
      json({ items: [item(1), item(2)], nextAfterSeq: 2 }),
    );
    const reports = await client.usage.history("acme", "tokens", { limit: 2 });
    expect(reports).toHaveLength(2);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).searchParams.get("limit")).toBe("2");
  });

  test("an out-of-retention range reaches the caller as a KaitenError with its code", async () => {
    const { client } = givenClient(() =>
      problem(422, { code: "ListUsageReports.OutsideRetention" }),
    );
    const error = await client.usage
      .history("acme", "tokens", { from: "2025-01-01T00:00:00Z" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).code).toBe("ListUsageReports.OutsideRetention");
  });
});
