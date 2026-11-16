// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { SessionEvent, SessionEventHandler } from "@github/copilot-sdk";
import { expect, it, vi } from "vite-plus/test";
import { observeCopilotSession } from "../src/index.ts";

it("observes usage without pretending async event listeners gate model calls", async () => {
  let listener: SessionEventHandler = () => {};
  const unsubscribe = vi.fn();
  const on = ((handler: SessionEventHandler) => {
    listener = handler;
    return unsubscribe;
  }) as any;
  const commit = vi.fn(async (_input: unknown) => ({}));
  const reserve = vi.fn();
  const observer = observeCopilotSession(
    { on },
    { kaiten: { ai: { reserve, commit } } as any, instance: "i", entitlement: "p", runId: "run" },
  );
  for (let i = 0; i < 3; i++) {
    const event = {
      type: "assistant.usage",
      id: `e${i}`,
      data: {
        model: `synthetic-${i}`,
        inputTokens: 17,
        cacheReadTokens: 5,
        cacheWriteTokens: 2,
        outputTokens: 7,
      },
    } as SessionEvent;
    listener(event);
    listener(event);
  }
  await observer.flush();
  observer.dispose();
  expect(reserve).not.toHaveBeenCalled();
  expect(commit).toHaveBeenCalledTimes(3);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(commit.mock.calls[2]![0]).toMatchObject({
    transactionId: "run:2",
    model: "synthetic-2",
    usage: { inputTokens: 10, outputTokens: 7 },
  });
});
