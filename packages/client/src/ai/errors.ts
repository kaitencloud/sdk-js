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
 * The server cannot take an AI report: it predates the `ai_usage` variant and
 * refused the body with a 422 of its own. The provider wrappers catch it once,
 * log it, and keep calling the provider without reporting.
 *
 * A pool that is not an AI credit pool is NOT this error: that is a
 * configuration mistake, refused on every call with {@link NotAnAiCreditPoolError}.
 */
export class AiUsageUnsupportedError extends KaitenError {
  constructor(error: KaitenError) {
    super(apiErrorOf(error));
    this.name = "AiUsageUnsupportedError";
  }
}

/**
 * The entitlement is not an AI credit pool (422 `AiUsageUnsupportedEntitlement`).
 * A configuration mistake, never a reason to run unmetered: the wrappers and
 * `run` throw it on every call, before the provider is called.
 */
export class NotAnAiCreditPoolError extends KaitenError {
  constructor(error: KaitenError) {
    super(apiErrorOf(error));
    this.name = "NotAnAiCreditPoolError";
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
    if (reason === "AiUsageUnsupportedEntitlement") return new NotAnAiCreditPoolError(error);
    if (reason && MALFORMED_AI_BODY.has(reason)) return error;
    return new AiUsageUnsupportedError(error);
  }
  return error;
}

/** The `RefundAiInference.*` reasons the refund operation defines. Open: more may come. */
export type AiRefundErrorReason =
  | "ContextNotFound"
  | "InferenceNotFound"
  | "NotCommitted"
  | "NothingToRefund"
  | "ExceedsRefundable"
  | "IdempotencyKeyReused"
  | "PoolNotGranted"
  | "IdempotencyKeyRequired"
  | "InvalidIdempotencyKey"
  | "InvalidAmount"
  | "InvalidReason"
  | (string & {});

/**
 * A refused refund (`RefundAiInference.*`). `reason` names the refusal; the
 * subclasses below are the ones a caller acts on. The 422 reasons
 * (`InvalidAmount`, `InvalidReason`, `IdempotencyKeyRequired`,
 * `InvalidIdempotencyKey`) are caller bugs and arrive as this class itself.
 */
export class AiRefundError extends KaitenError {
  readonly reason: AiRefundErrorReason;
  constructor(error: KaitenError, reason: AiRefundErrorReason) {
    super(apiErrorOf(error));
    this.name = "AiRefundError";
    this.reason = reason;
  }
}

/** 404 `ContextNotFound` (no such instance/pool) or `InferenceNotFound` (no such transaction on it). */
export class AiInferenceNotFoundError extends AiRefundError {
  constructor(error: KaitenError, reason: AiRefundErrorReason) {
    super(error, reason);
    this.name = "AiInferenceNotFoundError";
  }
}

/** 409 `NotCommitted`: the inference is RESERVED, RELEASED (a tombstone included) or EXPIRED. */
export class AiInferenceNotCommittedError extends AiRefundError {
  constructor(error: KaitenError) {
    super(error, "NotCommitted");
    this.name = "AiInferenceNotCommittedError";
  }
}

/** 409 `NothingToRefund`: the inference charged nothing, or is already refunded in full. */
export class NothingToRefundError extends AiRefundError {
  constructor(error: KaitenError) {
    super(error, "NothingToRefund");
    this.name = "NothingToRefundError";
  }
}

/** 409 `ExceedsRefundable`: more credits than are left. `refundable` is what is left. */
export class RefundExceedsRefundableError extends AiRefundError {
  /** What the inference still has to give back, as the server's exact decimal string. */
  readonly refundable: string | undefined;
  constructor(error: KaitenError) {
    super(error, "ExceedsRefundable");
    this.name = "RefundExceedsRefundableError";
    const value = error.errors?.[0]?.value;
    this.refundable = typeof value === "string" ? value : undefined;
  }
}

/**
 * 409 `IdempotencyKeyReused`: the key already holds another refund, another
 * body, or a numeric report of the pool. Never retried.
 */
export class RefundIdempotencyKeyReusedError extends AiRefundError {
  constructor(error: KaitenError) {
    super(error, "IdempotencyKeyReused");
    this.name = "RefundIdempotencyKeyReusedError";
  }
}

/** 409 `PoolNotGranted`: the instance no longer holds the pool, so nothing can be given back to it. */
export class AiPoolNotGrantedError extends AiRefundError {
  constructor(error: KaitenError) {
    super(error, "PoolNotGranted");
    this.name = "AiPoolNotGrantedError";
  }
}

const REFUND_PREFIX = "RefundAiInference.";

/** Maps a failed refund onto its typed error. Anything else is returned unchanged. */
export function toAiRefundError(error: unknown): unknown {
  if (!(error instanceof KaitenError) || !error.code?.startsWith(REFUND_PREFIX)) return error;
  const reason = error.code.slice(REFUND_PREFIX.length);
  switch (reason) {
    case "ContextNotFound":
    case "InferenceNotFound":
      return new AiInferenceNotFoundError(error, reason);
    case "NotCommitted":
      return new AiInferenceNotCommittedError(error);
    case "NothingToRefund":
      return new NothingToRefundError(error);
    case "ExceedsRefundable":
      return new RefundExceedsRefundableError(error);
    case "IdempotencyKeyReused":
      return new RefundIdempotencyKeyReusedError(error);
    case "PoolNotGranted":
      return new AiPoolNotGrantedError(error);
    default:
      return new AiRefundError(error, reason);
  }
}
