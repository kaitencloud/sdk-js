// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Public AI names alias the regenerated wire contract, never a parallel schema.
import type {
  AiUsageValue as GeneratedAiUsageValue,
  AiUsageOutcome as GeneratedAiUsageOutcome,
  ReportedEntitlementUsage,
  ReportEntitlementUsageBody,
} from "../core/index.ts";

export type { AiUsage, AiUsageOutcome } from "../core/index.ts";
export type AiRequestType = NonNullable<GeneratedAiUsageValue["requestType"]>;
export type AiRequestStatus = NonNullable<GeneratedAiUsageValue["requestStatus"]>;
export type AiUsagePhase = GeneratedAiUsageValue["phase"];
// The schema permits omission so the API can return TransactionIdRequired;
// the SDK deliberately requires an operation identifier on every report.
export type AiUsageValue = GeneratedAiUsageValue & { transactionId: string };
export type AiReportBody = Omit<ReportEntitlementUsageBody, "value"> & { value: AiUsageValue };
export type AiOperationStatus = GeneratedAiUsageOutcome["status"];
export type AiUsageWarning = GeneratedAiUsageOutcome["warnings"][number];
// The answer to a report, not a read: it carries the `ai` outcome of this very
// report, and no `source` — the regenerated contract tells the two apart.
export type AiEntitlementUsage = ReportedEntitlementUsage;
