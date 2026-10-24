// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { KaitenError } from "../core/runtime/errors.ts";
import type { KaitenApiError } from "../core/runtime/errors.ts";

// Typed refusals of an AI usage report. Each extends `KaitenError`, so a host
// that already catches `KaitenError` keeps working, and `status`, `code` and
// `errorId` stay where they were.

function apiErrorOf(error: KaitenError): KaitenApiError {
  return (
    error.raw ?? {
      title: error.message,
      status: error.status,
      code: error.code,
      detail: error.detail,
    }
  );
}

/** A `reserve` whose estimate does not fit what is left in the pool (409 `ThresholdExceeded`). */
export class InsufficientCreditsError extends KaitenError {
  constructor(error: KaitenError) {
    super(apiErrorOf(error));
    this.name = "InsufficientCreditsError";
  }
}

/** A `reserve` on an archived model, or one no conversion rule prices (422 `ModelNotAuthorized`). */
export class ModelNotAuthorizedError extends KaitenError {
  constructor(error: KaitenError) {
    super(apiErrorOf(error));
    this.name = "ModelNotAuthorizedError";
  }
}

/** A `reserve` of a model the catalogue does not know, by slug or provider id (422 `UnknownModel`). */
export class UnknownModelError extends KaitenError {
  constructor(error: KaitenError) {
    super(apiErrorOf(error));
    this.name = "UnknownModelError";
  }
}

/**
 * A `transactionId` already used for this phase with another body (409
 * `TransactionIdReused`). Never retried: it is a bug in the caller, not a
 * transient failure.
 */
export class TransactionIdReusedError extends KaitenError {
  constructor(error: KaitenError) {
    super(apiErrorOf(error));
    this.name = "TransactionIdReusedError";
  }
}

/**
 * The server cannot take an AI report: the pool is not an AI credit pool
 * (`AiUsageUnsupportedEntitlement`), or the server predates the `ai_usage`
 * variant and refused the body with a 422 of its own. The provider wrappers
 * catch it once, log it, and keep calling the provider without reporting.
 */
export class AiUsageUnsupportedError extends KaitenError {
  constructor(error: KaitenError) {
    super(apiErrorOf(error));
    this.name = "AiUsageUnsupportedError";
  }
}

/** The reason part of a `UseCase.Reason` code. */
function reasonOf(code: string | undefined): string | undefined {
  return code?.slice(code.lastIndexOf(".") + 1);
}

/**
 * 422 codes the AI contract defines for a malformed body. A 422 carrying one of
 * them is a bug in the request and surfaces as the `KaitenError` it is; any
 * other 422 on an AI report comes from a server that does not know the variant.
 */
const MALFORMED_AI_BODY = new Set([
  "TransactionIdRequired",
  "InvalidTransactionId",
  "InvalidAiUsage",
  "AiUsageRequiresAppend",
  "AiIdempotencyKeyUnsupported",
  "AiCreditPoolAppendOnly",
]);

/** Maps a failed AI report onto its typed error. Anything else is returned unchanged. */
export function toAiError(error: unknown): unknown {
  if (!(error instanceof KaitenError)) return error;
  const reason = reasonOf(error.code);
  if (error.status === 409) {
    if (reason === "ThresholdExceeded") return new InsufficientCreditsError(error);
    if (reason === "TransactionIdReused") return new TransactionIdReusedError(error);
    return error;
  }
  if (error.status === 422) {
    if (reason === "ModelNotAuthorized") return new ModelNotAuthorizedError(error);
    if (reason === "UnknownModel") return new UnknownModelError(error);
    if (reason && MALFORMED_AI_BODY.has(reason)) return error;
    return new AiUsageUnsupportedError(error);
  }
  return error;
}
