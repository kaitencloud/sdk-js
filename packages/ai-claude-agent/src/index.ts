// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { fromAnthropic, readVendorCost, reportCommitFailure, uuidv7 } from "@kaitencloud/client/ai";
import type {
  AiCommitInput,
  AiMeterOptions,
  AiUsage,
  AiVendorCostReader,
} from "@kaitencloud/client/ai";

/** Accounting only: message_start is already after the model request. No preflight guarantee. */
export async function* observeClaudeAgent(
  messages: AsyncIterable<SDKMessage>,
  options: AiMeterOptions & {
    runId?: string;
    /**
     * Reads what the provider charged for one model response, as an exact
     * decimal string in USD, given its accumulated usage (`rawUsage` is the
     * last `message_delta` usage). The agent's run-level `total_cost_usd` covers
     * every request of the run and cannot be split per response: do not pass
     * it here. Never compute one from a price list.
     */
    vendorCost?: AiVendorCostReader;
  },
): AsyncGenerator<SDKMessage> {
  const logger = options.logger ?? console;
  const runId = options.runId ?? uuidv7();
  let turn = 0;
  const active = new Map<
    string,
    { model: string; usage: AiUsage; transactionId: string; rawUsage: unknown }
  >();
  const seen = new Set<string>();
  const settle = async (key: string, status: "SUCCESS" | "CUSTOMER_ERROR" | "PROVIDER_ERROR") => {
    const call = active.get(key);
    if (!call) return;
    active.delete(key);
    const input: AiCommitInput = {
      instance: options.instance,
      entitlement: options.entitlement,
      metadata: options.metadata,
      transactionId: call.transactionId,
      model: call.model,
      usage: call.usage,
      requestType: "COMPLETION",
      requestStatus: status,
    };
    const vendorCost = readVendorCost(
      options.vendorCost,
      {
        model: call.model,
        requestStatus: status,
        usage: call.usage,
        rawUsage: call.rawUsage,
        response: undefined,
      },
      logger,
    );
    if (vendorCost !== undefined) input.vendorCost = vendorCost;
    try {
      await options.kaiten.ai.commit(input);
    } catch (error) {
      reportCommitFailure(options.kaiten, logger, options.onCommitError, error, input);
    }
  };
  try {
    for await (const message of messages) {
      if (message.type === "stream_event") {
        const key = message.parent_tool_use_id ?? "main";
        const event = message.event;
        if (event.type === "message_start" && !seen.has(event.message.id)) {
          // Complete a prior response defensively if its message_stop was omitted.
          await settle(key, "SUCCESS");
          seen.add(event.message.id);
          active.set(key, {
            model: event.message.model,
            usage: fromAnthropic(event.message.usage),
            rawUsage: event.message.usage,
            transactionId: `${runId}:${turn++}`,
          });
        } else if (event.type === "message_delta") {
          const call = active.get(key);
          if (call) {
            call.usage = { ...call.usage, ...fromAnthropic(event.usage) };
            call.rawUsage = event.usage;
          }
        } else if (event.type === "message_stop") await settle(key, "SUCCESS");
      }
      yield message;
    }
    for (const key of active.keys()) await settle(key, "SUCCESS");
  } catch (error) {
    // The agent failed mid-response: the provider's failure, not the caller's.
    for (const key of active.keys()) await settle(key, "PROVIDER_ERROR");
    throw error;
  } finally {
    // Still open here: the caller stopped reading.
    for (const key of active.keys()) await settle(key, "CUSTOMER_ERROR");
  }
}
