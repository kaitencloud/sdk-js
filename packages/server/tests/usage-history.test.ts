// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { createKaitenClient, Instances } from "../src/index.ts";
import type { Client } from "../src/index.ts";

// The usage history and its exports are generated operations, with no curated
// helper over them. These tests run the example of the README: they pin the
// paging by `afterSeq`, the streamed exports, and the refusals that come back
// as thrown errors.

const instanceSlug = "acme-prod";

const report = (reportSeq: number) => ({
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status < 400 ? "application/json" : "application/problem+json" },
  });

/** A client whose fetch answers with `answer` and records the requests it saw. */
function clientAnswering(answer: (request: Request) => Response) {
  const seen: Request[] = [];
  const client = createKaitenClient({
    token: "t",
    baseUrl: "https://example.test",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push(request);
      return answer(request);
    },
  });
  return { client, seen };
}

/** The first example of the README: every report of a range, a page at a time. */
async function readHistory(client: Client) {
  const reports = [];
  let afterSeq: number | undefined;
  do {
    const { data: page } = await Instances.listUsageReports({
      client,
      throwOnError: true,
      path: { instanceSlug, entitlementSlug: "tokens" },
      query: { from: "2026-10-01T00:00:00Z", afterSeq, limit: 500 },
    });
    reports.push(...page.items);
    afterSeq = page.nextAfterSeq;
  } while (afterSeq !== undefined);
  return reports;
}

describe("the usage history", () => {
  test("is read page by page until a page has no nextAfterSeq", async () => {
    const { client, seen } = clientAnswering((request) => {
      const after = Number(new URL(request.url).searchParams.get("afterSeq") ?? 0);
      if (after === 0) return json({ items: [report(1), report(2)], nextAfterSeq: 2 });
      if (after === 2) return json({ items: [report(3), report(4)], nextAfterSeq: 4 });
      return json({ items: [report(5)] });
    });

    const reports = await readHistory(client);

    expect(reports.map((entry) => entry.reportSeq)).toEqual([1, 2, 3, 4, 5]);
    const urls = seen.map((request) => new URL(request.url));
    expect(urls.map((url) => url.searchParams.get("afterSeq"))).toEqual([null, "2", "4"]);
    for (const url of urls) {
      expect(url.pathname).toBe("/api/instances/acme-prod/entitlements/tokens/usage/reports");
      expect(url.searchParams.get("limit")).toBe("500");
      expect(url.searchParams.get("from")).toBe("2026-10-01T00:00:00Z");
    }
  });

  test("an empty range is one empty page", async () => {
    const { client, seen } = clientAnswering(() => json({ items: [] }));

    expect(await readHistory(client)).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  test("a range before the retention rejects with the problem's code", async () => {
    const { client } = clientAnswering(() =>
      json(
        { title: "Unprocessable Entity", status: 422, code: "ListUsageReports.OutsideRetention" },
        422,
      ),
    );

    const error = await readHistory(client).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 422, code: "ListUsageReports.OutsideRetention" });
  });
});

describe("the usage exports", () => {
  const csv = "organization_id,instance_id,reported_value\no,i,1\n";
  const ndjson = `${JSON.stringify(report(1))}\n${JSON.stringify(report(2))}\n`;

  const attachment = (body: string, type: string, name: string) =>
    new Response(body, {
      status: 200,
      headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"` },
    });

  test("one entitlement's reports stream as CSV, with the file name the API chose", async () => {
    const { client, seen } = clientAnswering(() =>
      attachment(csv, "text/csv", "usage-reports-acme-prod-tokens.csv"),
    );

    const { data, response } = await Instances.exportUsageReports({
      client,
      throwOnError: true,
      parseAs: "stream",
      path: { instanceSlug, entitlementSlug: "tokens" },
      query: { from: "2026-10-01T00:00:00Z", format: "csv" },
    });

    // The contract types the body as text; `parseAs: "stream"` hands back the stream.
    expect(data).toBeInstanceOf(ReadableStream);
    expect(await new Response(data as unknown as ReadableStream).text()).toBe(csv);
    expect(response.headers.get("Content-Disposition")).toContain("usage-reports-acme-prod-tokens");
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/api/instances/acme-prod/entitlements/tokens/usage/reports/export");
    expect(url.searchParams.get("format")).toBe("csv");
  });

  test("the organization's reports stream as NDJSON, narrowed to an instance", async () => {
    const { client, seen } = clientAnswering(() =>
      attachment(ndjson, "application/x-ndjson", "usage-reports.ndjson"),
    );

    const { data } = await Instances.exportOrganizationUsageReports({
      client,
      throwOnError: true,
      parseAs: "stream",
      query: {
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-15T00:00:00Z",
        format: "json",
        instanceSlug,
      },
    });

    const lines = (await new Response(data as unknown as ReadableStream).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { reportSeq: number });
    expect(lines.map((line) => line.reportSeq)).toEqual([1, 2]);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/api/usage/reports/export");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-15T00:00:00Z",
      format: "json",
      instanceSlug,
    });
  });

  test("an unknown format rejects with the problem's code", async () => {
    const { client } = clientAnswering(() =>
      json(
        { title: "Unprocessable Entity", status: 422, code: "ExportUsageReports.InvalidFormat" },
        422,
      ),
    );

    const error = await Instances.exportOrganizationUsageReports({
      client,
      throwOnError: true,
      parseAs: "stream",
      query: { format: "xml" },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 422, code: "ExportUsageReports.InvalidFormat" });
  });
});
