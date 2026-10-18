// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { AiUsage } from "./contract.ts";

// The only provider-aware code outside the wrapper packages: each normaliser
// turns one provider's usage object into the disjoint fields of `AiUsage`.
// They read structurally and import nothing, so the client never depends on a
// provider SDK. A field the provider did not send stays absent, never 0: the
// server tells "not reported" from "zero".

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/** Drops absent members, so the wire body carries only what is known. */
function compact(usage: AiUsage): AiUsage {
  const out: AiUsage = {};
  for (const [key, value] of Object.entries(usage)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * OpenAI usage → `AiUsage`. Reads the Chat Completions and Embeddings shape
 * (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details`) and the
 * Responses, Images and Audio shape (`input_tokens`, `output_tokens`,
 * `input_tokens_details`).
 *
 * OpenAI's input count INCLUDES the cached tokens (and the cache writes, where
 * reported), so they are subtracted out: `inputTokens = prompt − cached −
 * cacheWrite`, clamped at 0. Output already includes reasoning tokens.
 */
export function fromOpenAI(usage: unknown): AiUsage {
  const raw = record(usage);
  if (!raw) return {};
  const input = count(raw.prompt_tokens) ?? count(raw.input_tokens);
  const details = record(raw.prompt_tokens_details) ?? record(raw.input_tokens_details);
  const cached = count(details?.cached_tokens);
  const cacheWrite = count(details?.cache_write_tokens);
  const output = count(raw.completion_tokens) ?? count(raw.output_tokens);
  // Audio transcription billed by duration answers `{ type: "duration", seconds }`.
  const seconds = raw.type === "duration" ? count(raw.seconds) : undefined;

  return compact({
    inputTokens:
      input === undefined ? undefined : Math.max(0, input - (cached ?? 0) - (cacheWrite ?? 0)),
    cacheReadInputTokens: cached,
    cacheWriteInputTokens: cacheWrite,
    outputTokens: output,
    durationMs: seconds === undefined ? undefined : Math.round(seconds * 1000),
  });
}

/**
 * Anthropic usage → `AiUsage`, from a `Message` or a `message_delta` event.
 * Anthropic's `input_tokens` EXCLUDES the cache, so the three input fields map
 * one to one.
 */
export function fromAnthropic(usage: unknown): AiUsage {
  const raw = record(usage);
  if (!raw) return {};
  return compact({
    inputTokens: count(raw.input_tokens),
    cacheReadInputTokens: count(raw.cache_read_input_tokens),
    cacheWriteInputTokens: count(raw.cache_creation_input_tokens),
    outputTokens: count(raw.output_tokens),
  });
}
