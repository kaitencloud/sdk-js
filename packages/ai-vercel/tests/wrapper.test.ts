// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { wrapLanguageModel } from "ai";
type LanguageModelV4 = Parameters<typeof wrapLanguageModel>[0]["model"];
import { expect, it, vi } from "vite-plus/test";
import { kaitenMiddleware } from "../src/index.ts";

const usage = {
  inputTokens: { total: 17, noCache: 10, cacheRead: 5, cacheWrite: 2 },
  outputTokens: { total: 7, text: 4, reasoning: 3 },
};
const params = { prompt: [] } as any;
function setup() {
  const reserve = vi.fn(async () => ({ transactionId: "t" }));
  const commit = vi.fn(async (_input: unknown) => ({}));
  const doGenerate = vi.fn(async () => ({
    content: [],
    finishReason: { unified: "stop", raw: "stop" },
    usage,
    warnings: [],
  }));
  const doStream = vi.fn(async () => ({
    stream: new ReadableStream({
      start(c) {
        c.enqueue({ type: "text-start", id: "s" });
        c.enqueue({ type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } });
        c.close();
      },
    }),
  }));
  const original = {
    specificationVersion: "v4",
    provider: "synthetic",
    modelId: "synthetic-model",
    supportedUrls: {},
    doGenerate,
    doStream,
  } as LanguageModelV4;
  const model = wrapLanguageModel({
    model: original,
    middleware: kaitenMiddleware({
      kaiten: { ai: { reserve, commit } } as any,
      instance: "i",
      pool: "p",
    }),
  });
  return { model, reserve, commit, doGenerate, doStream };
}
it("integrates actual wrapLanguageModel with disjoint usage and no reasoning duplication", async () => {
  const { model, commit } = setup();
  const result = await model.doGenerate(params);
  expect(result.usage).toEqual(usage);
  expect(commit.mock.calls[0]![0]).toMatchObject({
    requestStatus: "SUCCESS",
    usage: { inputTokens: 10, cacheReadInputTokens: 5, cacheWriteInputTokens: 2, outputTokens: 7 },
  });
});
it("settles stream finish and explicit cancellation", async () => {
  const { model, commit } = setup();
  const result = await model.doStream(params);
  const reader = result.stream.getReader();
  while (!(await reader.read()).done) {}
  expect(commit.mock.calls[0]![0]).toMatchObject({
    requestStatus: "SUCCESS",
    usage: { outputTokens: 7 },
  });
  const abandoned = await model.doStream(params);
  const abandonedReader = abandoned.stream.getReader();
  await abandonedReader.read();
  await abandonedReader.cancel();
  expect(commit.mock.calls[1]![0]).toMatchObject({ requestStatus: "CUSTOMER_ERROR" });
});
it("refuses before generation and preserves provider errors", async () => {
  const { model, reserve, doGenerate, commit } = setup();
  reserve.mockRejectedValueOnce(new Error("refused"));
  await expect(model.doGenerate(params)).rejects.toThrow("refused");
  expect(doGenerate).not.toHaveBeenCalled();
  doGenerate.mockRejectedValueOnce(Object.assign(new Error("provider failed"), { status: 500 }));
  await expect(model.doGenerate(params)).rejects.toThrow("provider failed");
  expect(commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "PROVIDER_ERROR" });
});

it("reports error stream events and cancellation before any event", async () => {
  const { model, doStream, commit } = setup();
  doStream.mockResolvedValueOnce({
    stream: new ReadableStream({
      start(c) {
        c.enqueue({ type: "error", error: new Error("synthetic") });
        c.close();
      },
    }),
  } as any);
  const result = await model.doStream(params);
  const reader = result.stream.getReader();
  while (!(await reader.read()).done) {}
  expect(commit.mock.calls[0]![0]).toMatchObject({ requestStatus: "PROVIDER_ERROR" });
  const untouched = await model.doStream(params);
  await untouched.stream.cancel();
  expect(commit.mock.calls[1]![0]).toMatchObject({ requestStatus: "NOT_SENT" });
});

it("degrades once when the server cannot accept AI usage", async () => {
  const { model, reserve, commit } = setup();
  const { AiUsageUnsupportedError } = await import("@kaitencloud/client/ai");
  reserve.mockRejectedValueOnce(
    new AiUsageUnsupportedError({ status: 422, message: "synthetic unsupported" } as any),
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await model.doGenerate(params);
    await model.doGenerate(params);
    expect(reserve).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});
