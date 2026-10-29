// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { LanguageModelMiddleware } from "ai";
import { classifyProviderError, createAiMeter, estimateTokens } from "@kaitencloud/client/ai";
import type { AiMeterOptions, AiUsage } from "@kaitencloud/client/ai";

export interface KaitenMiddlewareOptions extends AiMeterOptions {
  estimator?: (params: unknown) => AiUsage | undefined;
}

function normalize(usage: {
  inputTokens: { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens: { total?: number };
}): AiUsage {
  const { inputTokens: input, outputTokens: output } = usage;
  return {
    inputTokens:
      input.noCache ??
      (input.total === undefined
        ? undefined
        : Math.max(0, input.total - (input.cacheRead ?? 0) - (input.cacheWrite ?? 0))),
    cacheReadInputTokens: input.cacheRead,
    cacheWriteInputTokens: input.cacheWrite,
    outputTokens: output.total,
  };
}

/** One operation per language-model call, including each tool-loop step. AI SDK 7 / V4. */
export function kaitenMiddleware(options: KaitenMiddlewareOptions): LanguageModelMiddleware {
  const meter = createAiMeter(options);
  const begin = (model: { modelId: string }, params: { maxOutputTokens?: number }) =>
    meter.begin({
      model: model.modelId,
      requestType: "COMPLETION",
      estimate: options.estimator
        ? options.estimator(params)
        : {
            inputTokens: estimateTokens(params),
            outputTokens: params.maxOutputTokens ?? 1024,
          },
    });
  return {
    specificationVersion: "v4",
    async wrapGenerate({ model, params, doGenerate }) {
      const call = await begin(model, params);
      try {
        const result = await doGenerate();
        await call.settle("SUCCESS", normalize(result.usage));
        return result;
      } catch (error) {
        await call.settle(classifyProviderError(error));
        throw error;
      }
    },
    async wrapStream({ model, params, doStream }) {
      const call = await begin(model, params);
      let result;
      try {
        result = await doStream();
      } catch (error) {
        await call.settle(classifyProviderError(error));
        throw error;
      }
      const reader = result.stream.getReader();
      let known: AiUsage | undefined;
      let received = false;
      let failed = false;
      return {
        ...result,
        stream: new ReadableStream(
          {
            async pull(controller) {
              try {
                const next = await reader.read();
                if (next.done) {
                  await call.settle(failed ? "PROVIDER_ERROR" : "SUCCESS", known);
                  reader.releaseLock();
                  controller.close();
                  return;
                }
                received = true;
                if (next.value.type === "finish") known = normalize(next.value.usage);
                if (next.value.type === "error") failed = true;
                controller.enqueue(next.value);
              } catch (error) {
                await call.settle("PROVIDER_ERROR", known);
                controller.error(error);
              }
            },
            async cancel(reason) {
              try {
                await reader.cancel(reason);
              } finally {
                await call.settle(received ? "CUSTOMER_ERROR" : "NOT_SENT", known);
              }
            },
          },
          { highWaterMark: 0 },
        ),
      };
    },
  };
}
