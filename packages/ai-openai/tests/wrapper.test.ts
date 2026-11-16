// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import OpenAI from "openai";
import { describe, expect, it, vi } from "vite-plus/test";
import { AiUsageUnsupportedError } from "@kaitencloud/client/ai";
import { wrapOpenAI } from "../src/index.ts";

function setup(response: () => Response) {
  const reserve = vi.fn(async (_input: unknown) => ({ transactionId: "t" }));
  const commit = vi.fn(async (_input: unknown) => ({}));
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
  const logger = { warn: vi.fn(), error: vi.fn() };
  const client = new OpenAI({ apiKey: "synthetic", fetch, maxRetries: 0 });
  const wrapped = wrapOpenAI(client, {
    kaiten: { ai: { reserve, commit } } as any,
    instance: "i",
    entitlement: "p",
    logger,
  });
  return { wrapped, reserve, commit, fetch, logger, client };
}
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
const sse = (...chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });

describe("installed OpenAI client", () => {
  it("meters create and retains withResponse and bound unlisted methods", async () => {
    const { wrapped, reserve, commit, client } = setup(() =>
      json({
        id: "synthetic",
        choices: [],
        usage: { prompt_tokens: 9, completion_tokens: 4 },
      }),
    );
    expect(wrapped.models).toBe(client.models);
    // oxlint-disable-next-line typescript/unbound-method -- testing cached binding identity
    expect(wrapped.chat.completions.create).toBe(wrapped.chat.completions.create);
    const { data, response } = await wrapped.chat.completions
      .create({
        model: "synthetic-model",
        messages: [],
      })
      .withResponse();
    expect(data.id).toBe("synthetic");
    expect(response.status).toBe(200);
    expect(reserve).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]![0]).toMatchObject({
      requestStatus: "SUCCESS",
      usage: { inputTokens: 9, outputTokens: 4 },
    });
  });
  it("forces usage, hides the extra chunk and commits on stream completion", async () => {
    const { wrapped, commit, fetch } = setup(() =>
      sse(
        { id: "s", choices: [{ delta: { content: "synthetic" }, index: 0 }] },
        { id: "s", choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } },
      ),
    );
    const stream = await wrapped.chat.completions.create({
      model: "synthetic-model",
      messages: [],
      stream: true,
    });
    expect(commit).not.toHaveBeenCalled();
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    expect(chunks).toHaveLength(1);
    expect(commit.mock.calls[0]![0]).toMatchObject({
      requestStatus: "SUCCESS",
      usage: { outputTokens: 3 },
    });
    const request = fetch.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(request.body as string).stream_options.include_usage).toBe(true);
  });
  it("settles abandonment without turning it into success", async () => {
    const { wrapped, commit } = setup(() =>
      sse({ choices: [{ delta: { content: "synthetic" } }] }),
    );
    const stream = await wrapped.chat.completions.create({
      model: "synthetic-model",
      messages: [],
      stream: true,
    });
    for await (const _ of stream) break;
    expect(commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "CUSTOMER_ERROR" });
  });
  it("never calls provider after reserve refusal", async () => {
    const { wrapped, reserve, fetch } = setup(() => json({}));
    reserve.mockRejectedValueOnce(new Error("refused"));
    await expect(
      wrapped.embeddings.create({ model: "synthetic-model", input: "synthetic" }),
    ).rejects.toThrow("refused");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("degrades once and preserves provider errors", async () => {
    const { wrapped, reserve, commit, logger } = setup(() => new Response("{}", { status: 500 }));
    reserve.mockRejectedValueOnce(
      new AiUsageUnsupportedError({ status: 422, message: "unsupported" } as any),
    );
    for (let i = 0; i < 2; i++)
      await expect(
        wrapped.embeddings.create({ model: "synthetic-model", input: "synthetic" }),
      ).rejects.toThrow();
    expect(reserve).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });
});

it("meters every other allow-listed method with the installed SDK", async () => {
  const cases = [
    {
      call: (c: OpenAI) => c.responses.create({ model: "synthetic-model", input: "synthetic" }),
      reply: () => json({ id: "s", usage: { input_tokens: 10, output_tokens: 7 } }),
      type: "COMPLETION",
      usage: { inputTokens: 10, outputTokens: 7 },
    },
    {
      call: (c: OpenAI) => c.embeddings.create({ model: "synthetic-model", input: "synthetic" }),
      reply: () => json({ data: [], usage: { prompt_tokens: 10 } }),
      type: "EMBEDDING",
      usage: { inputTokens: 10 },
    },
    {
      call: (c: OpenAI) => c.images.generate({ model: "synthetic-model", prompt: "synthetic" }),
      reply: () => json({ data: [{}] }),
      type: "IMAGE_GENERATION",
      usage: { units: "1", unitType: "image" },
    },
    {
      call: (c: OpenAI) =>
        c.audio.transcriptions.create({
          model: "synthetic-model",
          file: new File(["synthetic"], "synthetic.wav"),
        }),
      reply: () => json({ text: "synthetic", usage: { type: "duration", seconds: 2 } }),
      type: "AUDIO",
      usage: { durationMs: 2000 },
    },
    {
      call: (c: OpenAI) =>
        c.audio.speech.create({ model: "synthetic-model", input: "synthetic", voice: "alloy" }),
      reply: () => new Response("synthetic", { headers: { "content-type": "audio/mpeg" } }),
      type: "AUDIO",
      usage: undefined,
    },
  ];
  for (const item of cases) {
    const { wrapped, reserve, commit } = setup(item.reply);
    await item.call(wrapped);
    expect(reserve.mock.calls[0]?.[0]).toMatchObject({ requestType: item.type });
    expect(commit.mock.calls[0]?.[0]).toMatchObject({ requestStatus: "SUCCESS" });
    expect((commit.mock.calls[0]![0] as any).usage).toEqual(item.usage);
  }
});

it("reports Responses stream completion usage", async () => {
  const { wrapped, commit } = setup(() =>
    sse({
      type: "response.completed",
      response: {
        id: "s",
        usage: { input_tokens: 17, input_tokens_details: { cached_tokens: 5 }, output_tokens: 7 },
      },
    }),
  );
  const stream = await wrapped.responses.create({
    model: "synthetic-model",
    input: "synthetic",
    stream: true,
  });
  for await (const _ of stream) {
  }
  expect(commit.mock.calls[0]![0]).toMatchObject({
    requestStatus: "SUCCESS",
    usage: { inputTokens: 12, cacheReadInputTokens: 5, outputTokens: 7 },
  });
});

it("settles provider HTTP and connection errors and logs failed commits without losing data", async () => {
  const http = setup(() => new Response("{}", { status: 500 }));
  await expect(
    http.wrapped.embeddings.create({ model: "synthetic-model", input: "synthetic" }),
  ).rejects.toThrow();
  expect(http.commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "PROVIDER_ERROR" });
  const network = setup(() => {
    throw new TypeError("synthetic connection failure");
  });
  await expect(
    network.wrapped.embeddings.create({ model: "synthetic-model", input: "synthetic" }),
  ).rejects.toThrow();
  expect(network.commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "NOT_SENT" });
  const successful = setup(() => json({ id: "synthetic", data: [], usage: { prompt_tokens: 10 } }));
  successful.commit.mockRejectedValueOnce(new Error("synthetic commit failure"));
  await expect(
    successful.wrapped.embeddings.create({ model: "synthetic-model", input: "synthetic" }),
  ).resolves.toMatchObject({ id: "synthetic" });
  expect(successful.logger.error).toHaveBeenCalledOnce();
});

describe("vendor cost and failure paths", () => {
  it("commits the cost a gateway reports, as given, and never invents one", async () => {
    const reply = () =>
      json({
        id: "s",
        choices: [],
        usage: { prompt_tokens: 9, completion_tokens: 4, cost: "0.0042" },
      });
    const vendorCost = vi.fn(
      ({ rawUsage }: { rawUsage: unknown }) => (rawUsage as { cost?: string }).cost,
    );
    const { client, reserve, commit } = setup(reply);
    const wrapped = wrapOpenAI(client, {
      kaiten: { ai: { reserve, commit } } as any,
      instance: "i",
      entitlement: "p",
      vendorCost,
    });
    await wrapped.chat.completions.create({ model: "synthetic-model", messages: [] });
    expect(commit.mock.calls[0]![0]).toMatchObject({
      requestStatus: "SUCCESS",
      vendorCost: "0.0042",
    });
    expect(vendorCost.mock.calls[0]![0]).toMatchObject({
      model: "synthetic-model",
      requestStatus: "SUCCESS",
    });

    // Without a reader, nothing is sent.
    const plain = setup(reply);
    await plain.wrapped.chat.completions.create({ model: "synthetic-model", messages: [] });
    expect(plain.commit.mock.calls[0]![0]).not.toHaveProperty("vendorCost");
  });

  it("still commits, and returns the answer, when the cost reader throws", async () => {
    const { client, reserve, commit, logger } = setup(() =>
      json({ id: "s", data: [], usage: { prompt_tokens: 3 } }),
    );
    const wrapped = wrapOpenAI(client, {
      kaiten: { ai: { reserve, commit } } as any,
      instance: "i",
      entitlement: "p",
      logger,
      vendorCost: () => {
        throw new Error("synthetic reader bug");
      },
    });
    await expect(
      wrapped.embeddings.create({ model: "synthetic-model", input: "x" }),
    ).resolves.toMatchObject({ id: "s" });
    expect(commit.mock.calls[0]![0]).toMatchObject({
      requestStatus: "SUCCESS",
      usage: { inputTokens: 3 },
    });
    expect(commit.mock.calls[0]![0]).not.toHaveProperty("vendorCost");
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("reads a streamed cost from the usage chunk", async () => {
    const { client, reserve, commit } = setup(() =>
      sse(
        { id: "s", choices: [{ delta: { content: "x" }, index: 0 }] },
        { id: "s", choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, cost: "0.5" } },
      ),
    );
    const wrapped = wrapOpenAI(client, {
      kaiten: { ai: { reserve, commit } } as any,
      instance: "i",
      entitlement: "p",
      vendorCost: ({ rawUsage }) => (rawUsage as { cost?: string } | undefined)?.cost,
    });
    const stream = await wrapped.chat.completions.create({
      model: "synthetic-model",
      messages: [],
      stream: true,
    });
    for await (const _ of stream) {
    }
    expect(commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "SUCCESS", vendorCost: "0.5" });
  });

  it("settles a stream closed before its first event as sent, never NOT_SENT", async () => {
    const { wrapped, commit } = setup(() =>
      sse({ id: "s", choices: [{ delta: { content: "x" }, index: 0 }] }),
    );
    const stream = await wrapped.chat.completions.create({
      model: "synthetic-model",
      messages: [],
      stream: true,
    });
    await stream[Symbol.asyncIterator]().return?.(undefined);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "CUSTOMER_ERROR" });
  });

  it("settles a caller's abort as CUSTOMER_ERROR, not NOT_SENT", async () => {
    const controller = new AbortController();
    const { wrapped, commit } = setup(() => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      wrapped.embeddings.create(
        { model: "synthetic-model", input: "x" },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "CUSTOMER_ERROR" });
  });

  it("hands a failed commit to onCommitError with a retry", async () => {
    const { client, reserve, commit, logger } = setup(() =>
      json({ id: "s", data: [], usage: { prompt_tokens: 3 } }),
    );
    const onCommitError = vi.fn();
    const wrapped = wrapOpenAI(client, {
      kaiten: { ai: { reserve, commit } } as any,
      instance: "i",
      entitlement: "p",
      logger,
      onCommitError,
    });
    commit.mockRejectedValueOnce(new Error("synthetic commit failure"));
    await expect(
      wrapped.embeddings.create({ model: "synthetic-model", input: "x" }),
    ).resolves.toMatchObject({ id: "s" });
    expect(onCommitError).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
    const failed = onCommitError.mock.calls[0]![1];
    expect(failed.transactionId).toBe("t");
    await failed.retry();
    expect(commit.mock.calls[1]![0]).toEqual(commit.mock.calls[0]![0]);
  });

  it("refuses every call on a pool that is not an AI credit pool", async () => {
    const { NotAnAiCreditPoolError, KaitenError } = await import("@kaitencloud/client/ai").then(
      async (ai) => ({ ...ai, KaitenError: (await import("@kaitencloud/client")).KaitenError }),
    );
    const { wrapped, reserve, fetch } = setup(() => json({}));
    reserve.mockRejectedValue(
      new NotAnAiCreditPoolError(new KaitenError({ title: "not ai", status: 422 })),
    );
    for (let i = 0; i < 2; i++) {
      await expect(
        wrapped.embeddings.create({ model: "synthetic-model", input: "x" }),
      ).rejects.toBeInstanceOf(NotAnAiCreditPoolError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
