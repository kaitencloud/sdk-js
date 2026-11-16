// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The explainable-charges contract: vendorCost on commit, the pricing rule on
// answers, open warnings, release tombstones, the history reads and refunds.

import { describe, expect, it, vi } from "vite-plus/test";

import {
  AiInferenceNotCommittedError,
  AiInferenceNotFoundError,
  AiPoolNotGrantedError,
  AiRefundError,
  AiUsageUnsupportedError,
  KaitenClient,
  KaitenError,
  NotAnAiCreditPoolError,
  NothingToRefundError,
  RefundExceedsRefundableError,
  RefundIdempotencyKeyReusedError,
  TransactionIdReusedError,
  classifyProviderError,
  isVendorCost,
} from "../src/index.ts";
import type {
  AiInference,
  AiUsageOutcome,
  AiUsageWarning,
  KaitenFetch,
  OrganizationAiInference,
} from "../src/index.ts";
import { createAiMeter, readVendorCost } from "../src/ai/meter.ts";

interface Reply {
  status: number;
  body?: unknown;
}

/** A Kaiten API double that keeps every request's raw body text. */
function fakeApi(replies: (Reply | "network")[] = []) {
  const requests: { method: string; url: URL; headers: Headers; text: string; body: any }[] = [];
  let call = 0;
  const fetch: KaitenFetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const text = await request.text();
    requests.push({
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      text,
      body: text ? JSON.parse(text) : undefined,
    });
    const reply = replies[Math.min(call, replies.length - 1)] ?? { status: 200 };
    call += 1;
    if (reply === "network") throw new TypeError("fetch failed");
    const answer =
      reply.body ??
      (reply.status === 200 && text
        ? { entitlementSlug: "chat-credits", ai: aiOutcome(JSON.parse(text).value?.transactionId) }
        : {});
    return new Response(JSON.stringify(answer), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = new KaitenClient({
    authScheme: "bearer",
    apiUrl: "https://kaiten.test/api",
    fetch,
  });
  return { client, requests };
}

const aiOutcome = (transactionId: string): AiUsageOutcome => ({
  transactionId,
  phase: "commit",
  status: "COMMITTED",
  credits: { computed: "3.4", charged: "3.4" },
  remaining: "96.6",
  warnings: [],
});

const problem = (status: number, code: string, extra: Record<string, unknown> = {}): Reply => ({
  status,
  body: { title: code, status, code, ...extra },
});

const TARGET = { instance: "acme-prod", entitlement: "chat-credits" };

describe("vendorCost on commit", () => {
  it("sends the exact string, and resends the byte-identical body on retries", async () => {
    const { client, requests } = fakeApi([{ status: 503 }, "network", { status: 200 }]);

    await client.ai.commit({
      ...TARGET,
      transactionId: "t-1",
      requestStatus: "SUCCESS",
      usage: { inputTokens: 10, outputTokens: 2 },
      vendorCost: "0.010",
    });

    expect(requests).toHaveLength(3);
    expect(requests[0]!.body.value.vendorCost).toBe("0.010");
    // The raw text, not the parsed value: "0.010" must not become 0.01 or "0.01".
    expect(requests[0]!.text).toContain('"vendorCost":"0.010"');
    for (const request of requests) expect(request.text).toBe(requests[0]!.text);
  });

  it.for([0.01, "1e-3", "-1", "0.0000000000001", "1234567890123", " 1", ""])(
    "refuses %j locally, before any request",
    async (vendorCost) => {
      const { client, requests } = fakeApi();
      await expect(
        client.ai.commit({
          ...TARGET,
          transactionId: "t",
          requestStatus: "SUCCESS",
          vendorCost: vendorCost as string,
        }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(requests).toHaveLength(0);
    },
  );

  it("refuses a vendorCost on a NOT_SENT commit locally", async () => {
    const { client, requests } = fakeApi();
    await expect(
      client.ai.commit({
        ...TARGET,
        transactionId: "t",
        requestStatus: "NOT_SENT",
        vendorCost: "1",
      }),
    ).rejects.toThrow("NOT_SENT");
    expect(requests).toHaveLength(0);
  });

  it("commits again without it when the server predates vendorCost (generic 422)", async () => {
    const { client, requests } = fakeApi([
      { status: 422, body: { title: "Unprocessable Entity", status: 422 } },
      { status: 200 },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await client.ai.commit({
        ...TARGET,
        transactionId: "t-old",
        requestStatus: "SUCCESS",
        usage: { inputTokens: 10 },
        vendorCost: "0.0125",
      });
      expect(result.outcome?.status).toBe("COMMITTED");
    } finally {
      warn.mockRestore();
    }
    expect(requests).toHaveLength(2);
    expect(requests[0]!.body.value.vendorCost).toBe("0.0125");
    expect(requests[1]!.body.value).not.toHaveProperty("vendorCost");
    expect(requests[1]!.body.value).toMatchObject({
      transactionId: "t-old",
      usage: { inputTokens: 10 },
    });
  });

  it("does not resend when a current server refuses the value (InvalidAiUsage)", async () => {
    const { client, requests } = fakeApi([
      problem(422, "ReportEntitlementUsageMetric.InvalidAiUsage"),
    ]);
    const failure = await client.ai
      .commit({ ...TARGET, transactionId: "t", requestStatus: "SUCCESS", vendorCost: "1" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(KaitenError);
    expect(failure).not.toBeInstanceOf(AiUsageUnsupportedError);
    expect(requests).toHaveLength(1);
  });

  it("is a reserve-free option: reserve never sends it", async () => {
    const { client, requests } = fakeApi();
    await client.ai.reserve({ ...TARGET, model: "m", requestType: "COMPLETION" });
    expect(requests[0]!.body.value).not.toHaveProperty("vendorCost");
  });

  it("validates like the contract", () => {
    expect(isVendorCost("0")).toBe(true);
    expect(isVendorCost("123456789012.123456789012")).toBe(true);
    expect(isVendorCost("0.1234567890123")).toBe(false);
    expect(isVendorCost(1)).toBe(false);
  });
});

describe("report answers", () => {
  it("surfaces the pricing rule and passes unknown warnings through", async () => {
    const outcome = {
      ...aiOutcome("t"),
      rule: { id: "3a9b8c7d", specificity: "EXACT_TYPED" },
      warnings: ["COUNTER_PRECISION_DEGRADED", "SOMETHING_THE_SDK_DOES_NOT_KNOW"],
    };
    const { client } = fakeApi([{ status: 200, body: { entitlementSlug: "p", ai: outcome } }]);
    const result = await client.ai.commit({
      ...TARGET,
      transactionId: "t",
      requestStatus: "SUCCESS",
    });
    expect(result.outcome?.rule).toEqual({ id: "3a9b8c7d", specificity: "EXACT_TYPED" });
    const warnings: AiUsageWarning[] = result.outcome!.warnings;
    expect(warnings).toEqual(["COUNTER_PRECISION_DEGRADED", "SOMETHING_THE_SDK_DOES_NOT_KNOW"]);
    // An unknown member of a future server is kept, not refused.
    expect(result.entitlementUsage).toMatchObject({ entitlementSlug: "p" });
  });

  it("reads an old server's answer, with no rule and none of the billing members", async () => {
    const old = { entitlementSlug: "p", value: { type: "number", value: 1 }, ai: aiOutcome("t") };
    const { client } = fakeApi([{ status: 200, body: old }]);
    const result = await client.ai.commit({
      ...TARGET,
      transactionId: "t",
      requestStatus: "SUCCESS",
    });
    expect(result.outcome?.rule).toBeUndefined();
    expect(result.entitlementUsage).toEqual(old);
  });
});

describe("ai.release", () => {
  it("sends a NOT_SENT commit without model or usage, and reads NO_RESERVATION", async () => {
    const released = {
      ...aiOutcome("lost-1"),
      status: "RELEASED",
      credits: {},
      warnings: ["NO_RESERVATION"],
    };
    const { client, requests } = fakeApi([
      { status: 200, body: { entitlementSlug: "p", ai: released } },
      problem(409, "ReportEntitlementUsageMetric.TransactionIdReused"),
    ]);
    const result = await client.ai.release({ ...TARGET, transactionId: "lost-1" });
    expect(requests[0]!.body).toEqual({
      value: {
        type: "ai_usage",
        phase: "commit",
        transactionId: "lost-1",
        requestStatus: "NOT_SENT",
      },
    });
    expect(result.outcome?.warnings).toContain("NO_RESERVATION");

    // The tombstone: the late reserve under the same id is refused, never retried.
    await expect(
      client.ai.reserve({
        ...TARGET,
        transactionId: "lost-1",
        model: "m",
        requestType: "COMPLETION",
      }),
    ).rejects.toBeInstanceOf(TransactionIdReusedError);
    expect(requests).toHaveLength(2);
  });
});

const NEW_ROW: AiInference = {
  transactionId: "req-42",
  status: "COMMITTED",
  reportedAt: "2026-11-11T10:00:00Z",
  committedAt: "2026-11-11T10:00:02Z",
  model: "gpt-4o-2024-11-20",
  modelSlug: "gpt-4o",
  requestType: "COMPLETION",
  requestStatus: "SUCCESS",
  usage: { inputTokens: 1000, outputTokens: 800 },
  authorized: true,
  conversionRuleId: "rule-1",
  credits: { reserved: "3.4", computed: "3.4", charged: "3.4", refunded: "1.5" },
  valueBefore: 10,
  valueAfter: 13.4,
  pricing: {
    ruleId: "rule-1",
    specificity: "EXACT_TYPED",
    rates: { perInputToken: "0.001", perOutputToken: "0.003" },
    minimumCreditsPerRequest: "0",
    maximumCreditsPerRequest: "50",
    chargeOnError: "NEVER",
  },
  licenseId: "lic-1",
  licenseSlug: "pro",
  warnings: ["MODEL_DEPRECATED", "PRICING_SNAPSHOT_UNREADABLE"],
  reportSeq: 17,
  vendorCost: { reported: "0.0125", computed: "0.0122", currency: "USD" },
  refunds: [
    {
      id: "rf-1",
      credits: "1.5",
      reason: "duplicate call",
      reportSeq: 18,
      createdAt: "2026-11-11T11:00:00Z",
      createdBy: { id: "u-1", name: "Ada Lovelace" },
    },
  ],
};

/** A row as an older server answers it: none of the explainable members. */
const OLD_ROW = {
  transactionId: "req-1",
  status: "COMMITTED",
  reportedAt: "2026-11-01T10:00:00Z",
  model: "gpt-4o",
  requestType: "COMPLETION",
  usage: {},
  credits: { charged: "1" },
};

describe("inference history", () => {
  it("sends the new filters and returns a new row unchanged", async () => {
    const page = { items: [NEW_ROW], hasMore: true, nextCursor: "c2" };
    const { client, requests } = fakeApi([{ status: 200, body: page }]);
    const result = await client.ai.listInferences(TARGET, {
      authorized: "true",
      modelSlug: "gpt-4o",
      model: "gpt-4o-2024-11-20",
      requestType: "COMPLETION",
      status: "COMMITTED",
      cursor: "c1",
      limit: 50,
    });
    expect(result).toEqual(page);
    const query = requests[0]!.url.searchParams;
    expect(requests[0]!.url.pathname).toBe(
      "/api/instances/acme-prod/entitlements/chat-credits/usage/inferences",
    );
    expect(Object.fromEntries(query)).toEqual({
      authorized: "true",
      modelSlug: "gpt-4o",
      model: "gpt-4o-2024-11-20",
      requestType: "COMPLETION",
      status: "COMMITTED",
      cursor: "c1",
      limit: "50",
    });
  });

  it("gives an old server's rows the arrays the contract requires", async () => {
    const { client } = fakeApi([{ status: 200, body: { items: [OLD_ROW], hasMore: false } }]);
    const page = await client.ai.listInferences(TARGET);
    const row = page.items![0]!;
    expect(row.refunds).toEqual([]);
    expect(row.warnings).toEqual([]);
    expect(row.pricing).toBeUndefined();
    expect(row.credits.refunded).toBeUndefined();
    expect(row).toMatchObject(OLD_ROW);
  });

  it("keeps a null page of items null", async () => {
    const { client } = fakeApi([{ status: 200, body: { items: null, hasMore: false } }]);
    expect(await client.ai.listInferences(TARGET)).toEqual({ items: null, hasMore: false });
  });

  it("lists the organization's inferences with the same cursor convention", async () => {
    const orgRow: OrganizationAiInference = {
      ...NEW_ROW,
      instanceSlug: "acme-prod",
      entitlementSlug: "chat-credits",
    };
    const { client, requests } = fakeApi([
      { status: 200, body: { items: [orgRow, OLD_ROW], hasMore: true, nextCursor: "n" } },
    ]);
    const page = await client.ai.listOrganizationInferences({
      instanceSlug: "acme-prod",
      entitlementSlug: "chat-credits",
      transactionId: "req-42",
      cursor: "c",
      limit: 500,
    });
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.url.pathname).toBe("/api/usage/inferences");
    expect(requests[0]!.url.searchParams.get("instanceSlug")).toBe("acme-prod");
    expect(requests[0]!.url.searchParams.get("cursor")).toBe("c");
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("n");
    expect(page.items![0]).toEqual(orgRow);
    expect(page.items![1]!.refunds).toEqual([]);
  });
});

describe("ai.refund", () => {
  const REFUND = {
    id: "rf-1",
    credits: "3.5",
    reason: "duplicate call",
    reportSeq: 18,
    createdAt: "2026-11-11T11:00:00Z",
    createdBy: { id: "u-1", name: "Ada Lovelace" },
  };

  it("generates one idempotency key and reuses it on retries", async () => {
    const { client, requests } = fakeApi([
      { status: 503 },
      "network",
      { status: 200, body: REFUND },
    ]);
    const refund = await client.ai.refund({
      ...TARGET,
      transactionId: "req-42",
      credits: "3.5",
      reason: "duplicate call",
    });
    expect(refund).toEqual(REFUND);
    expect(requests).toHaveLength(3);
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.url.pathname).toBe(
      "/api/instances/acme-prod/entitlements/chat-credits/usage/inferences/req-42/refund",
    );
    expect(requests[0]!.body).toEqual({ credits: "3.5", reason: "duplicate call" });
    const key = requests[0]!.headers.get("Idempotency-Key")!;
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (const request of requests) {
      expect(request.headers.get("Idempotency-Key")).toBe(key);
      expect(request.text).toBe(requests[0]!.text);
    }
  });

  it("uses the caller's key, and a fresh one per refund otherwise", async () => {
    const { client, requests } = fakeApi([{ status: 200, body: REFUND }]);
    await client.ai.refund({ ...TARGET, transactionId: "t", idempotencyKey: "refund-t-1" });
    await client.ai.refund({ ...TARGET, transactionId: "t" });
    await client.ai.refund({ ...TARGET, transactionId: "t" });
    expect(requests[0]!.headers.get("Idempotency-Key")).toBe("refund-t-1");
    expect(requests[0]!.body).toEqual({});
    expect(requests[1]!.headers.get("Idempotency-Key")).not.toBe(
      requests[2]!.headers.get("Idempotency-Key"),
    );
  });

  it.for([
    [404, "ContextNotFound", AiInferenceNotFoundError],
    [404, "InferenceNotFound", AiInferenceNotFoundError],
    [409, "NotCommitted", AiInferenceNotCommittedError],
    [409, "NothingToRefund", NothingToRefundError],
    [409, "ExceedsRefundable", RefundExceedsRefundableError],
    [409, "IdempotencyKeyReused", RefundIdempotencyKeyReusedError],
    [409, "PoolNotGranted", AiPoolNotGrantedError],
    [422, "IdempotencyKeyRequired", AiRefundError],
    [422, "InvalidIdempotencyKey", AiRefundError],
    [422, "InvalidAmount", AiRefundError],
    [422, "InvalidReason", AiRefundError],
    [409, "SomethingNewer", AiRefundError],
  ] as const)(
    "maps %i RefundAiInference.%s to its typed error, never retried",
    async ([status, reason, type]) => {
      const { client, requests } = fakeApi([
        problem(status, `RefundAiInference.${reason}`, {
          errors: [{ location: "body.credits", message: "left", value: "1.25" }],
        }),
      ]);
      const failure = await client.ai
        .refund({ ...TARGET, transactionId: "t", credits: "9" })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(type);
      expect(failure).toBeInstanceOf(AiRefundError);
      expect(failure).toBeInstanceOf(KaitenError);
      expect((failure as AiRefundError).reason).toBe(reason);
      expect((failure as KaitenError).status).toBe(status);
      expect(requests).toHaveLength(1);
      if (failure instanceof RefundExceedsRefundableError) expect(failure.refundable).toBe("1.25");
    },
  );

  it("leaves a 403 (flag off, missing scope) as the KaitenError it is", async () => {
    const { client } = fakeApi([problem(403, "AIUsage.Disabled")]);
    const failure = await client.ai
      .refund({ ...TARGET, transactionId: "t" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(KaitenError);
    expect(failure).not.toBeInstanceOf(AiRefundError);
  });
});

describe("ai.run", () => {
  const RUN = { ...TARGET, model: "gpt-4o", requestType: "COMPLETION" as const };

  it("commits the vendor cost the reader returns", async () => {
    const { client, requests } = fakeApi();
    await client.ai.run({ ...RUN, vendorCost: (result: { cost: string }) => result.cost }, () => ({
      cost: "0.0042",
    }));
    expect(requests[1]!.body.value).toMatchObject({ phase: "commit", vendorCost: "0.0042" });
  });

  it("commits without it when the reader throws or returns a float, and says so", async () => {
    for (const reader of [
      () => {
        throw new Error("no cost here");
      },
      () => 0.0042 as unknown as string,
    ]) {
      const { client, requests } = fakeApi();
      const onCommitError = vi.fn();
      await expect(
        client.ai.run({ ...RUN, vendorCost: reader, onCommitError }, () => "answer"),
      ).resolves.toBe("answer");
      expect(requests[1]!.body.value).toMatchObject({ phase: "commit", requestStatus: "SUCCESS" });
      expect(requests[1]!.body.value).not.toHaveProperty("vendorCost");
      expect(onCommitError).toHaveBeenCalledOnce();
    }
  });

  it("hands a failed commit to onCommitError with a byte-identical retry", async () => {
    const { client, requests } = fakeApi([
      { status: 200 },
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 200 },
    ]);
    const onCommitError = vi.fn();
    await client.ai.run({ ...RUN, vendorCost: () => "0.010", onCommitError }, () => "answer");
    expect(onCommitError).toHaveBeenCalledOnce();
    const failed = onCommitError.mock.calls[0]![1];
    expect(failed.transactionId).toBe(requests[0]!.body.value.transactionId);
    await failed.retry();
    expect(requests).toHaveLength(6);
    expect(requests[5]!.text).toBe(requests[1]!.text);
    expect(requests[5]!.text).toContain('"vendorCost":"0.010"');
  });

  it("throws NotAnAiCreditPoolError even with onUnsupported: never runs unmetered", async () => {
    const { client } = fakeApi([
      problem(422, "ReportEntitlementUsageMetric.AiUsageUnsupportedEntitlement"),
    ]);
    const onUnsupported = vi.fn();
    const fn = vi.fn(() => "answer");
    await expect(client.ai.run({ ...RUN, onUnsupported }, fn)).rejects.toBeInstanceOf(
      NotAnAiCreditPoolError,
    );
    expect(fn).not.toHaveBeenCalled();
    expect(onUnsupported).not.toHaveBeenCalled();
  });
});

describe("classifyProviderError", () => {
  class APIUserAbortError extends Error {}
  class APIConnectionError extends Error {}
  class APIConnectionTimeoutError extends APIConnectionError {}

  it.for([
    [{ statusCode: 429 }, "CUSTOMER_ERROR"],
    [{ statusCode: 503 }, "PROVIDER_ERROR"],
    [new DOMException("aborted", "AbortError"), "CUSTOMER_ERROR"],
    [new DOMException("deadline", "TimeoutError"), "PROVIDER_ERROR"],
    [new APIUserAbortError("Request was aborted."), "CUSTOMER_ERROR"],
    [new APIConnectionTimeoutError("Request timed out."), "PROVIDER_ERROR"],
    [new APIConnectionError("Connection error."), "NOT_SENT"],
    [undefined, "NOT_SENT"],
  ] as const)("classifies %s as %s", ([error, status]) => {
    expect(classifyProviderError(error)).toBe(status);
  });
});

describe("the meter", () => {
  const reserved = { transactionId: "t" };

  it("throws NotAnAiCreditPoolError on every call instead of degrading", async () => {
    const pool = new NotAnAiCreditPoolError(new KaitenError({ title: "not ai", status: 422 }));
    const reserve = vi.fn(async () => {
      throw pool;
    });
    const meter = createAiMeter({
      kaiten: { ai: { reserve, commit: vi.fn() } } as any,
      ...TARGET,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    for (let i = 0; i < 2; i++) {
      await expect(meter.begin({ model: "m", requestType: "COMPLETION" })).rejects.toBe(pool);
    }
    expect(meter.degraded).toBe(false);
    expect(reserve).toHaveBeenCalledTimes(2);
  });

  it("commits a vendor cost, drops it on NOT_SENT, and surfaces a failed commit", async () => {
    const commit = vi.fn(async (_input: unknown) => ({}));
    const onCommitError = vi.fn();
    const meter = createAiMeter({
      kaiten: { ai: { reserve: vi.fn(async () => reserved), commit } } as any,
      ...TARGET,
      onCommitError,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    await (
      await meter.begin({ model: "m", requestType: "COMPLETION" })
    ).settle("SUCCESS", { inputTokens: 1 }, { vendorCost: "0.5" });
    expect(commit.mock.calls[0]![0]).toMatchObject({ vendorCost: "0.5" });
    await (
      await meter.begin({ model: "m", requestType: "COMPLETION" })
    ).settle("NOT_SENT", { inputTokens: 1 }, { vendorCost: "0.5" });
    expect(commit.mock.calls[1]![0]).not.toHaveProperty("vendorCost");
    expect(commit.mock.calls[1]![0]).toMatchObject({ requestStatus: "NOT_SENT", usage: undefined });

    commit.mockRejectedValueOnce(new Error("commit down"));
    await (await meter.begin({ model: "m", requestType: "COMPLETION" })).settle("SUCCESS");
    expect(onCommitError).toHaveBeenCalledOnce();
    const failed = onCommitError.mock.calls[0]![1];
    expect(failed.input).toMatchObject({ transactionId: "t", requestStatus: "SUCCESS" });
    await failed.retry();
    expect(commit).toHaveBeenCalledTimes(4);
    expect(commit.mock.calls[3]![0]).toBe(failed.input);
  });

  it("never lets a vendor-cost reader block the commit", () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const input = {
      model: "m",
      requestStatus: "SUCCESS" as const,
      usage: undefined,
      rawUsage: { cost: 0.1 },
      response: undefined,
    };
    expect(readVendorCost(() => "0.1", input, logger)).toBe("0.1");
    expect(
      readVendorCost(
        () => {
          throw new Error("x");
        },
        input,
        logger,
      ),
    ).toBeUndefined();
    expect(readVendorCost(() => String(1e-7), input, logger)).toBeUndefined();
    expect(
      readVendorCost(() => "0.1", { ...input, requestStatus: "NOT_SENT" }, logger),
    ).toBeUndefined();
    expect(readVendorCost(undefined, input, logger)).toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
