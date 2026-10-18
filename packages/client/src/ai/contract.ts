// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The AI variant of the usage report, written by hand from the KTN-201 contract.
//
// HAND-WRITTEN UNTIL THE CONTRACT IS REGENERATED. The OpenAPI snapshot in
// `contracts/` predates the `ai_usage` variant, so the generated client knows
// neither `AiUsageValue` nor the `reserved` / `ai` members of `EntitlementUsage`.
// Every wire shape the `ai` namespace needs lives in this one file, under the
// names the contract gives them, so that the regeneration replaces this file
// with re-exports of the generated types and nothing else moves.
//
// `ai_usage` is a write-only variant: it never appears in a response, so none
// of these types is part of a read.

import type { EntitlementUsage, ReportEntitlementUsageBody } from "../core/index.ts";

/** What a model call is, as the conversion rules price it. */
export type AiRequestType = "COMPLETION" | "EMBEDDING" | "IMAGE_GENERATION" | "AUDIO" | "VIDEO";

/**
 * How the provider call ended. `NOT_SENT` means the provider was never reached:
 * nothing is charged, whatever the rule, and the reservation is released.
 */
export type AiRequestStatus = "SUCCESS" | "PROVIDER_ERROR" | "CUSTOMER_ERROR" | "NOT_SENT";

export type AiUsagePhase = "reserve" | "commit";

/**
 * Usage of one model call. Every member is optional and the token fields are
 * disjoint: total input is `inputTokens + cacheReadInputTokens +
 * cacheWriteInputTokens`. The normalisers (`fromOpenAI`, `fromAnthropic`) build
 * it from a provider's own usage object.
 */
export interface AiUsage {
  /** Input tokens neither read from nor written to a cache. */
  inputTokens?: number;
  /** Input tokens served from the provider's cache. */
  cacheReadInputTokens?: number;
  /** Input tokens written to the provider's cache. */
  cacheWriteInputTokens?: number;
  /** Output tokens, reasoning included. */
  outputTokens?: number;
  /** Generated units (images, seconds, frames), as a decimal string. */
  units?: string;
  unitType?: "image" | "second" | "frame";
  /** Billable duration, in milliseconds. */
  durationMs?: number;
}

/** `value` of a usage report, AI variant (`type: "ai_usage"`). */
export interface AiUsageValue {
  type: "ai_usage";
  phase: AiUsagePhase;
  transactionId: string;
  model?: string;
  requestType?: AiRequestType;
  requestStatus?: AiRequestStatus;
  usage?: AiUsage;
  ttlSeconds?: number;
}

/** The report body carrying the AI variant. `behavior` is omitted: it defaults to `append`. */
export interface AiReportBody {
  value: AiUsageValue;
  metadata?: Record<string, unknown>;
}

export type AiOperationStatus = "RESERVED" | "COMMITTED" | "RELEASED";

export type AiUsageWarning =
  | "MODEL_DEPRECATED"
  | "ESTIMATE_INCOMPLETE"
  | "CONVERSION_INPUT_MISSING"
  | "RESERVATION_EXPIRED"
  | "OVERDRAWN"
  | "MODEL_NOT_AUTHORIZED"
  | "UNKNOWN_MODEL";

/** `ai` member of the answer to an AI report. Credits are decimal strings. */
export interface AiUsageOutcome {
  transactionId: string;
  phase: AiUsagePhase;
  status: AiOperationStatus;
  credits: { reserved?: string; computed?: string; charged?: string };
  /** `limit − value − reserved`; null when unlimited, negative when overdrawn. */
  remaining: string | null;
  /** Reserve only. */
  expiresAt?: string;
  /** Commit only: false when no rule priced the call. */
  authorized?: boolean;
  warnings: (AiUsageWarning | (string & {}))[];
}

/** `EntitlementUsage` with the two members the AI contract adds. */
export type AiEntitlementUsage = EntitlementUsage & {
  /** Σ of the pair's open, unexpired reservations, on a credit pool. */
  reserved?: string;
  /** Present on the answer to an AI report only. */
  ai?: AiUsageOutcome;
};

/**
 * The single place the AI body crosses the generated client's request type,
 * which does not know the variant yet. Gone with the regeneration.
 */
export function asReportBody(body: AiReportBody): ReportEntitlementUsageBody {
  return body as unknown as ReportEntitlementUsageBody;
}
