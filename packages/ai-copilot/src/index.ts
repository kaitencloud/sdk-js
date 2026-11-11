// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import { readVendorCost, reportCommitFailure, uuidv7 } from "@kaitencloud/client/ai";
import type {
  AiCommitInput,
  AiMeterOptions,
  AiUsage,
  AiVendorCostReader,
} from "@kaitencloud/client/ai";

type UsageEvent = Extract<SessionEvent, { type: "assistant.usage" }>;
export function fromCopilot(usage: UsageEvent["data"]): AiUsage {
  // Copilot normalizes token usage across providers. Keep cache disjoint.
  return {
    inputTokens:
      usage.inputTokens === undefined
        ? undefined
        : Math.max(
            0,
            usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0),
          ),
    cacheReadInputTokens: usage.cacheReadTokens,
    cacheWriteInputTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
    durationMs: usage.duration,
  };
}

/** Post-call accounting only. Event listeners cannot block the runtime's model request. */
export function observeCopilotSession(
  session: Pick<CopilotSession, "on">,
  options: AiMeterOptions & {
    runId?: string;
    /**
     * Reads what the provider charged for a model call off its
     * `assistant.usage` event (`response`), as an exact decimal string in USD.
     * The event's `cost` is Copilot's billing multiplier, not a price: do not
     * pass it. Never compute one from a price list.
     */
    vendorCost?: AiVendorCostReader;
  },
): { dispose(): void; flush(): Promise<void> } {
  const logger = options.logger ?? console;
  const runId = options.runId ?? uuidv7();
  let turn = 0;
  let pending = Promise.resolve();
  const seen = new Set<string>();
  const dispose = session.on((event) => {
    if (event.type !== "assistant.usage" || seen.has(event.id)) return;
    seen.add(event.id);
    const transactionId = `${runId}:${turn++}`;
    pending = pending.then(async () => {
      let input: AiCommitInput | undefined;
      try {
        const usage = fromCopilot(event.data);
        input = {
          instance: options.instance,
          entitlement: options.entitlement,
          metadata: options.metadata,
          transactionId,
          model: event.data.model,
          requestType: "COMPLETION",
          requestStatus: "SUCCESS",
          usage,
        };
        const vendorCost = readVendorCost(
          options.vendorCost,
          {
            model: event.data.model,
            requestStatus: "SUCCESS",
            usage,
            rawUsage: event.data,
            response: event,
          },
          logger,
        );
        if (vendorCost !== undefined) input.vendorCost = vendorCost;
        await options.kaiten.ai.commit(input);
      } catch (error) {
        if (input) reportCommitFailure(options.kaiten, logger, options.onCommitError, error, input);
        else logger.error("Kaiten: Copilot usage could not be read; the call already ran.", error);
      }
    });
  });
  return { dispose, flush: () => pending };
}
