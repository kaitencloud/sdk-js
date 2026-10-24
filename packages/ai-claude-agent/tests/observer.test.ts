// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { expect, it, vi } from "vite-plus/test";
import { observeClaudeAgent } from "../src/index.ts";

it("accounts three distinct model responses, final output and subagent model without fake reserves", async () => {
  const commit = vi.fn(async (_input: unknown) => ({}));
  const reserve = vi.fn();
  const messages: SDKMessage[] = [];
  for (let i = 0; i < 3; i++) {
    const parent = i === 2 ? "subagent" : null;
    messages.push(
      ...([
        {
          type: "stream_event",
          parent_tool_use_id: parent,
          event: {
            type: "message_start",
            message: {
              id: `s${i}`,
              model: `synthetic-${i}`,
              usage: { input_tokens: 10, output_tokens: 1 },
            },
          },
        },
        {
          type: "stream_event",
          parent_tool_use_id: parent,
          event: {
            type: "message_delta",
            usage: { output_tokens: 7 },
            delta: { stop_reason: "end_turn", stop_sequence: null },
          },
        },
        { type: "stream_event", parent_tool_use_id: parent, event: { type: "message_stop" } },
      ] as SDKMessage[]),
    );
  }
  async function* source() {
    yield* messages;
  }
  const output = [];
  for await (const m of observeClaudeAgent(source(), {
    kaiten: { ai: { commit, reserve } } as any,
    instance: "i",
    entitlement: "p",
    runId: "run",
  }))
    output.push(m);
  expect(output).toEqual(messages);
  expect(reserve).not.toHaveBeenCalled();
  expect(commit).toHaveBeenCalledTimes(3);
  expect(commit.mock.calls.map((c) => (c[0] as any).transactionId)).toEqual([
    "run:0",
    "run:1",
    "run:2",
  ]);
  expect(commit.mock.calls[2]![0]).toMatchObject({
    model: "synthetic-2",
    usage: { inputTokens: 10, outputTokens: 7 },
  });
});
