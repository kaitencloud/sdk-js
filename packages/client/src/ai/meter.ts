// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { AiRequestStatus, AiRequestType, AiUsage } from "./contract.ts";
import { AiUsageUnsupportedError } from "./errors.ts";
import type { AiTarget, KaitenAiModule } from "./module.ts";

/** Where the wrappers write what goes wrong. Defaults to `console`. */
export interface AiLogger {
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

export interface AiMeterOptions extends AiTarget {
  /** A `KaitenClient`, or anything carrying its `ai` module. */
  kaiten: { ai: KaitenAiModule };
  logger?: AiLogger;
}

export interface AiMeterBeginInput {
  model: string;
  requestType: AiRequestType;
  estimate?: AiUsage;
  ttlSeconds?: number;
  transactionId?: string;
}

/** One reserved call, settled exactly once. */
export interface AiMeteredCall {
  /** Undefined when the meter is degraded and the call is not reported. */
  readonly transactionId: string | undefined;
  readonly settled: boolean;
  /**
   * Commits the call. Only the first settlement counts; `NOT_SENT` drops the
   * usage. Never throws: a commit that fails after its retries is logged.
   */
  settle(
    requestStatus: AiRequestStatus,
    usage?: AiUsage,
    overrides?: { model?: string; requestType?: AiRequestType },
  ): Promise<void>;
}

export interface AiMeter {
  /**
   * Reserves a call. Throws the typed refusal (`InsufficientCreditsError`, …)
   * so the provider is never called; degrades instead, once and loudly, when
   * the server cannot take an AI report, and every later call goes unreported.
   */
  begin(input: AiMeterBeginInput): Promise<AiMeteredCall>;
  /** True once the server answered that it cannot take an AI report. */
  readonly degraded: boolean;
  /** A call that is not reported, for a request the meter cannot price. */
  unmetered(reason: string): AiMeteredCall;
}

/**
 * The reserve → commit bookkeeping every wrapper shares: degradation, the
 * settle-once rule and the logging. Provider-agnostic; the wrapper packages
 * build on it, and so can a host wrapping a provider of its own.
 */
export function createAiMeter(options: AiMeterOptions): AiMeter {
  const { kaiten, logger = console } = options;
  const target: AiTarget = { instance: options.instance, pool: options.pool };
  if (options.metadata) target.metadata = options.metadata;
  let degraded = false;

  const noop = (): AiMeteredCall => ({
    transactionId: undefined,
    settled: true,
    settle: async () => {},
  });

  return {
    get degraded() {
      return degraded;
    },

    unmetered(reason) {
      logger.warn(`Kaiten: ${reason}; this call is not reported to ${target.pool}.`);
      return noop();
    },

    async begin(input) {
      if (degraded) return noop();
      let transactionId: string;
      try {
        ({ transactionId } = await kaiten.ai.reserve({
          ...target,
          model: input.model,
          requestType: input.requestType,
          usage: input.estimate,
          ttlSeconds: input.ttlSeconds,
          transactionId: input.transactionId,
        }));
      } catch (error) {
        if (!(error instanceof AiUsageUnsupportedError)) throw error;
        degraded = true;
        logger.error(
          `Kaiten: AI usage is NOT being reported. ${target.instance}/${target.pool} cannot take ` +
            `an AI report (${error.code ?? error.status}): the pool is not an AI credit pool, or ` +
            `the Kaiten API predates AI credits. Provider calls go on, unmetered.`,
          error,
        );
        return noop();
      }

      let settled = false;
      return {
        transactionId,
        get settled() {
          return settled;
        },
        async settle(requestStatus, usage, overrides) {
          if (settled) return;
          settled = true;
          try {
            await kaiten.ai.commit({
              ...target,
              transactionId,
              requestStatus,
              usage: requestStatus === "NOT_SENT" ? undefined : usage,
              ...overrides,
            });
          } catch (error) {
            logger.error(
              `Kaiten: the AI usage commit of ${transactionId} failed after its retries. The call ` +
                `ran and is not charged; its reservation expires on its own.`,
              error,
            );
          }
        },
      };
    },
  };
}

/** The longest reservation the API accepts (`KAITEN_AI_RESERVATION_MAX_TTL`). */
const MAX_TTL_SECONDS = 3600;

/**
 * A reservation lifetime from a provider client's request timeout, in
 * milliseconds: the reservation should outlive the call it holds credits for.
 * Undefined, and the server default applies, when there is no usable timeout.
 */
export function ttlFromTimeout(timeoutMs: unknown): number | undefined {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }
  return Math.min(MAX_TTL_SECONDS, Math.max(1, Math.ceil(timeoutMs / 1000)));
}
