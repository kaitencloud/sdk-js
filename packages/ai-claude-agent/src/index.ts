// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { fromAnthropic, uuidv7 } from "@kaitencloud/client/ai";
import type { AiMeterOptions, AiUsage } from "@kaitencloud/client/ai";

/** Accounting only: message_start is already after the model request. No preflight guarantee. */
export async function* observeClaudeAgent(
  messages: AsyncIterable<SDKMessage>,
  options: AiMeterOptions & { runId?: string },
): AsyncGenerator<SDKMessage> {
  const runId = options.runId ?? uuidv7();
  let turn = 0;
  const active = new Map<string, { model: string; usage: AiUsage; transactionId: string }>();
  const seen = new Set<string>();
  const settle = async (key: string, status: "SUCCESS" | "CUSTOMER_ERROR") => {
    const call = active.get(key);
    if (!call) return;
    active.delete(key);
    try {
      await options.kaiten.ai.commit({
        instance: options.instance,
        entitlement: options.entitlement,
        metadata: options.metadata,
        ...call,
        requestType: "COMPLETION",
        requestStatus: status,
      });
    } catch (error) {
      (options.logger ?? console).error(
        "Kaiten: Claude Agent usage commit failed; no preflight gate is provided.",
        error,
      );
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
            transactionId: `${runId}:${turn++}`,
          });
        } else if (event.type === "message_delta") {
          const call = active.get(key);
          if (call) call.usage = { ...call.usage, ...fromAnthropic(event.usage) };
        } else if (event.type === "message_stop") await settle(key, "SUCCESS");
      }
      yield message;
    }
    for (const key of active.keys()) await settle(key, "SUCCESS");
  } finally {
    for (const key of active.keys()) await settle(key, "CUSTOMER_ERROR");
  }
}
