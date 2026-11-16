// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Thread, Usage, ThreadEvent } from "@openai/codex-sdk";
import { createAiMeter, uuidv7 } from "@kaitencloud/client/ai";
import type { AiMeterOptions, AiUsage } from "@kaitencloud/client/ai";

export function fromCodex(usage: Usage): AiUsage {
  return {
    inputTokens: Math.max(
      0,
      usage.input_tokens - usage.cached_input_tokens - (usage.cache_write_input_tokens ?? 0),
    ),
    cacheReadInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_write_input_tokens,
    outputTokens: usage.output_tokens,
  };
}

export interface WrapCodexOptions extends AiMeterOptions {
  /** Explicit configured model; Codex completion events do not carry a model. */
  model: string;
  estimator?: (input: Parameters<Thread["run"]>[0]) => AiUsage | undefined;
}

/** One operation per submitted prompt, NOT per internal model request. */
export function wrapCodexThread(thread: Thread, options: WrapCodexOptions): Thread {
  const meter = createAiMeter(options);
  const runId = uuidv7();
  let turn = 0;
  const begin = (input: Parameters<Thread["run"]>[0]) =>
    meter.begin({
      model: options.model,
      requestType: "COMPLETION",
      estimate: options.estimator?.(input),
      transactionId: `${runId}:${turn++}`,
    });
  return new Proxy(thread, {
    get(target, property) {
      if (property === "run")
        return async (...args: Parameters<Thread["run"]>) => {
          const call = await begin(args[0]);
          try {
            const result = await target.run(...args);
            await call.settle("SUCCESS", result.usage ? fromCodex(result.usage) : undefined);
            return result;
          } catch (error) {
            await call.settle("PROVIDER_ERROR");
            throw error;
          }
        };
      if (property === "runStreamed")
        return async (...args: Parameters<Thread["runStreamed"]>) => {
          const call = await begin(args[0]);
          let result: Awaited<ReturnType<Thread["runStreamed"]>>;
          try {
            result = await target.runStreamed(...args);
          } catch (error) {
            await call.settle("NOT_SENT");
            throw error;
          }
          async function* events(): AsyncGenerator<ThreadEvent> {
            let failed = false;
            let complete = false;
            let known: AiUsage | undefined;
            try {
              for await (const event of result.events) {
                if (event.type === "turn.completed") known = fromCodex(event.usage);
                if (event.type === "turn.failed" || event.type === "error") failed = true;
                yield event;
              }
              complete = true;
            } finally {
              await call.settle(
                complete ? (failed ? "PROVIDER_ERROR" : "SUCCESS") : "CUSTOMER_ERROR",
                known,
              );
            }
          }
          return { ...result, events: events() };
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
