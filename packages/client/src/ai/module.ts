// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import {
  reportEntitlementUsageMetric,
  listAiInferences,
  listAiReservations,
} from "../core/index.ts";
import type {
  KaitenTransport,
  ListAiInferencesData,
  AiInferencePage,
  AiReservations,
} from "../core/index.ts";
import type {
  AiEntitlementUsage,
  AiReportBody,
  AiRequestStatus,
  AiRequestType,
  AiUsage,
  AiUsageOutcome,
  AiUsageValue,
} from "./contract.ts";
import { AiUsageUnsupportedError, toAiError } from "./errors.ts";
import { uuidv7 } from "./ids.ts";

/** Where an AI report lands: an instance and one of its AI credit pools. */
export interface AiTarget {
  /** Instance slug. */
  instance: string;
  /** Entitlement slug of the AI credit pool. */
  entitlement: string;
  /** Accepted by the API and not stored. Never put a prompt or personal data here. */
  metadata?: Record<string, unknown>;
}

export interface AiReserveInput extends AiTarget {
  /** Catalogue slug, or the provider's own model id. */
  model: string;
  requestType: AiRequestType;
  /** The estimate the reservation is priced on. */
  usage?: AiUsage;
  /** Pairs the reserve with its commit. Defaults to a UUIDv7. */
  transactionId?: string;
  /** Reservation lifetime; the server default (10 minutes) when omitted. */
  ttlSeconds?: number;
}

export interface AiCommitInput extends AiTarget {
  transactionId: string;
  requestStatus: AiRequestStatus;
  /** The real usage. Omitted, the rule's minimum is charged. */
  usage?: AiUsage;
  /** Only when it differs from the reservation, or there was none. */
  model?: string;
  /** Only when it differs from the reservation, or there was none. */
  requestType?: AiRequestType;
}

export interface AiReportResult {
  transactionId: string;
  /** The `ai` member of the answer: status, credits, remaining, warnings. */
  outcome?: AiUsageOutcome;
  /** The whole answer: the pool's usage after this call. */
  entitlementUsage: AiEntitlementUsage;
}

export interface AiRunContext {
  readonly transactionId: string;
  /** Records the usage known so far, committed if `fn` throws. */
  setUsage(usage: AiUsage): void;
}

export interface AiRunOptions<T> extends Omit<AiReserveInput, "usage"> {
  /** The estimate the reservation is priced on. */
  estimate?: AiUsage;
  /** Reads the real usage off `fn`'s result. */
  usage?: (result: T) => AiUsage | undefined;
  /** How a thrown error is committed. Defaults to {@link classifyProviderError}. */
  classifyError?: (error: unknown) => AiRequestStatus;
  /**
   * Given, `run` degrades when the server cannot take an AI report: it calls
   * this once and runs `fn` without reporting. Omitted, the error is thrown.
   */
  onUnsupported?: (error: AiUsageUnsupportedError) => void;
  /**
   * Called when usage extraction fails or the commit still fails after its retries.
   * The call has run, so reporting never fails it. A failed commit's reservation
   * expires on its own. Defaults to
   * `console.error`.
   */
  onCommitError?: (error: unknown) => void;
}

export interface KaitenAiModule {
  /** Prices the estimate, gates it, and holds the credits. Throws a typed error when refused. */
  reserve(input: AiReserveInput): Promise<AiReportResult>;
  /** Newest-first, cursor-paginated inference history; returns the wire page unchanged. */
  listInferences(target: AiTarget, query?: ListAiInferencesData["query"]): Promise<AiInferencePage>;
  /** Open, unexpired reservations for this instance/pool. */
  listReservations(target: AiTarget): Promise<AiReservations>;
  /** Charges the real usage and closes the reservation. Never refused for a commercial reason. */
  commit(input: AiCommitInput): Promise<AiReportResult>;
  /** `reserve` → `fn` → `commit`, with the failure matrix of the contract. */
  run<T>(options: AiRunOptions<T>, fn: (context: AiRunContext) => Promise<T> | T): Promise<T>;
}

/**
 * How an error thrown by a provider call is committed. An error with an HTTP
 * `status` came from the provider: 5xx is the provider's failure, anything
 * else the caller's. An error without one never reached it (connection
 * refused, a bug before the request): `NOT_SENT`, nothing charged.
 */
export function classifyProviderError(error: unknown): AiRequestStatus {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number" || status === 0) return "NOT_SENT";
  return status >= 500 ? "PROVIDER_ERROR" : "CUSTOMER_ERROR";
}

/** The transient statuses a keyed AI report is replayed on. Never a 4xx. */
const RETRY_STATUSES = [500, 502, 503, 504] as const;

export function createAiModule(transport: KaitenTransport): KaitenAiModule {
  async function report(target: AiTarget, value: AiUsageValue): Promise<AiReportResult> {
    const body: AiReportBody = { value };
    if (target.metadata) body.metadata = target.metadata;
    // One key per logical call, reused by its retries. The server deduplicates
    // on (pool, transactionId, phase) whatever this says; the header is for the
    // gateway in front of it.
    const idempotencyKey = crypto.randomUUID();
    try {
      const entitlementUsage = await transport.run(
        (client) =>
          reportEntitlementUsageMetric({
            client,
            path: { instanceSlug: target.instance, entitlementSlug: target.entitlement },
            body,
            headers: { "Idempotency-Key": idempotencyKey },
          }),
        `ai.${value.phase}(${target.instance}, ${target.entitlement}, ${value.transactionId})`,
        // Keyed by `transactionId`, so a replay is answered from the first
        // attempt and nothing is charged twice: three retries, transient only.
        { idempotent: true, maxAttempts: 4, retryStatuses: RETRY_STATUSES },
      );
      return { transactionId: value.transactionId, outcome: entitlementUsage.ai, entitlementUsage };
    } catch (error) {
      throw toAiError(error);
    }
  }

  const module: KaitenAiModule = {
    listInferences: (target, query) =>
      transport.run(
        (client) =>
          listAiInferences({
            client,
            path: { instanceSlug: target.instance, entitlementSlug: target.entitlement },
            query,
          }),
        `ai.listInferences(${target.instance}, ${target.entitlement})`,
      ),
    listReservations: (target) =>
      transport.run(
        (client) =>
          listAiReservations({
            client,
            path: { instanceSlug: target.instance, entitlementSlug: target.entitlement },
          }),
        `ai.listReservations(${target.instance}, ${target.entitlement})`,
      ),
    reserve: (input) =>
      report(input, {
        type: "ai_usage",
        phase: "reserve",
        transactionId: input.transactionId ?? uuidv7(),
        model: input.model,
        requestType: input.requestType,
        ...(input.usage ? { usage: input.usage } : {}),
        ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds }),
      }),

    commit: (input) =>
      report(input, {
        type: "ai_usage",
        phase: "commit",
        transactionId: input.transactionId,
        requestStatus: input.requestStatus,
        ...(input.model ? { model: input.model } : {}),
        ...(input.requestType ? { requestType: input.requestType } : {}),
        ...(input.usage ? { usage: input.usage } : {}),
      }),

    async run<T>(
      options: AiRunOptions<T>,
      fn: (context: AiRunContext) => Promise<T> | T,
    ): Promise<T> {
      const { estimate, usage: readUsage, classifyError, onUnsupported, onCommitError } = options;
      const target: AiTarget = {
        instance: options.instance,
        entitlement: options.entitlement,
        metadata: options.metadata,
      };
      let transactionId: string;
      try {
        ({ transactionId } = await module.reserve({ ...options, usage: estimate }));
      } catch (error) {
        if (error instanceof AiUsageUnsupportedError && onUnsupported) {
          onUnsupported(error);
          return fn({ transactionId: "", setUsage: () => {} });
        }
        throw error;
      }

      let known: AiUsage | undefined;
      const settle = async (requestStatus: AiRequestStatus, usage: AiUsage | undefined) => {
        try {
          await module.commit({ ...target, transactionId, requestStatus, usage });
        } catch (error) {
          (onCommitError ?? logCommitError)(error);
        }
      };

      let result: T;
      try {
        result = await fn({ transactionId, setUsage: (usage) => void (known = usage) });
      } catch (error) {
        const status = (classifyError ?? classifyProviderError)(error);
        await settle(status, status === "NOT_SENT" ? undefined : known);
        throw error;
      }
      let actual: AiUsage | undefined;
      try {
        actual = readUsage?.(result) ?? known;
      } catch (error) {
        // Reporting is best-effort: an extractor failure must not replace the
        // successful provider result. Settle with whatever usage is known.
        (onCommitError ?? logExtractionError)(error);
        actual = known;
      }
      await settle("SUCCESS", actual);
      return result;
    },
  };
  return module;
}

function logExtractionError(error: unknown): void {
  console.error(
    "Kaiten: AI usage extraction failed. The call succeeded; committing the usage known so far.",
    error,
  );
}

function logCommitError(error: unknown): void {
  console.error(
    "Kaiten: an AI usage commit failed after its retries. The call ran and is not " +
      "charged; its reservation expires on its own.",
    error,
  );
}
