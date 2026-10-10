import { describe, expect, test } from "vite-plus/test";

import { KaitenApi, KaitenError, KaitenTransport } from "../src/index.ts";
import type { KaitenFetch } from "../src/index.ts";

// The usage history is served by generated operations, with no curated helper
// over them: these tests pin that the operations are wired to the transport,
// that their parameters travel as the contract names them, and that a refusal
// reaches the caller as a `KaitenError` with its code.

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

function transportAnswering(answer: () => Response) {
  const requests: Request[] = [];
  const fetch: KaitenFetch = async (input, init) => {
    requests.push(new Request(input as RequestInfo, init));
    return answer();
  };
  const transport = new KaitenTransport({
    authScheme: "bearer",
    apiUrl: "https://api.test",
    tokenProvider: () => "ksh_test",
    fetch,
  });
  return { transport, requests };
}

describe("usage history operations", () => {
  test("listUsageReports sends the range, the key, the cursor and the page size as query parameters", async () => {
    const { transport, requests } = transportAnswering(
      () =>
        new Response(JSON.stringify({ items: [item(3)], nextAfterSeq: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const page = await transport.run(
      (client) =>
        KaitenApi.listUsageReports({
          client,
          path: { instanceSlug: "acme", entitlementSlug: "tokens" },
          query: {
            from: "2026-10-01T00:00:00.000Z",
            transactionId: "evt-1",
            afterSeq: 2,
            limit: 500,
          },
        }),
      "listUsageReports(acme, tokens)",
    );

    expect(page.items.map((report) => report.reportSeq)).toEqual([3]);
    expect(page.nextAfterSeq).toBe(3);
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toMatch(/\/instances\/acme\/entitlements\/tokens\/usage\/reports$/);
    expect(url.searchParams.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(url.searchParams.get("transactionId")).toBe("evt-1");
    expect(url.searchParams.get("afterSeq")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("500");
  });

  test("a range out of retention reaches the caller as a KaitenError with its code", async () => {
    const { transport, requests } = transportAnswering(
      () =>
        new Response(
          JSON.stringify({
            title: "Unprocessable Entity",
            status: 422,
            code: "ListUsageReports.OutsideRetention",
          }),
          { status: 422, headers: { "Content-Type": "application/problem+json" } },
        ),
    );

    const error = await transport
      .run(
        (client) =>
          KaitenApi.listUsageReports({
            client,
            path: { instanceSlug: "acme", entitlementSlug: "tokens" },
            query: { from: "2025-01-01T00:00:00Z" },
          }),
        "listUsageReports(acme, tokens)",
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).code).toBe("ListUsageReports.OutsideRetention");
    expect(requests).toHaveLength(1);
  });
});
