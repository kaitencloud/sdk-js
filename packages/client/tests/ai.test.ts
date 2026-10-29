// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vite-plus/test";

import {
  AiUsageUnsupportedError,
  InsufficientCreditsError,
  KaitenClient,
  KaitenError,
  ModelNotAuthorizedError,
  TransactionIdReusedError,
  UnknownModelError,
  classifyProviderError,
  estimateTokens,
  fromAnthropic,
  fromOpenAI,
  uuidv7,
} from "../src/index.ts";
import type { KaitenFetch } from "../src/index.ts";

interface Reply {
  status: number;
  body?: unknown;
}

/** A Kaiten API double: records every request and answers from a script. */
function fakeApi(replies: (Reply | "network")[] = []) {
  const requests: { url: string; headers: Headers; body: any }[] = [];
  let call = 0;
  const fetch: KaitenFetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const body = await request.text();
    requests.push({
      url: request.url,
      headers: request.headers,
      body: body ? JSON.parse(body) : undefined,
    });
    const reply = replies[Math.min(call, replies.length - 1)] ?? { status: 200 };
    call += 1;
    if (reply === "network") throw new TypeError("fetch failed");
    const answer =
      reply.body ??
      (reply.status === 200
        ? {
            entitlementSlug: "chat-credits",
            ai: { transactionId: JSON.parse(body).value.transactionId },
          }
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

const problem = (status: number, code: string): Reply => ({
  status,
  body: { title: code, status, code: `ReportEntitlementUsageMetric.${code}` },
});

const TARGET = { instance: "acme-prod", entitlement: "chat-credits" };

describe("ai.reserve and ai.commit", () => {
  it("sends the reserve variant on the usage route, keyed", async () => {
    const { client, requests } = fakeApi();

    const result = await client.ai.reserve({
      ...TARGET,
      model: "gpt-4o",
      requestType: "COMPLETION",
      usage: { inputTokens: 1000, outputTokens: 4000 },
      ttlSeconds: 600,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      "https://kaiten.test/api/instances/acme-prod/entitlements/chat-credits/usage",
    );
    expect(requests[0]!.body).toEqual({
      value: {
        type: "ai_usage",
        phase: "reserve",
        transactionId: result.transactionId,
        model: "gpt-4o",
        requestType: "COMPLETION",
        usage: { inputTokens: 1000, outputTokens: 4000 },
        ttlSeconds: 600,
      },
    });
    expect(result.transactionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(requests[0]!.headers.has("Idempotency-Key")).toBe(false);
    expect(result.outcome?.transactionId).toBe(result.transactionId);
  });

  it("sends only what the reservation does not know on commit", async () => {
    const { client, requests } = fakeApi();

    await client.ai.commit({
      ...TARGET,
      transactionId: "01JB2K7Z9Q",
      requestStatus: "SUCCESS",
      usage: { inputTokens: 1000, outputTokens: 400 },
    });

    expect(requests[0]!.body).toEqual({
      value: {
        type: "ai_usage",
        phase: "commit",
        transactionId: "01JB2K7Z9Q",
        requestStatus: "SUCCESS",
        usage: { inputTokens: 1000, outputTokens: 400 },
      },
    });
  });

  it("retries an identical commit three times under its transactionId, then gives up", async () => {
    const { client, requests } = fakeApi([
      { status: 503 },
      "network",
      { status: 502 },
      { status: 500 },
    ]);

    await expect(
      client.ai.commit({ ...TARGET, transactionId: "t-1", requestStatus: "SUCCESS" }),
    ).rejects.toBeInstanceOf(KaitenError);

    expect(requests).toHaveLength(4);
    expect(requests.every((request) => !request.headers.has("Idempotency-Key"))).toBe(true);
    for (const request of requests) expect(request.body).toEqual(requests[0]!.body);
    expect(new Set(requests.map((request) => request.body.value.transactionId))).toEqual(
      new Set(["t-1"]),
    );
  });

  it("pairs reserve and commit by transactionId without an inherited numeric-report header", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      expect(request.headers.has("Idempotency-Key")).toBe(false);
      const body = JSON.parse(await request.text());
      expect(body.value.transactionId).toBe("a");
      return new Response(JSON.stringify({ ai: { transactionId: "a" } }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = new KaitenClient({
      authScheme: "none",
      apiUrl: "https://kaiten.test/api",
      defaultHeaders: { "idempotency-key": "numeric-report-key" },
      fetch,
    });
    await client.ai.reserve({
      ...TARGET,
      transactionId: "a",
      model: "gpt-4o",
      requestType: "COMPLETION",
    });
    await client.ai.commit({ ...TARGET, transactionId: "a", requestStatus: "SUCCESS" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.for([400, 404, 409, 422, 501])("never replays a %i", async (status) => {
    const { client, requests } = fakeApi([{ status, body: { title: "no", status } }]);
    await expect(
      client.ai.commit({ ...TARGET, transactionId: "t-1", requestStatus: "SUCCESS" }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it.for([
    [problem(409, "ThresholdExceeded"), InsufficientCreditsError],
    [problem(409, "TransactionIdReused"), TransactionIdReusedError],
    [problem(422, "ModelNotAuthorized"), ModelNotAuthorizedError],
    [problem(422, "UnknownModel"), UnknownModelError],
    [problem(422, "AiUsageUnsupportedEntitlement"), AiUsageUnsupportedError],
    // An older server that does not know `ai_usage` answers huma's generic 422.
    [
      { status: 422, body: { title: "Unprocessable Entity", status: 422 } },
      AiUsageUnsupportedError,
    ],
    [problem(422, "InvalidValueType"), AiUsageUnsupportedError],
  ] as const)("maps %j to its typed error", async ([reply, type]) => {
    const { client } = fakeApi([reply]);
    const failure = await client.ai
      .reserve({ ...TARGET, model: "gpt-4o", requestType: "COMPLETION" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(type);
    expect(failure).toBeInstanceOf(KaitenError);
    expect((failure as KaitenError).status).toBe(reply.status);
  });

  it.for(["InvalidTransactionId", "AiIdempotencyKeyUnsupported"])(
    "leaves a malformed-body 422 %s as the KaitenError it is",
    async (code) => {
      const { client } = fakeApi([problem(422, code)]);
      const failure = await client.ai
        .commit({ ...TARGET, transactionId: "bad id", requestStatus: "SUCCESS" })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(KaitenError);
      expect(failure).not.toBeInstanceOf(AiUsageUnsupportedError);
      expect((failure as KaitenError).code).toBe(`ReportEntitlementUsageMetric.${code}`);
    },
  );
});

describe("ai.run", () => {
  const RUN = { ...TARGET, model: "gpt-4o", requestType: "COMPLETION" as const };

  it("reserves, runs, and commits the real usage under one transactionId", async () => {
    const { client, requests } = fakeApi();

    const result = await client.ai.run(
      {
        ...RUN,
        estimate: { inputTokens: 10, outputTokens: 100 },
        usage: (r: { n: number }) => ({ outputTokens: r.n }),
      },
      async ({ transactionId }) => ({ n: 42, transactionId }),
    );

    expect(requests.map((request) => request.body.value.phase)).toEqual(["reserve", "commit"]);
    expect(requests[1]!.body.value).toEqual({
      type: "ai_usage",
      phase: "commit",
      transactionId: result.transactionId,
      requestStatus: "SUCCESS",
      usage: { outputTokens: 42 },
    });
    expect(requests[0]!.body.value.transactionId).toBe(result.transactionId);
  });

  it("commits NOT_SENT, and nothing else, when the provider was never reached", async () => {
    const { client, requests } = fakeApi();
    const boom = new TypeError("connect ECONNREFUSED");

    await expect(
      client.ai.run(RUN, (context) => {
        context.setUsage({ inputTokens: 5 });
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(requests[1]!.body.value).toMatchObject({ phase: "commit", requestStatus: "NOT_SENT" });
    expect(requests[1]!.body.value.usage).toBeUndefined();
  });

  it("commits the known usage with the provider's error class", async () => {
    const { client, requests } = fakeApi();
    const providerError = Object.assign(new Error("overloaded"), { status: 529 });

    await expect(
      client.ai.run(RUN, (context) => {
        context.setUsage({ inputTokens: 5, outputTokens: 2 });
        throw providerError;
      }),
    ).rejects.toBe(providerError);

    expect(requests[1]!.body.value).toMatchObject({
      requestStatus: "PROVIDER_ERROR",
      usage: { inputTokens: 5, outputTokens: 2 },
    });
  });

  it("never calls fn when the reserve is refused", async () => {
    const { client, requests } = fakeApi([problem(409, "ThresholdExceeded")]);
    const fn = vi.fn();

    await expect(client.ai.run(RUN, fn)).rejects.toBeInstanceOf(InsufficientCreditsError);

    expect(fn).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it("degrades to an unreported call when asked to and the server cannot take the variant", async () => {
    const { client, requests } = fakeApi([
      { status: 422, body: { title: "Unprocessable", status: 422 } },
    ]);
    const onUnsupported = vi.fn();

    const result = await client.ai.run({ ...RUN, onUnsupported }, () => "answer");

    expect(result).toBe("answer");
    expect(onUnsupported).toHaveBeenCalledOnce();
    expect(onUnsupported.mock.calls[0]![0]).toBeInstanceOf(AiUsageUnsupportedError);
    expect(requests).toHaveLength(1);
  });

  it.for([undefined, { inputTokens: 5, outputTokens: 2 }])(
    "settles successful provider usage when the extractor throws (known: %j)",
    async (known) => {
      const { client, requests } = fakeApi();
      const boom = new Error("usage extractor failed");
      const classifyError = vi.fn(() => "NOT_SENT" as const);
      const onCommitError = vi.fn();
      const result = { answer: "provider succeeded" };

      await expect(
        client.ai.run(
          {
            ...RUN,
            classifyError,
            onCommitError,
            usage: () => {
              throw boom;
            },
          },
          (context) => {
            if (known) context.setUsage(known);
            return result;
          },
        ),
      ).resolves.toBe(result);

      expect(requests.map((request) => request.body.value.phase)).toEqual(["reserve", "commit"]);
      expect(requests[1]!.body.value.requestStatus).toBe("SUCCESS");
      expect(requests[1]!.body.value.usage).toEqual(known);
      expect(requests[1]!.body.value.transactionId).toBe(requests[0]!.body.value.transactionId);
      expect(classifyError).not.toHaveBeenCalled();
      expect(onCommitError).toHaveBeenCalledExactlyOnceWith(boom);
    },
  );

  it("returns the provider result when extraction and settlement both fail", async () => {
    const { client, requests } = fakeApi([{ status: 200 }, { status: 503 }]);
    const boom = new Error("usage extractor failed");
    const onCommitError = vi.fn();

    await expect(
      client.ai.run(
        {
          ...RUN,
          onCommitError,
          usage: () => {
            throw boom;
          },
        },
        () => "provider succeeded",
      ),
    ).resolves.toBe("provider succeeded");

    expect(requests).toHaveLength(5);
    expect(onCommitError).toHaveBeenCalledTimes(2);
    expect(onCommitError.mock.calls[0]![0]).toBe(boom);
    expect(onCommitError.mock.calls[1]![0]).toBeInstanceOf(KaitenError);
    expect(
      requests.slice(1).every((request) => request.body.value.requestStatus === "SUCCESS"),
    ).toBe(true);
    expect(
      new Set(requests.slice(1).map((request) => request.headers.get("Idempotency-Key"))).size,
    ).toBe(1);
  });

  it("returns the result when the commit gives up, and reports it", async () => {
    const { client, requests } = fakeApi([{ status: 200 }, { status: 503 }]);
    const onCommitError = vi.fn();

    await expect(client.ai.run({ ...RUN, onCommitError }, () => "ok")).resolves.toBe("ok");

    expect(requests).toHaveLength(5);
    expect(onCommitError).toHaveBeenCalledOnce();
  });
});

describe("normalisers", () => {
  it("subtracts OpenAI's cached tokens out of the input", () => {
    expect(
      fromOpenAI({
        prompt_tokens: 1000,
        completion_tokens: 300,
        prompt_tokens_details: { cached_tokens: 600 },
        completion_tokens_details: { reasoning_tokens: 200 },
      }),
    ).toEqual({ inputTokens: 400, cacheReadInputTokens: 600, outputTokens: 300 });
  });

  it("reads the Responses shape, cache writes included", () => {
    expect(
      fromOpenAI({
        input_tokens: 15000,
        input_tokens_details: { cached_tokens: 12000, cache_write_tokens: 3000 },
        output_tokens: 150,
        output_tokens_details: { reasoning_tokens: 100 },
      }),
    ).toEqual({
      inputTokens: 0,
      cacheReadInputTokens: 12000,
      cacheWriteInputTokens: 3000,
      outputTokens: 150,
    });
  });

  it("clamps a negative difference to 0", () => {
    expect(
      fromOpenAI({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 50 } }),
    ).toMatchObject({
      inputTokens: 0,
    });
  });

  it("reads an embedding and a duration-billed transcription", () => {
    expect(fromOpenAI({ prompt_tokens: 8, total_tokens: 8 })).toEqual({ inputTokens: 8 });
    expect(fromOpenAI({ type: "duration", seconds: 12.5 })).toEqual({ durationMs: 12500 });
  });

  it("maps Anthropic's disjoint fields one to one", () => {
    expect(
      fromAnthropic({
        input_tokens: 20,
        cache_read_input_tokens: 1800,
        cache_creation_input_tokens: 400,
        output_tokens: 512,
        server_tool_use: null,
      }),
    ).toEqual({
      inputTokens: 20,
      cacheReadInputTokens: 1800,
      cacheWriteInputTokens: 400,
      outputTokens: 512,
    });
  });

  it("leaves what the provider did not send absent", () => {
    expect(fromAnthropic({ output_tokens: 7, cache_read_input_tokens: null })).toEqual({
      outputTokens: 7,
    });
    expect(fromOpenAI(undefined)).toEqual({});
  });
});

describe("helpers", () => {
  it("orders UUIDv7s by time", () => {
    const early = uuidv7(1_700_000_000_000);
    const late = uuidv7(1_700_000_000_001);
    expect(early < late).toBe(true);
    expect(early.slice(14, 15)).toBe("7");
  });

  it("estimates bytes / 4 and counts an inline blob flat", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    const image = `data:image/png;base64,${"A".repeat(400_000)}`;
    expect(estimateTokens({ content: [{ image_url: { url: image } }] })).toBeLessThan(1100);
  });

  it.for([
    [new TypeError("fetch failed"), "NOT_SENT"],
    [{ status: 429 }, "CUSTOMER_ERROR"],
    [{ status: 400 }, "CUSTOMER_ERROR"],
    [{ status: 500 }, "PROVIDER_ERROR"],
  ] as const)("classifies %j as %s", ([error, status]) => {
    expect(classifyProviderError(error)).toBe(status);
  });
});
