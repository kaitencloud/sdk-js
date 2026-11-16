// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import {
  createAiMeter,
  estimateTokens,
  fromAnthropic,
  isProviderStream,
  meterCall,
  meterStream,
  ttlFromTimeout,
  wrapByDelegation,
} from "@kaitencloud/client/ai";
import type { AiMeterOptions, AiUsage } from "@kaitencloud/client/ai";

export interface WrapAnthropicOptions extends AiMeterOptions {
  estimator?: (params: Record<string, unknown>) => AiUsage | undefined;
}

/** Wrap the installed client's messages methods without replacing MessageStream. */
export function wrapAnthropic<T extends object>(client: T, options: WrapAnthropicOptions): T {
  const meter = createAiMeter(options);
  const estimator =
    options.estimator ??
    ((params) => ({
      inputTokens: estimateTokens(params),
      outputTokens: typeof params.max_tokens === "number" ? params.max_tokens : 1024,
    }));
  let messages: object;
  const wrapped = wrapByDelegation(
    client,
    ["messages.create", "messages.stream"],
    (method, fn, owner) => {
      // The installed synchronous helper calls this.create().withResponse().
      // Supply the proxied resource so that only that underlying request is metered.
      if (method === "messages.stream") return (...args) => fn.apply(messages, args);
      return (body, requestOptions) => {
        const params = (body ?? {}) as Record<string, unknown>;
        const timeout =
          (requestOptions as { timeout?: number } | undefined)?.timeout ??
          (client as { timeout?: number }).timeout;
        return meterCall<unknown>(
          meter,
          typeof params.model === "string"
            ? {
                model: params.model,
                requestType: "COMPLETION",
                estimate: estimator(params),
                ttlSeconds: ttlFromTimeout(timeout),
              }
            : undefined,
          () => fn.call(owner, body, requestOptions),
          async (data, call) => {
            if (isProviderStream(data))
              return meterStream(data, call, {
                usageOf(event, known) {
                  const raw = event as {
                    type?: string;
                    message?: { usage?: unknown };
                    usage?: unknown;
                  };
                  const usage = raw.type === "message_start" ? raw.message?.usage : raw.usage;
                  return usage ? { ...known, ...fromAnthropic(usage) } : known;
                },
              });
            await call.settle("SUCCESS", fromAnthropic((data as { usage?: unknown })?.usage));
            return data;
          },
        );
      };
    },
  );
  messages = (wrapped as { messages: object }).messages;
  return wrapped;
}
