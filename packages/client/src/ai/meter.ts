// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { AiRequestStatus, AiRequestType, AiUsage } from "./contract.ts";
import { AiUsageUnsupportedError } from "./errors.ts";
import type { AiCommitInput, AiFailedCommit, AiTarget, KaitenAiModule } from "./module.ts";
import { isVendorCost } from "./module.ts";

/** Where the wrappers write what goes wrong. Defaults to `console`. */
export interface AiLogger {
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

export interface AiMeterOptions extends AiTarget {
  /** A `KaitenClient`, or anything carrying its `ai` module. */
  kaiten: { ai: KaitenAiModule };
  logger?: AiLogger;
  /**
   * Called when a commit still fails after its retries, with the commit so it
   * can be persisted and sent again later (`failed.retry()` resends it byte for
   * byte). The provider call has run either way; it is never failed for this.
   * Defaults to logging through `logger.error`.
   */
  onCommitError?: (error: unknown, failed: AiFailedCommit) => void;
}

/** What a wrapper's `vendorCost` option is given to read the provider's own charge from. */
export interface AiVendorCostInput {
  /** The model the call ran on, as the request named it. */
  model: string;
  requestStatus: AiRequestStatus;
  /** The normalized usage being committed. */
  usage: AiUsage | undefined;
  /** The provider's own usage object, last seen, unchanged: where gateways put a cost. */
  rawUsage: unknown;
  /** The provider's answer, for a call that is not streamed; the final event for a stream. */
  response: unknown;
}

/**
 * The option every wrapper takes to commit what the provider charged: a
 * function that reads it off the provider's answer and returns an exact
 * decimal string in USD, or `undefined`. The SDK never computes one, and never
 * holds a price.
 */
export type AiVendorCostReader = (input: AiVendorCostInput) => string | undefined;

/**
 * Runs a {@link AiVendorCostReader} for a commit. A reader that throws or
 * returns something that is not a decimal string costs the commit its
 * `vendorCost`, never the commit itself: the failure is logged and the commit
 * goes on without it. Never called for `NOT_SENT`.
 */
export function readVendorCost(
  reader: AiVendorCostReader | undefined,
  input: AiVendorCostInput,
  logger: AiLogger = console,
): string | undefined {
  if (!reader || input.requestStatus === "NOT_SENT") return undefined;
  try {
    const cost = reader(input);
    if (cost === undefined) return undefined;
    if (isVendorCost(cost)) return cost;
    logger.error(
      `Kaiten: vendorCost must be a decimal string such as "0.0125" (received ` +
        `${JSON.stringify(cost)}); committing without it.`,
    );
  } catch (error) {
    logger.error("Kaiten: reading the vendor cost failed; committing without it.", error);
  }
  return undefined;
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
   * usage and the vendor cost. Never throws: a commit that fails after its
   * retries goes to `onCommitError`, or is logged.
   */
  settle(
    requestStatus: AiRequestStatus,
    usage?: AiUsage,
    overrides?: { model?: string; requestType?: AiRequestType; vendorCost?: string },
  ): Promise<void>;
}

export interface AiMeter {
  /**
   * Reserves a call. Throws the typed refusal (`InsufficientCreditsError`,
   * `NotAnAiCreditPoolError`, …) so the provider is never called; degrades
   * instead, once and loudly, when the server predates AI reports, and every
   * later call goes unreported.
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
  const { kaiten, logger = console, onCommitError } = options;
  const target: AiTarget = { instance: options.instance, entitlement: options.entitlement };
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
      logger.warn(`Kaiten: ${reason}; this call is not reported to ${target.entitlement}.`);
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
          `Kaiten: AI usage is NOT being reported. ${target.instance}/${target.entitlement} cannot take ` +
            `an AI report (${error.code ?? error.status}): the Kaiten API predates AI credits. ` +
            `Provider calls go on, unmetered.`,
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
          const { vendorCost, ...rest } = overrides ?? {};
          const input: AiCommitInput = {
            ...target,
            transactionId,
            requestStatus,
            usage: requestStatus === "NOT_SENT" ? undefined : usage,
            ...rest,
          };
          if (vendorCost !== undefined && requestStatus !== "NOT_SENT") {
            input.vendorCost = vendorCost;
          }
          try {
            await kaiten.ai.commit(input);
          } catch (error) {
            reportCommitFailure(kaiten, logger, onCommitError, error, input);
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

/**
 * Hands a commit that failed after its retries to `onCommitError`, with a
 * `retry()` that resends the same input, or logs it. Shared by the meter and
 * the post-call observers, so no wrapper swallows a failed commit silently.
 */
export function reportCommitFailure(
  kaiten: { ai: KaitenAiModule },
  logger: AiLogger,
  onCommitError: ((error: unknown, failed: AiFailedCommit) => void) | undefined,
  error: unknown,
  input: AiCommitInput,
): void {
  if (onCommitError) {
    try {
      onCommitError(error, {
        transactionId: input.transactionId,
        input,
        retry: () => kaiten.ai.commit(input),
      });
      return;
    } catch (hookError) {
      logger.error("Kaiten: onCommitError threw.", hookError);
    }
  }
  logger.error(
    `Kaiten: the AI usage commit of ${input.transactionId} failed after its retries. The call ` +
      `ran and is not charged; its reservation expires on its own. Pass onCommitError to ` +
      `persist and retry it.`,
    error,
  );
}
