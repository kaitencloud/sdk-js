import type { EvaluationFailure, EvaluationResult, EvaluationSuccess } from "./types.ts";

/**
 * A successful flag evaluation, generic over the flag's value type. Mirrors the
 * generated `EvaluationSuccess` but lets callers narrow `value` from `unknown`
 * (e.g. `useFeatureFlag<boolean>`), instead of casting at every call site.
 */
export interface FeatureFlagEvaluation<T = unknown> {
  key: string;
  value?: T;
  variant?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Narrows an `EvaluationResult` to a success. The OFREP union has no structural
 * discriminant field; success vs failure is told apart by the presence of an
 * OpenFeature `errorCode`. Use this instead of hand-rolling `"errorCode" in r`.
 */
export function isEvaluationSuccess(result: EvaluationResult): result is EvaluationSuccess {
  return !("errorCode" in result);
}

/** Narrows an `EvaluationResult` to a failure (carries an OpenFeature `errorCode`). */
export function isEvaluationFailure(result: EvaluationResult): result is EvaluationFailure {
  return "errorCode" in result;
}
