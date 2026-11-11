// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import {
  reportEntitlementUsageMetric,
  listAiInferences,
  listAiReservations,
  listOrganizationAiInferences,
  refundAiInference,
} from "../core/index.ts";
import type {
  KaitenTransport,
  ListAiInferencesData,
  ListOrganizationAiInferencesData,
  AiInferencePage,
  AiReservations,
} from "../core/index.ts";
import type {
  AiEntitlementUsage,
  AiInferenceRefund,
  AiReportBody,
  AiRequestStatus,
  AiRequestType,
  AiUsage,
  AiUsageOutcome,
  AiUsageValue,
  OrganizationAiInferencePage,
} from "./contract.ts";
import { AiUsageUnsupportedError, toAiError, toAiRefundError } from "./errors.ts";
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
  /**
   * What the provider charged for this request, in USD, as an exact decimal
   * string (`"0.0125"`, at most 12 digits on each side of the point). Recorded
   * beside the cost Kaiten computes from the model catalogue; it never changes
   * the credits charged. Commit only, and never on a `NOT_SENT` commit.
   *
   * A string, never a number: it is part of the commit's identity, so a retry
   * must send the byte-identical value (`"0.01"` and `"0.010"` are two
   * different commits, and the second is refused with
   * `TransactionIdReusedError`). Pass the provider's own figure, unchanged;
   * the SDK never computes one.
   */
  vendorCost?: string;
}

/** A release: the call was never sent, so its reservation, if any, is given back. */
export interface AiReleaseInput extends AiTarget {
  transactionId: string;
  /** Optional: the server needs neither on a release. */
  model?: string;
  requestType?: AiRequestType;
}

export interface AiRefundInput extends AiTarget {
  /** The committed inference to refund. */
  transactionId: string;
  /** Credits to give back, a positive decimal string. Omitted, everything left is refunded. */
  credits?: string;
  /** Why, kept with the refund. Anyone who can read the organization's instances can read it. */
  reason?: string;
  /**
   * The refund's idempotency key (`[A-Za-z0-9._:-]{1,128}`). Generated (a
   * UUIDv7) when omitted, and reused on the SDK's own retries. Pass your own
   * to make a refund safe across your process restarts, and reuse it when you
   * retry the same refund yourself.
   */
  idempotencyKey?: string;
}

export interface AiReportResult {
  transactionId: string;
  /** The `ai` member of the answer: status, credits, remaining, warnings, the pricing `rule`. */
  outcome?: AiUsageOutcome;
  /** The whole answer: the pool's usage after this call. */
  entitlementUsage: AiEntitlementUsage;
}

/** A commit that failed after its retries, handed to `onCommitError`. */
export interface AiFailedCommit {
  readonly transactionId: string;
  /** The exact commit that failed. */
  readonly input: AiCommitInput;
  /**
   * Sends the same commit again, byte for byte (same `transactionId`, same
   * usage, same `vendorCost` string), so it is safe to call later: a commit
   * that did land is answered from the first one, not charged twice.
   */
  retry(): Promise<AiReportResult>;
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
  /**
   * Reads what the provider charged off `fn`'s result, as an exact decimal
   * string in USD (see {@link AiCommitInput.vendorCost}). Only for a provider
   * that reports its own cost; never compute one from a price list. A throw or
   * an invalid value drops it, reported to `onCommitError`; the commit goes on.
   */
  vendorCost?: (result: T) => string | undefined;
  /** How a thrown error is committed. Defaults to {@link classifyProviderError}. */
  classifyError?: (error: unknown) => AiRequestStatus;
  /**
   * Given, `run` degrades when the server cannot take an AI report: it calls
   * this once and runs `fn` without reporting. Omitted, the error is thrown.
   * A pool that is not an AI credit pool always throws `NotAnAiCreditPoolError`.
   */
  onUnsupported?: (error: AiUsageUnsupportedError) => void;
  /**
   * Called when usage or cost extraction fails, or the commit still fails
   * after its retries. The call has run, so reporting never fails it. A failed
   * commit's reservation expires on its own; `failed` carries the commit so it
   * can be persisted and retried. Defaults to `console.error`.
   */
  onCommitError?: (error: unknown, failed?: AiFailedCommit) => void;
}

export interface KaitenAiModule {
  /** Prices the estimate, gates it, and holds the credits. Throws a typed error when refused. */
  reserve(input: AiReserveInput): Promise<AiReportResult>;
  /**
   * Newest-first, cursor-paginated inference history of one pool. The page is
   * the server's, with `nextCursor`, `hasMore` and nullable `items`; the only
   * change is that a row from a server predating them gets `refunds: []` and
   * `warnings: []`, so the arrays the contract requires are always there.
   */
  listInferences(target: AiTarget, query?: ListAiInferencesData["query"]): Promise<AiInferencePage>;
  /**
   * The organization's inference history across instances and pools
   * (`read:instances`), same rows plus `instanceSlug` and `entitlementSlug`,
   * same cursor convention as {@link listInferences}.
   */
  listOrganizationInferences(
    query?: ListOrganizationAiInferencesData["query"],
  ): Promise<OrganizationAiInferencePage>;
  /** Open, unexpired reservations for this instance/pool. */
  listReservations(target: AiTarget): Promise<AiReservations>;
  /** Charges the real usage and closes the reservation. Never refused for a commercial reason. */
  commit(input: AiCommitInput): Promise<AiReportResult>;
  /**
   * A `NOT_SENT` commit: gives the reservation back. Without a reservation the
   * server answers `RELEASED` with the `NO_RESERVATION` warning and keeps a
   * tombstone, so a reserve or commit that arrives later under the same
   * `transactionId` is refused with `TransactionIdReusedError`. That makes it
   * the way to close a reserve whose answer was lost.
   */
  release(input: AiReleaseInput): Promise<AiReportResult>;
  /**
   * Gives credits of a committed inference back to its pool (`write:instances`).
   * Throws an `AiRefundError` subclass when refused.
   */
  refund(input: AiRefundInput): Promise<AiInferenceRefund>;
  /** `reserve` → `fn` → `commit`, with the failure matrix of the contract. */
  run<T>(options: AiRunOptions<T>, fn: (context: AiRunContext) => Promise<T> | T): Promise<T>;
}

/** The constructor names an error, or any of its ancestors, carries. */
function errorNames(error: object): string[] {
  const names: string[] = [];
  const own = (error as { name?: unknown }).name;
  if (typeof own === "string") names.push(own);
  for (let proto = Object.getPrototypeOf(error); proto; proto = Object.getPrototypeOf(proto)) {
    const name = (proto as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof name === "string") names.push(name);
  }
  return names;
}

/** A caller's cancellation: the request may well have been sent already. */
const ABORT_ERRORS = new Set(["AbortError", "APIUserAbortError"]);
/** A deadline that fired while waiting for the provider, after the request left. */
const TIMEOUT_ERRORS = new Set(["TimeoutError", "APIConnectionTimeoutError"]);

/**
 * How an error thrown by a provider call is committed. An error with an HTTP
 * `status` (or `statusCode`, as the Vercel AI SDK names it) came from the
 * provider: 5xx is the provider's failure, anything else the caller's. A
 * cancellation (`AbortError`, `APIUserAbortError`) is the caller's and a timeout
 * the provider's, never `NOT_SENT`: the request may already have been sent. Any
 * other error without a status never reached the provider (connection refused,
 * a bug before the request): `NOT_SENT`, nothing charged.
 */
export function classifyProviderError(error: unknown): AiRequestStatus {
  if (!error || typeof error !== "object") return "NOT_SENT";
  const raw = error as { status?: unknown; statusCode?: unknown };
  const status =
    typeof raw.status === "number" && raw.status !== 0
      ? raw.status
      : typeof raw.statusCode === "number" && raw.statusCode !== 0
        ? raw.statusCode
        : undefined;
  if (status !== undefined) return status >= 500 ? "PROVIDER_ERROR" : "CUSTOMER_ERROR";
  const names = errorNames(error);
  if (names.some((name) => ABORT_ERRORS.has(name))) return "CUSTOMER_ERROR";
  if (names.some((name) => TIMEOUT_ERRORS.has(name))) return "PROVIDER_ERROR";
  return "NOT_SENT";
}

/** The contract's `vendorCost` pattern: up to 12 digits, then up to 12 decimals. */
const VENDOR_COST = /^[0-9]{1,12}(\.[0-9]{1,12})?$/;

/**
 * True for a value the API takes as `vendorCost`: a non-negative decimal
 * string, at most 12 digits on each side of the point, no exponent, no sign.
 */
export function isVendorCost(value: unknown): value is string {
  return typeof value === "string" && VENDOR_COST.test(value);
}

/** The transient statuses a keyed AI report is replayed on. Never a 4xx. */
const RETRY_STATUSES = [500, 502, 503, 504] as const;
/** The same retry budget as a report: the refund is keyed too. */
const KEYED_RETRY = { idempotent: true, maxAttempts: 4, retryStatuses: RETRY_STATUSES } as const;

/** Fills the arrays the contract requires on a row from a server that predates them. */
function withRowDefaults<P extends { items: unknown[] | null }>(page: P): P {
  if (!page || !Array.isArray(page.items)) return page;
  return {
    ...page,
    items: page.items.map((row) => {
      const item = row as { refunds?: unknown; warnings?: unknown };
      if (Array.isArray(item.refunds) && Array.isArray(item.warnings)) return row;
      return {
        ...item,
        refunds: Array.isArray(item.refunds) ? item.refunds : [],
        warnings: Array.isArray(item.warnings) ? item.warnings : [],
      };
    }),
  };
}

export function createAiModule(transport: KaitenTransport): KaitenAiModule {
  async function report(target: AiTarget, value: AiUsageValue): Promise<AiReportResult> {
    const body: AiReportBody = { value };
    if (target.metadata) body.metadata = target.metadata;
    try {
      const entitlementUsage = await transport.run(
        (client) =>
          reportEntitlementUsageMetric({
            client,
            path: { instanceSlug: target.instance, entitlementSlug: target.entitlement },
            // The same object on every attempt: each retry serialises the
            // same members in the same order, so `vendorCost` and the rest
            // reach the server byte-identical.
            body,
            // AI phase replay uses transactionId, never the numeric-report
            // header. `null` also removes a key inherited from transport
            // defaults; the generated type only knows strings.
            headers: { "Idempotency-Key": null } as unknown as { "Idempotency-Key"?: string },
          }),
        `ai.${value.phase}(${target.instance}, ${target.entitlement}, ${value.transactionId})`,
        // Keyed by `transactionId`, so a replay is answered from the first
        // attempt and nothing is charged twice: three retries, transient only.
        KEYED_RETRY,
      );
      return {
        transactionId: value.transactionId,
        outcome: entitlementUsage.ai,
        entitlementUsage: entitlementUsage as AiEntitlementUsage,
      };
    } catch (error) {
      throw toAiError(error);
    }
  }

  function commitValue(input: AiCommitInput, withVendorCost: boolean): AiUsageValue {
    return {
      type: "ai_usage",
      phase: "commit",
      transactionId: input.transactionId,
      requestStatus: input.requestStatus,
      ...(input.model ? { model: input.model } : {}),
      ...(input.requestType ? { requestType: input.requestType } : {}),
      ...(input.usage ? { usage: input.usage } : {}),
      ...(withVendorCost && input.vendorCost !== undefined ? { vendorCost: input.vendorCost } : {}),
    };
  }

  async function commit(input: AiCommitInput): Promise<AiReportResult> {
    if (input.vendorCost !== undefined) {
      if (!isVendorCost(input.vendorCost)) {
        throw new TypeError(
          `Kaiten ai.commit: vendorCost must be a decimal string such as "0.0125" ` +
            `(received ${JSON.stringify(input.vendorCost)}).`,
        );
      }
      if (input.requestStatus === "NOT_SENT") {
        throw new TypeError("Kaiten ai.commit: a NOT_SENT commit cannot carry a vendorCost.");
      }
    }
    try {
      return await report(input, commitValue(input, true));
    } catch (error) {
      // A server that predates `vendorCost` refuses the unknown member with a
      // 422 of its own, before recording anything. The charge matters more
      // than the evidence: commit again without it. A current server answers
      // a bad vendorCost with InvalidAiUsage, which is not this error.
      if (!(error instanceof AiUsageUnsupportedError) || input.vendorCost === undefined) {
        throw error;
      }
      console.warn(
        `Kaiten: the API refused vendorCost on the commit of ${input.transactionId}; it predates ` +
          `vendor costs. Committing without it.`,
      );
      return report(input, commitValue(input, false));
    }
  }

  const module: KaitenAiModule = {
    listInferences: async (target, query) =>
      withRowDefaults(
        await transport.run(
          (client) =>
            listAiInferences({
              client,
              path: { instanceSlug: target.instance, entitlementSlug: target.entitlement },
              query,
            }),
          `ai.listInferences(${target.instance}, ${target.entitlement})`,
        ),
      ),
    listOrganizationInferences: async (query) =>
      withRowDefaults(
        await transport.run(
          (client) => listOrganizationAiInferences({ client, query }),
          "ai.listOrganizationInferences()",
        ),
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

    commit,

    release: (input) =>
      commit({
        instance: input.instance,
        entitlement: input.entitlement,
        metadata: input.metadata,
        transactionId: input.transactionId,
        requestStatus: "NOT_SENT",
        model: input.model,
        requestType: input.requestType,
      }),

    async refund(input) {
      // Generated once, outside the retry loop: every attempt carries it.
      const key = input.idempotencyKey ?? uuidv7();
      const body = {
        ...(input.credits === undefined ? {} : { credits: input.credits }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      };
      try {
        return await transport.run(
          (client) =>
            refundAiInference({
              client,
              path: {
                instanceSlug: input.instance,
                entitlementSlug: input.entitlement,
                transactionId: input.transactionId,
              },
              body,
              headers: { "Idempotency-Key": key },
            }),
          `ai.refund(${input.instance}, ${input.entitlement}, ${input.transactionId})`,
          KEYED_RETRY,
        );
      } catch (error) {
        throw toAiRefundError(error);
      }
    },

    async run<T>(
      options: AiRunOptions<T>,
      fn: (context: AiRunContext) => Promise<T> | T,
    ): Promise<T> {
      const {
        estimate,
        usage: readUsage,
        vendorCost: readVendorCost,
        classifyError,
        onUnsupported,
        onCommitError,
      } = options;
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
      const settle = async (
        requestStatus: AiRequestStatus,
        usage: AiUsage | undefined,
        vendorCost?: string,
      ) => {
        const input: AiCommitInput = { ...target, transactionId, requestStatus, usage };
        if (vendorCost !== undefined) input.vendorCost = vendorCost;
        try {
          await module.commit(input);
        } catch (error) {
          const failed: AiFailedCommit = {
            transactionId,
            input,
            retry: () => module.commit(input),
          };
          if (onCommitError) onCommitError(error, failed);
          else logCommitError(error);
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
      let cost: string | undefined;
      try {
        cost = readVendorCost?.(result);
        if (cost !== undefined && !isVendorCost(cost)) {
          throw new TypeError(
            `Kaiten: vendorCost must be a decimal string (received ${JSON.stringify(cost)}).`,
          );
        }
      } catch (error) {
        (onCommitError ?? logExtractionError)(error);
        cost = undefined;
      }
      await settle("SUCCESS", actual, cost);
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
