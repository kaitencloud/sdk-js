// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import Anthropic from "@anthropic-ai/sdk";
import { expect, it, vi } from "vite-plus/test";
import { wrapAnthropic } from "../src/index.ts";

function setup(streamed: boolean) {
  const reserve = vi.fn(async () => ({ transactionId: "t" }));
  const commit = vi.fn(async (_input: unknown) => ({}));
  const message = {
    id: "synthetic",
    type: "message",
    role: "assistant",
    model: "synthetic-model",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 1,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 2,
    },
  };
  const events = [
    { type: "message_start", message },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "synthetic" } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 7 },
    },
    { type: "message_stop" },
  ];
  const fetch = vi.fn(
    async () =>
      new Response(
        streamed
          ? events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("")
          : JSON.stringify(message),
        { headers: { "content-type": streamed ? "text/event-stream" : "application/json" } },
      ),
  );
  const original = new Anthropic({ apiKey: "synthetic", fetch, maxRetries: 0 });
  const client = wrapAnthropic(original, {
    kaiten: { ai: { reserve, commit } } as any,
    instance: "i",
    pool: "p",
  });
  return { client, reserve, commit, fetch, original };
}
it("meters actual messages.create and preserves the raw response", async () => {
  const { client, commit } = setup(false);
  const result = await client.messages
    .create({ model: "synthetic-model", max_tokens: 10, messages: [] })
    .withResponse();
  expect(result.response.status).toBe(200);
  expect(commit.mock.calls[0]![0]).toMatchObject({
    usage: { inputTokens: 10, cacheReadInputTokens: 5, cacheWriteInputTokens: 2, outputTokens: 1 },
  });
});
it("preserves synchronous MessageStream, finalMessage and merged usage", async () => {
  const { client, reserve, commit, fetch } = setup(true);
  const stream = client.messages.stream({ model: "synthetic-model", max_tokens: 10, messages: [] });
  expect(typeof stream.finalMessage).toBe("function");
  const message = await stream.finalMessage();
  expect(message.usage.output_tokens).toBe(7);
  expect(reserve).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0]![0]).toMatchObject({
    requestStatus: "SUCCESS",
    usage: { inputTokens: 10, cacheReadInputTokens: 5, outputTokens: 7 },
  });
});
it("accounts raw-stream abandonment and refuses before fetch", async () => {
  const { client, commit, reserve, fetch } = setup(true);
  const stream = await client.messages.create({
    model: "synthetic-model",
    max_tokens: 10,
    messages: [],
    stream: true,
  });
  for await (const _ of stream) break;
  expect(commit.mock.calls[0]![0]).toMatchObject({
    requestStatus: "CUSTOMER_ERROR",
    usage: { inputTokens: 10 },
  });
  reserve.mockRejectedValueOnce(new Error("refused"));
  await expect(
    client.messages.create({ model: "synthetic-model", max_tokens: 10, messages: [] }),
  ).rejects.toThrow("refused");
  expect(fetch).toHaveBeenCalledOnce();
});

it("preserves bound unlisted methods and settles synchronous helper abort", async () => {
  const { client, original, commit } = setup(true);
  expect(client.beta).toBe(original.beta);
  const helper = client.messages.stream({ model: "synthetic-model", max_tokens: 10, messages: [] });
  helper.on("text", () => helper.abort());
  await expect(helper.finalMessage()).rejects.toThrow();
  expect(commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "CUSTOMER_ERROR" });
});

it("degrades unsupported reporting without changing the synchronous helper API", async () => {
  const { client, reserve, commit } = setup(true);
  const { AiUsageUnsupportedError } = await import("@kaitencloud/client/ai");
  reserve.mockRejectedValueOnce(
    new AiUsageUnsupportedError({ status: 422, message: "synthetic unsupported" } as any),
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (let i = 0; i < 2; i++)
      await client.messages
        .stream({ model: "synthetic-model", max_tokens: 10, messages: [] })
        .finalMessage();
    expect(reserve).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});
