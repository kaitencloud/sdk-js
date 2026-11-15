// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// `useReportUsage` with a `transactionId`, against the real `KaitenClient` and a
// stubbed `fetch`: the key leaves in the `Idempotency-Key` header, and what the hook
// hands back is what the client resolves or rejects with, in the shapes the client
// ships. The other suites mock the client, which is
// the right tool for the hook's own behavior and a poor one for these shapes.

import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { KaitenClient, type KaitenClientLike } from "@kaitencloud/client";
import { demoSnapshot } from "@kaitencloud/client/testing";

import {
  InvalidTransactionIdError,
  KaitenError,
  KaitenProvider,
  TransactionIdReusedError,
  useReportUsage,
} from "../src/index.ts";

const API = "https://kaiten.test/api";
const SNAPSHOT = demoSnapshot();
const INSTANCE = SNAPSHOT.instance!.slug;
const USAGE_PATH = `/api/instances/${INSTANCE}/entitlements/tokens/usage`;

const USAGE = {
  entitlementId: "0b6d0c1e-4f5c-4c8e-9d61-0f6a8d7f7a01",
  entitlementSlug: "tokens",
  licenseId: "6f1f9a54-2a4b-4d0e-8c1d-5b0a2f3e4d02",
  licenseSlug: "growth",
  source: "license",
  value: { type: "number", value: 500, eventCount: 1 },
  limit: { type: "number", value: 1000 },
  currentPeriodStart: "2026-10-01T00:00:00Z",
  currentPeriodEnd: "2026-11-01T00:00:00Z",
};

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface Sent {
  body: Record<string, unknown>;
  /** The request's `Idempotency-Key` header: `null` when it carried none. */
  key: string | null;
}

/**
 * A `fetch` that answers the usage route with the queued replies, and records its
 * requests. A success echoes the request's key as `transactionId`, as a server that
 * honours the header does, and `null` for a report sent without one.
 */
function stubUsageApi(...replies: Reply[]) {
  const requests: Sent[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    expect(new URL(request.url).pathname).toBe(USAGE_PATH);
    const key = request.headers.get("Idempotency-Key");
    requests.push({
      body: JSON.parse(await request.clone().text()) as Record<string, unknown>,
      key,
    });

    const { status, body, headers } = replies[Math.min(requests.length, replies.length) - 1]!;
    const ok = status < 400;
    return new Response(JSON.stringify(ok ? (body ?? { ...USAGE, transactionId: key }) : body), {
      status,
      headers: { "Content-Type": ok ? "application/json" : "application/problem+json", ...headers },
    });
  });
  return { fetch, requests };
}

/**
 * The real client's `reportUsage`, with the snapshot read held still: the report
 * revalidates the snapshot, and this suite is about the report.
 */
function clientFor(fetch: typeof globalThis.fetch): KaitenClientLike {
  const real = new KaitenClient({ apiUrl: API, authScheme: "none", fetch, timeoutMs: 0 });
  return {
    getCatalog: () => real.getCatalog(),
    getLicensingSnapshot: async () => SNAPSHOT,
    reportUsage: (...args) => real.reportUsage(...args),
  };
}

function wrapperFor(client: KaitenClientLike) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_report"
        customerId="acme"
        client={client}
        initialData={{ snapshot: SNAPSHOT }}
        polling={{ enabled: false }}
      >
        {children}
      </KaitenProvider>
    );
  };
}

const report = (transactionId: string) => ({
  entitlementSlug: "tokens",
  input: {
    behavior: "append" as const,
    value: { type: "number" as const, value: 500 },
    transactionId,
  },
});

afterEach(cleanup);

test("a report the API already applied resolves as a replay, with the dropped metadata named", async () => {
  const { fetch, requests } = stubUsageApi({
    status: 200,
    headers: { "Idempotent-Replayed": "true", "Kaiten-Metadata-Dropped": "too_large" },
  });
  const { result } = renderHook(() => useReportUsage(), { wrapper: wrapperFor(clientFor(fetch)) });

  const usage = await result.current.mutateAsync(report("llm:9f2c:tokens"));

  expect(requests).toHaveLength(1);
  // The key is a header, and the body is the report alone.
  expect(requests[0]!.key).toBe("llm:9f2c:tokens");
  expect(requests[0]!.body).toEqual({ behavior: "append", value: { type: "number", value: 500 } });
  expect(usage).toMatchObject({
    idempotentReplayed: true,
    metadataDropped: "too_large",
    transactionId: "llm:9f2c:tokens",
  });
  expect(usage.value).toEqual(USAGE.value);
});

test("a report the API applied for the first time carries no replay mark", async () => {
  const { fetch } = stubUsageApi({ status: 200 });
  const { result } = renderHook(() => useReportUsage(), { wrapper: wrapperFor(clientFor(fetch)) });

  const usage = await result.current.mutateAsync(report("llm:9f2c:tokens"));

  expect(usage.idempotentReplayed).toBeUndefined();
  expect(usage.metadataDropped).toBeUndefined();
  expect(usage.transactionId).toBe("llm:9f2c:tokens");
});

test("a report sent without a key carries no header, and its answer echoes none", async () => {
  const { fetch, requests } = stubUsageApi({ status: 200 });
  const { result } = renderHook(() => useReportUsage(), { wrapper: wrapperFor(clientFor(fetch)) });

  const usage = await result.current.mutateAsync({
    entitlementSlug: "tokens",
    input: { behavior: "append", value: { type: "number", value: 500 } },
  });

  expect(requests[0]!.key).toBeNull();
  expect(usage.transactionId).toBeNull();
});

test("a keyed report that fails before the API echoed a key is not sent again", async () => {
  const { fetch, requests } = stubUsageApi({ status: 503 }, { status: 200 });
  const { result } = renderHook(() => useReportUsage(), { wrapper: wrapperFor(clientFor(fetch)) });

  const refusal = await result.current
    .mutateAsync(report("llm:9f2c:tokens"))
    .catch((e: unknown) => e);

  expect(refusal).toBeInstanceOf(KaitenError);
  expect((refusal as KaitenError).status).toBe(503);
  expect(requests).toHaveLength(1);
});

test("a keyed report that fails once the API echoed a key is sent again under the same key", async () => {
  const { fetch, requests } = stubUsageApi(
    { status: 200 },
    { status: 503, headers: { "Retry-After": "0" } },
    { status: 200 },
  );
  const { result } = renderHook(() => useReportUsage(), { wrapper: wrapperFor(clientFor(fetch)) });

  await result.current.mutateAsync(report("first:0"));
  const usage = await result.current.mutateAsync(report("llm:9f2c:tokens"));

  expect(requests.map((request) => request.key)).toEqual([
    "first:0",
    "llm:9f2c:tokens",
    "llm:9f2c:tokens",
  ]);
  expect(usage.transactionId).toBe("llm:9f2c:tokens");
});

test("a key reused with another value rejects with the report it was first accepted with", async () => {
  const onError = vi.fn();
  const { fetch, requests } = stubUsageApi({
    status: 409,
    body: {
      title: "Conflict",
      status: 409,
      code: "ReportEntitlementUsageMetric.TransactionIdReused",
      errors: [
        {
          message: "the report this transactionId was first accepted with",
          location: "header.Idempotency-Key",
          value: {
            reportSeq: 7,
            reportedAt: "2026-10-05T08:00:00.000Z",
            behavior: "append",
            value: 250,
          },
        },
      ],
    },
  });
  const { result } = renderHook(() => useReportUsage({ onError }), {
    wrapper: wrapperFor(clientFor(fetch)),
  });

  const refusal = await result.current
    .mutateAsync(report("llm:9f2c:tokens"))
    .catch((e: unknown) => e);

  expect(refusal).toBeInstanceOf(TransactionIdReusedError);
  expect(refusal).toBeInstanceOf(KaitenError);
  expect(refusal).toMatchObject({
    status: 409,
    transactionId: "llm:9f2c:tokens",
    original: { reportSeq: 7, behavior: "append", value: 250 },
  });
  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  expect(requests).toHaveLength(1);
});

test("a malformed key is refused before any request, with the error the API gives for it", async () => {
  const { fetch, requests } = stubUsageApi({ status: 200 });
  const { result } = renderHook(() => useReportUsage(), { wrapper: wrapperFor(clientFor(fetch)) });

  const refusal = await result.current.mutateAsync(report("not a key!")).catch((e: unknown) => e);

  expect(refusal).toBeInstanceOf(InvalidTransactionIdError);
  expect((refusal as InvalidTransactionIdError).transactionId).toBe("not a key!");
  expect(requests).toHaveLength(0);
});
