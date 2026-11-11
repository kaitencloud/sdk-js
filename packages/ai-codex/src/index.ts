// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Thread, Usage, ThreadEvent } from "@openai/codex-sdk";
import {
  classifyProviderError,
  createAiMeter,
  readVendorCost,
  uuidv7,
} from "@kaitencloud/client/ai";
import type {
  AiMeterOptions,
  AiMeteredCall,
  AiRequestStatus,
  AiUsage,
  AiVendorCostReader,
} from "@kaitencloud/client/ai";

/** A failure once the turn was submitted: the caller's when aborted, else the provider's. */
function afterSend(error: unknown): AiRequestStatus {
  return classifyProviderError(error) === "CUSTOMER_ERROR" ? "CUSTOMER_ERROR" : "PROVIDER_ERROR";
}

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
  /**
   * Reads what the provider charged for a turn, as an exact decimal string in
   * USD, committed as `vendorCost`. Codex reports no cost; never compute one
   * from a price list. A throw or an invalid value is logged and the commit
   * goes on without it.
   */
  vendorCost?: AiVendorCostReader;
}

/** One operation per submitted prompt, NOT per internal model request. */
export function wrapCodexThread(thread: Thread, options: WrapCodexOptions): Thread {
  const meter = createAiMeter(options);
  const logger = options.logger ?? console;
  const runId = uuidv7();
  const settle = (
    call: AiMeteredCall,
    requestStatus: AiRequestStatus,
    rawUsage: Usage | undefined | null,
    response: unknown,
  ) => {
    const usage = rawUsage ? fromCodex(rawUsage) : undefined;
    const vendorCost = readVendorCost(
      options.vendorCost,
      { model: options.model, requestStatus, usage, rawUsage, response },
      logger,
    );
    return call.settle(requestStatus, usage, vendorCost === undefined ? undefined : { vendorCost });
  };
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
          let result: Awaited<ReturnType<Thread["run"]>>;
          try {
            result = await target.run(...args);
          } catch (error) {
            // `run` spawns the agent and submits the turn: a failure from it is
            // never proven pre-send, so it is never NOT_SENT.
            await call.settle(afterSend(error));
            throw error;
          }
          await settle(call, "SUCCESS", result.usage, result);
          return result;
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
          // `runStreamed` only returns a lazy generator; the turn is submitted
          // when the caller starts iterating it. Never iterated, nothing was sent
          // and the reservation expires on its own.
          async function* events(): AsyncGenerator<ThreadEvent> {
            let failed = false;
            let status: AiRequestStatus | undefined;
            let completed: Extract<ThreadEvent, { type: "turn.completed" }> | undefined;
            try {
              for await (const event of result.events) {
                if (event.type === "turn.completed") completed = event;
                if (event.type === "turn.failed" || event.type === "error") failed = true;
                yield event;
              }
              status = failed ? "PROVIDER_ERROR" : "SUCCESS";
            } catch (error) {
              // Was CUSTOMER_ERROR: an agent failure mid-turn is the provider's.
              status = afterSend(error);
              throw error;
            } finally {
              // No status: the caller stopped reading.
              await settle(call, status ?? "CUSTOMER_ERROR", completed?.usage, completed);
            }
          }
          return { ...result, events: events() };
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
