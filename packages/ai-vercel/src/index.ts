// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { LanguageModelMiddleware } from "ai";
import {
  classifyProviderError,
  createAiMeter,
  estimateTokens,
  readVendorCost,
} from "@kaitencloud/client/ai";
import type {
  AiMeterOptions,
  AiMeteredCall,
  AiRequestStatus,
  AiUsage,
  AiVendorCostReader,
} from "@kaitencloud/client/ai";

export interface KaitenMiddlewareOptions extends AiMeterOptions {
  estimator?: (params: unknown) => AiUsage | undefined;
  /**
   * Reads what the provider charged for a call, as an exact decimal string in
   * USD, committed as `vendorCost`. `response` is the `doGenerate` result, or
   * the stream's `finish` part; a provider or gateway that reports its own cost
   * puts it in `providerMetadata`. Never compute one from a price list. A throw
   * or an invalid value is logged and the commit goes on without it.
   */
  vendorCost?: AiVendorCostReader;
}

type V4Usage = {
  inputTokens?: { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens?: { total?: number };
};

/** AI SDK V4 usage → `AiUsage`. Defensive: a provider that sends no usage yields `undefined`. */
function normalize(usage: V4Usage | undefined): AiUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const input = usage.inputTokens ?? {};
  const output = usage.outputTokens ?? {};
  const out: AiUsage = {};
  const inputTokens =
    input.noCache ??
    (input.total === undefined
      ? undefined
      : Math.max(0, input.total - (input.cacheRead ?? 0) - (input.cacheWrite ?? 0)));
  if (inputTokens !== undefined) out.inputTokens = inputTokens;
  if (input.cacheRead !== undefined) out.cacheReadInputTokens = input.cacheRead;
  if (input.cacheWrite !== undefined) out.cacheWriteInputTokens = input.cacheWrite;
  if (output.total !== undefined) out.outputTokens = output.total;
  return Object.keys(out).length ? out : undefined;
}

/** A failure once the provider accepted the request: never `NOT_SENT`. */
function afterSend(error: unknown): AiRequestStatus {
  return classifyProviderError(error) === "CUSTOMER_ERROR" ? "CUSTOMER_ERROR" : "PROVIDER_ERROR";
}

/** One operation per language-model call, including each tool-loop step. AI SDK 7 / V4. */
export function kaitenMiddleware(options: KaitenMiddlewareOptions): LanguageModelMiddleware {
  const meter = createAiMeter(options);
  const logger = options.logger ?? console;
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
  const settle = (
    call: AiMeteredCall,
    model: string,
    requestStatus: AiRequestStatus,
    response: { usage?: V4Usage } | undefined,
  ) => {
    let usage: AiUsage | undefined;
    try {
      usage = normalize(response?.usage);
    } catch (error) {
      logger.error("Kaiten: reading the AI SDK usage failed; committing without usage.", error);
    }
    const vendorCost = readVendorCost(
      options.vendorCost,
      { model, requestStatus, usage, rawUsage: response?.usage, response },
      logger,
    );
    return call.settle(requestStatus, usage, vendorCost === undefined ? undefined : { vendorCost });
  };
  return {
    specificationVersion: "v4",
    async wrapGenerate({ model, params, doGenerate }) {
      const call = await begin(model, params);
      let result;
      try {
        result = await doGenerate();
      } catch (error) {
        await call.settle(classifyProviderError(error));
        throw error;
      }
      // Never throws: the provider answered, its result is the caller's.
      await settle(call, model.modelId, "SUCCESS", result);
      return result;
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
      // From here the provider has accepted the request: whatever happens to
      // the stream, the call was sent and is never settled as NOT_SENT.
      const reader = result.stream.getReader();
      let finish: { usage?: V4Usage } | undefined;
      let failed = false;
      return {
        ...result,
        stream: new ReadableStream(
          {
            async pull(controller) {
              let next;
              try {
                next = await reader.read();
              } catch (error) {
                await settle(call, model.modelId, afterSend(error), finish);
                controller.error(error);
                return;
              }
              if (next.done) {
                await settle(call, model.modelId, failed ? "PROVIDER_ERROR" : "SUCCESS", finish);
                reader.releaseLock();
                controller.close();
                return;
              }
              if (next.value.type === "finish") finish = next.value as { usage?: V4Usage };
              if (next.value.type === "error") failed = true;
              controller.enqueue(next.value);
            },
            async cancel(reason) {
              try {
                await reader.cancel(reason);
              } finally {
                await settle(call, model.modelId, "CUSTOMER_ERROR", finish);
              }
            },
          },
          { highWaterMark: 0 },
        ),
      };
    },
  };
}
