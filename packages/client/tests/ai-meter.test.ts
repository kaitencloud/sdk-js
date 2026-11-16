// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, it, vi } from "vite-plus/test";
import { createAiMeter, ttlFromTimeout } from "../src/ai/meter.ts";
import { AiUsageUnsupportedError } from "../src/ai/errors.ts";
import { KaitenError } from "../src/core/runtime/errors.ts";

it("degrades once, refuses other errors, and settles once even after commit failure", async () => {
  const reserve = vi.fn(async () => ({ transactionId: "t" }));
  const commit = vi.fn(async (_input: unknown) => ({}));
  const logger = { warn: vi.fn(), error: vi.fn() };
  const meter = createAiMeter({
    kaiten: { ai: { reserve, commit } } as any,
    instance: "i",
    entitlement: "p",
    logger,
  });
  reserve.mockRejectedValueOnce(new Error("refused"));
  await expect(meter.begin({ model: "m", requestType: "COMPLETION" })).rejects.toThrow("refused");
  const call = await meter.begin({ model: "m", requestType: "COMPLETION" });
  commit.mockRejectedValueOnce(new Error("failed"));
  await call.settle("SUCCESS");
  await call.settle("SUCCESS");
  expect(commit).toHaveBeenCalledOnce();
  expect(logger.error).toHaveBeenCalledOnce();
  reserve.mockRejectedValueOnce(
    new AiUsageUnsupportedError(new KaitenError({ title: "unsupported", status: 422 })),
  );
  await meter.begin({ model: "m", requestType: "COMPLETION" });
  await meter.begin({ model: "m", requestType: "COMPLETION" });
  expect(meter.degraded).toBe(true);
  expect(reserve).toHaveBeenCalledTimes(3);
  expect(logger.error).toHaveBeenCalledTimes(2);
});
it("derives safe bounded TTLs", () => {
  expect(ttlFromTimeout(undefined)).toBeUndefined();
  expect(ttlFromTimeout(-1)).toBeUndefined();
  expect(ttlFromTimeout(1)).toBe(1);
  expect(ttlFromTimeout(1001)).toBe(2);
  expect(ttlFromTimeout(4_000_000)).toBe(3600);
});
