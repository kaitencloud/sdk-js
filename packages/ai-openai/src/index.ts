// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @kaitencloud/ai-openai — AI credits for the OpenAI SDK.
//
//   import OpenAI from "openai";
//   import { wrapOpenAI } from "@kaitencloud/ai-openai";
//   const openai = wrapOpenAI(new OpenAI(), { kaiten, instance: "acme-prod", pool: "chat-credits" });
//
// Every allow-listed call reserves its estimate, runs, and commits what it
// really used. Everything else on the client is the client's own object.
// Server-side only: the reports need a `ksh_` token.

import {
  createAiMeter,
  estimateTokens,
  fromOpenAI,
  ttlFromTimeout,
  wrapByDelegation,
  meterCall,
  meterStream,
  isProviderStream,
} from "@kaitencloud/client/ai";
import type { AiLogger, AiRequestType, AiUsage, KaitenAiModule } from "@kaitencloud/client/ai";

/** The methods that produce usage, and what each one is. */
export const OPENAI_METHODS = {
  "chat.completions.create": "COMPLETION",
  "responses.create": "COMPLETION",
  "embeddings.create": "EMBEDDING",
  "images.generate": "IMAGE_GENERATION",
  "audio.transcriptions.create": "AUDIO",
  "audio.speech.create": "AUDIO",
} as const satisfies Record<string, AiRequestType>;

export type OpenAIMethod = keyof typeof OPENAI_METHODS;

export interface OpenAIEstimateInput {
  method: OpenAIMethod;
  requestType: AiRequestType;
  /** The request body, as the call passed it. */
  params: Record<string, unknown>;
}

export interface WrapOpenAIOptions {
  /** A `KaitenClient`, or anything carrying its `ai` module. */
  kaiten: { ai: KaitenAiModule };
  /** Instance slug. */
  instance: string;
  /** Entitlement slug of the AI credit pool. */
  pool: string;
  /**
   * The estimate a call reserves. Defaults to {@link estimateOpenAI}; plug a
   * tokenizer in here when the estimate matters.
   */
  estimator?: (input: OpenAIEstimateInput) => AiUsage | undefined;
  logger?: AiLogger;
  /** Sent with every report, never stored. No prompt, no personal data. */
  metadata?: Record<string, unknown>;
}

/** Default output reservation of a completion that sets no maximum. */
const DEFAULT_COMPLETION_OUTPUT = 1024;

/**
 * The default estimate (a heuristic, never a tokenizer): input ≈ serialized
 * request bytes / 4; output = the request's own maximum, else 1024 for a
 * completion and 0 for an embedding; images = the declared `n`.
 */
export function estimateOpenAI({ method, params }: OpenAIEstimateInput): AiUsage | undefined {
  switch (method) {
    case "chat.completions.create":
    case "responses.create": {
      const max = params.max_completion_tokens ?? params.max_tokens ?? params.max_output_tokens;
      return {
        inputTokens: estimateTokens(params),
        outputTokens: typeof max === "number" ? max : DEFAULT_COMPLETION_OUTPUT,
      };
    }
    case "embeddings.create":
      return { inputTokens: estimateTokens(params.input), outputTokens: 0 };
    case "images.generate":
      return {
        inputTokens: estimateTokens(params.prompt),
        units: String(typeof params.n === "number" ? params.n : 1),
        unitType: "image",
      };
    case "audio.speech.create":
      return { inputTokens: estimateTokens(params.input) };
    case "audio.transcriptions.create":
      // The request declares no duration: nothing honest to reserve on.
      return undefined;
  }
}

/** The usage a finished, non-streamed call reports. */
function usageOf(method: OpenAIMethod, data: unknown): AiUsage | undefined {
  if (!data || typeof data !== "object") return undefined;
  const body = data as { usage?: unknown; data?: unknown };
  const usage = fromOpenAI(body.usage);
  if (method === "images.generate" && Array.isArray(body.data)) {
    usage.units = String(body.data.length);
    usage.unitType = "image";
  }
  return Object.keys(usage).length ? usage : undefined;
}

/** The usage a stream event carries, if any: a chat chunk, or a Responses/Images/Audio event. */
function streamUsageOf(event: unknown): unknown {
  if (!event || typeof event !== "object") return undefined;
  const { usage, response } = event as { usage?: unknown; response?: { usage?: unknown } };
  return usage ?? response?.usage ?? undefined;
}

export { wrapByDelegation as delegate } from "@kaitencloud/client/ai";

/**
 * Wraps an OpenAI client. The allow-listed methods ({@link OPENAI_METHODS})
 * reserve, call, and commit; every other method and property is the client's
 * own. A streamed chat completion forces `stream_options.include_usage` and
 * keeps the extra usage chunk from a caller who did not ask for it.
 *
 * A refused reservation throws its typed error (`InsufficientCreditsError`, …)
 * and the provider is never called. When the pool or the API cannot take an AI
 * report, the wrapper logs it once and goes on calling the provider unmetered.
 */
export function wrapOpenAI<T extends object>(client: T, options: WrapOpenAIOptions): T {
  const meter = createAiMeter({
    kaiten: options.kaiten,
    instance: options.instance,
    pool: options.pool,
    metadata: options.metadata,
    logger: options.logger,
  });
  const estimator = options.estimator ?? estimateOpenAI;
  const clientTimeout = (client as { timeout?: unknown }).timeout;

  return wrapByDelegation(client, Object.keys(OPENAI_METHODS), (name, fn, owner) => {
    const method = name as OpenAIMethod;
    const requestType = OPENAI_METHODS[method];

    return (body: unknown, requestOptions?: unknown, ...rest: unknown[]) => {
      let params = (body ?? {}) as Record<string, unknown>;
      const streamed = params.stream === true;
      let hideUsageChunk = false;
      if (method === "chat.completions.create" && streamed) {
        const streamOptions = (params.stream_options ?? {}) as Record<string, unknown>;
        hideUsageChunk = streamOptions.include_usage !== true;
        params = { ...params, stream_options: { ...streamOptions, include_usage: true } };
      }
      const model = typeof params.model === "string" ? params.model : undefined;
      const timeout =
        (requestOptions as { timeout?: unknown } | undefined)?.timeout ?? clientTimeout;

      return meterCall<unknown>(
        meter,
        model
          ? {
              model,
              requestType,
              estimate: estimator({
                method,
                requestType,
                params: (body ?? {}) as Record<string, unknown>,
              }),
              ttlSeconds: ttlFromTimeout(timeout),
            }
          : undefined,
        () => fn.call(owner, params, requestOptions, ...rest),
        async (data, call) => {
          if (streamed && isProviderStream(data)) {
            return meterStream(data, call, {
              usageOf: (event) => {
                const raw = streamUsageOf(event);
                return raw ? fromOpenAI(raw) : undefined;
              },
              hide: hideUsageChunk
                ? (event) => {
                    const chunk = event as { usage?: unknown; choices?: unknown[] };
                    return (
                      !!chunk.usage && Array.isArray(chunk.choices) && chunk.choices.length === 0
                    );
                  }
                : undefined,
            });
          }
          await call.settle("SUCCESS", usageOf(method, data));
          return data;
        },
      );
    };
  });
}

export type { AiLogger, AiUsage } from "@kaitencloud/client/ai";
