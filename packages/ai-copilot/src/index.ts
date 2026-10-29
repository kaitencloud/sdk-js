// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import { uuidv7 } from "@kaitencloud/client/ai";
import type { AiMeterOptions, AiUsage } from "@kaitencloud/client/ai";

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
  options: AiMeterOptions & { runId?: string },
): { dispose(): void; flush(): Promise<void> } {
  const runId = options.runId ?? uuidv7();
  let turn = 0;
  let pending = Promise.resolve();
  const seen = new Set<string>();
  const dispose = session.on((event) => {
    if (event.type !== "assistant.usage" || seen.has(event.id)) return;
    seen.add(event.id);
    const transactionId = `${runId}:${turn++}`;
    pending = pending.then(async () => {
      try {
        await options.kaiten.ai.commit({
          instance: options.instance,
          entitlement: options.entitlement,
          metadata: options.metadata,
          transactionId,
          model: event.data.model,
          requestType: "COMPLETION",
          requestStatus: "SUCCESS",
          usage: fromCopilot(event.data),
        });
      } catch (error) {
        (options.logger ?? console).error(
          "Kaiten: Copilot usage commit failed; the call already ran.",
          error,
        );
      }
    });
  });
  return { dispose, flush: () => pending };
}
