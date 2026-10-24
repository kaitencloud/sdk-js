// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, it, vi } from "vite-plus/test";
import { KaitenClient } from "../src/index.ts";
import type {
  AiUsageValue,
  AiUsageOutcome,
  AiUsage,
  AiEntitlementUsage,
} from "../src/ai/contract.ts";
import type {
  AiUsageValue as WireValue,
  AiUsageOutcome as WireOutcome,
  AiUsage as WireUsage,
  EntitlementUsage,
} from "../src/core/index.ts";

it("aliases the regenerated AI contract and preserves exact outcomes", async () => {
  const value: AiUsageValue = {
    type: "ai_usage",
    phase: "reserve",
    transactionId: "t",
    model: "m",
    requestType: "COMPLETION",
  };
  const wire: WireValue = value;
  expect(wire).toBe(value);
  const usage: AiUsage = { inputTokens: 10 };
  const wireUsage: WireUsage = usage;
  expect(wireUsage).toBe(usage);
  const outcome: AiUsageOutcome = {
    transactionId: "t",
    phase: "reserve",
    status: "RESERVED",
    credits: { reserved: "9007199254740993.123456" },
    remaining: null,
    warnings: [],
  };
  const wireOutcome: WireOutcome = outcome;
  expect(wireOutcome).toBe(outcome);
  const response: AiEntitlementUsage = {
    entitlementId: "e",
    entitlementSlug: "p",
    licenseId: "l",
    licenseSlug: "l",
    value: { type: "number", value: 0 },
    reserved: "9007199254740993.123456",
    ai: outcome,
  };
  const wireResponse: EntitlementUsage = response;
  expect(wireResponse).toBe(response);
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } }),
  );
  const client = new KaitenClient({
    authScheme: "none",
    apiUrl: "https://synthetic.test/api",
    fetch,
  });
  const result = await client.ai.reserve({
    instance: "i",
    entitlement: "p",
    model: "m",
    requestType: "COMPLETION",
    transactionId: "t",
  });
  expect(result.entitlementUsage).toEqual(response);
  expect(result.outcome?.remaining).toBeNull();
  expect(result.outcome?.credits.reserved).toBe("9007199254740993.123456");
  expect(result.entitlementUsage.value).toEqual({ type: "number", value: 0 });
});

it("exposes model, conversion rule and inference reads with filters and wire pagination", async () => {
  const requests: URL[] = [];
  const replies = [
    { items: [], hasMore: true, nextCursor: "next" },
    { slug: "m" },
    null,
    { id: "r" },
    { items: null, hasMore: false },
    { items: [] },
  ];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    requests.push(new URL(new Request(input).url));
    return new Response(JSON.stringify(replies.shift()), {
      headers: { "content-type": "application/json" },
    });
  });
  const client = new KaitenClient({
    authScheme: "none",
    apiUrl: "https://synthetic.test/api",
    fetch,
  });
  expect(
    await client.models.list({ vendor: "synthetic", status: "ACTIVE", cursor: "old", limit: 2 }),
  ).toEqual({ items: [], hasMore: true, nextCursor: "next" });
  expect(await client.models.get("model/slug")).toEqual({ slug: "m" });
  expect(
    await client.licenses.conversionRules.list("license", {
      entitlementSlug: "pool",
      modelSlug: "m",
      status: "ARCHIVED",
    }),
  ).toBeNull();
  expect(await client.licenses.conversionRules.get("license", "r")).toEqual({ id: "r" });
  expect(
    await client.ai.listInferences(
      { instance: "i", entitlement: "p" },
      {
        status: "COMMITTED",
        transactionId: "t",
        cursor: "old",
        limit: 2,
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-19T00:00:00Z",
      },
    ),
  ).toEqual({ items: null, hasMore: false });
  expect(await client.ai.listReservations({ instance: "i", entitlement: "p" })).toEqual({
    items: [],
  });
  expect(requests.map((u) => u.pathname)).toEqual([
    "/api/models",
    "/api/models/model%2Fslug",
    "/api/licenses/license/conversion-rules",
    "/api/licenses/license/conversion-rules/r",
    "/api/instances/i/entitlements/p/usage/inferences",
    "/api/instances/i/entitlements/p/usage/reservations",
  ]);
  expect(requests[0]!.searchParams.get("vendor")).toBe("synthetic");
  expect(requests[2]!.searchParams.get("status")).toBe("ARCHIVED");
  expect(requests[4]!.searchParams.get("transactionId")).toBe("t");
  expect(fetch).toHaveBeenCalledTimes(6);
});

it("rejects non-numeric read values without issuing a malformed usage request", () => {
  const fetch = vi.fn();
  const client = new KaitenClient({
    authScheme: "none",
    apiUrl: "https://synthetic.test/api",
    fetch,
  });
  expect(() =>
    client.reportUsage("i", "p", { behavior: "append", value: { type: "boolean", value: true } }),
  ).toThrow("numeric value");
  expect(fetch).not.toHaveBeenCalled();
});
