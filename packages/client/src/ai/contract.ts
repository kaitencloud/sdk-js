// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Public AI names alias the regenerated wire contract, never a parallel schema.
import type {
  AiInference as GeneratedAiInference,
  AiUsageValue as GeneratedAiUsageValue,
  AiUsageOutcome as GeneratedAiUsageOutcome,
  ReportEntitlementUsageBody,
} from "../core/index.ts";
import type { EntitlementUsage } from "../client/types.ts";

export type {
  AiInferencePricing,
  AiInferenceRefund,
  AiUsage,
  AiUsageOutcome,
  AiUsageRule,
  AiVendorCost,
  NewAiInferenceRefund,
  OrganizationAiInference,
  OrganizationAiInferencePage,
} from "../core/index.ts";
export type AiRequestType = NonNullable<GeneratedAiUsageValue["requestType"]>;
export type AiRequestStatus = NonNullable<GeneratedAiUsageValue["requestStatus"]>;
export type AiUsagePhase = GeneratedAiUsageValue["phase"];
// The schema permits omission so the API can return TransactionIdRequired;
// the SDK deliberately requires an operation identifier on every report.
export type AiUsageValue = GeneratedAiUsageValue & { transactionId: string };
export type AiReportBody = Omit<ReportEntitlementUsageBody, "value"> & { value: AiUsageValue };
export type AiOperationStatus = GeneratedAiUsageOutcome["status"];
/** How specific the conversion rule that priced a phase is. */
export type AiRuleSpecificity = NonNullable<GeneratedAiUsageOutcome["rule"]>["specificity"];

/**
 * A warning on a report's answer or on an inference row. The contract types
 * warnings as plain strings and the server adds new ones without notice, so the
 * union is open: a warning this SDK does not know is still a `string`, still
 * type-checks, and is passed through untouched.
 *
 * - `NO_RESERVATION`: a release (`NOT_SENT` commit) for a transaction that
 *   never reserved. It leaves a tombstone: a later reserve or commit under the
 *   same `transactionId` is refused with 409 `TransactionIdReused`.
 * - `COUNTER_PRECISION_DEGRADED`: the commit was accepted, but the pool's
 *   counter could not hold the exact charge.
 * - `PRICING_SNAPSHOT_UNREADABLE`: on an inference row, the pricing snapshot
 *   could not be read back.
 */
export type AiUsageWarning =
  | "MODEL_DEPRECATED"
  | "ESTIMATE_INCOMPLETE"
  | "RESERVATION_EXPIRED"
  | "MODEL_NOT_AUTHORIZED"
  | "UNKNOWN_MODEL"
  | "CONVERSION_INPUT_MISSING"
  | "OVERDRAWN"
  | "NO_RESERVATION"
  | "COUNTER_PRECISION_DEGRADED"
  | "PRICING_SNAPSHOT_UNREADABLE"
  | (string & {});

/**
 * What a report answers: the pool's usage after the call, and its `ai` outcome.
 * The usage members the billing contract added (`source`, `provenance`,
 * `transactionId`) are optional here, as on {@link EntitlementUsage}: an older
 * server does not send them.
 */
export type AiEntitlementUsage = EntitlementUsage & {
  /** The numeric-report key the answer was accepted under: always `null` for AI usage. */
  transactionId?: string | null;
};

/** One row of an instance pool's inference history. */
export type AiInference = GeneratedAiInference;
