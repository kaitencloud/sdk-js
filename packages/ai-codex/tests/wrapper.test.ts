// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Thread, ThreadEvent } from "@openai/codex-sdk";
import { expect, it, vi } from "vite-plus/test";
import { wrapCodexThread } from "../src/index.ts";

it("gates submitted prompts, not fabricated internal turns, and preserves refusal", async () => {
  const reserve = vi.fn(async (_input: unknown) => ({ transactionId: "t" }));
  const commit = vi.fn(async (_input: unknown) => ({}));
  const usage = {
    input_tokens: 17,
    cached_input_tokens: 5,
    cache_write_input_tokens: 2,
    output_tokens: 7,
    reasoning_output_tokens: 3,
  };
  const run = vi.fn(async () => ({ items: [], finalResponse: "synthetic", usage }));
  const thread = wrapCodexThread({ run } as unknown as Thread, {
    kaiten: { ai: { reserve, commit } } as any,
    instance: "i",
    entitlement: "p",
    model: "synthetic-model",
  });
  await thread.run("synthetic");
  expect(commit.mock.calls[0]![0]).toMatchObject({ usage: { inputTokens: 10, outputTokens: 7 } });
  reserve.mockRejectedValueOnce(new Error("refused"));
  await expect(thread.run("synthetic")).rejects.toThrow("refused");
  expect(run).toHaveBeenCalledOnce();
});
it("preserves streamed events and reports aggregate completion usage", async () => {
  const reserve = vi.fn(async () => ({ transactionId: "t" }));
  const commit = vi.fn(async (_input: unknown) => ({}));
  const events: ThreadEvent[] = [
    { type: "turn.started" },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 7,
        reasoning_output_tokens: 3,
      },
    },
  ];
  async function* source() {
    yield* events;
  }
  const runStreamed = vi.fn(async () => ({ events: source() }));
  const thread = wrapCodexThread({ runStreamed } as unknown as Thread, {
    kaiten: { ai: { reserve, commit } } as any,
    instance: "i",
    entitlement: "p",
    model: "synthetic-model",
  });
  const result = await thread.runStreamed("synthetic");
  const output = [];
  for await (const e of result.events) output.push(e);
  expect(output).toEqual(events);
  expect(commit.mock.calls[0]![0]).toMatchObject({
    requestStatus: "SUCCESS",
    usage: { outputTokens: 7 },
  });
});

it("settles a turn that fails mid-stream as the provider's, and an aborted run as the caller's", async () => {
  const reserve = vi.fn(async () => ({ transactionId: "t" }));
  const commit = vi.fn(async (_input: unknown) => ({}));
  async function* failing(): AsyncGenerator<ThreadEvent> {
    yield { type: "turn.started" };
    throw new Error("agent crashed");
  }
  const runStreamed = vi.fn(async () => ({ events: failing() }));
  const run = vi.fn(async () => {
    throw new DOMException("aborted", "AbortError");
  });
  const thread = wrapCodexThread({ run, runStreamed } as unknown as Thread, {
    kaiten: { ai: { reserve, commit } } as any,
    instance: "i",
    entitlement: "p",
    model: "synthetic-model",
  });
  const { events } = await thread.runStreamed("synthetic");
  await expect(
    (async () => {
      for await (const _ of events) {
      }
    })(),
  ).rejects.toThrow("agent crashed");
  expect(commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "PROVIDER_ERROR" });
  await expect(thread.run("synthetic")).rejects.toThrow();
  expect(commit.mock.calls[1]![0]).toMatchObject({ requestStatus: "CUSTOMER_ERROR" });
});

it("commits a vendor cost read off the turn, and survives a throwing reader", async () => {
  const reserve = vi.fn(async () => ({ transactionId: "t" }));
  const commit = vi.fn(async (_input: unknown) => ({}));
  const usage = { input_tokens: 3, cached_input_tokens: 0, output_tokens: 1 };
  const run = vi.fn(async () => ({ items: [], finalResponse: "x", usage }));
  const vendorCost = vi.fn(() => "0.01");
  const thread = wrapCodexThread({ run } as unknown as Thread, {
    kaiten: { ai: { reserve, commit } } as any,
    instance: "i",
    entitlement: "p",
    model: "synthetic-model",
    logger: { warn: vi.fn(), error: vi.fn() },
    vendorCost,
  });
  await thread.run("x");
  expect(commit.mock.calls[0]![0]).toMatchObject({ vendorCost: "0.01" });
  vendorCost.mockImplementationOnce(() => {
    throw new Error("bug");
  });
  await expect(thread.run("x")).resolves.toMatchObject({ finalResponse: "x" });
  expect(commit.mock.calls[1]![0]).toMatchObject({ requestStatus: "SUCCESS" });
  expect(commit.mock.calls[1]![0]).not.toHaveProperty("vendorCost");
});
