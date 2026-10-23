// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import {
  KaitenError,
  ProviderUnavailableError,
  RateLimitedError,
  type SessionRedemption,
} from "@kaitencloud/client";

/**
 * Why a code was not redeemed, in the words a screen needs, read from the error the client threw.
 * The error itself stays on the hook's `error`.
 *
 * Every refusal of the code itself is the same `voucher_invalid`, whatever its reason: unknown,
 * expired, used up, reserved for another customer, already redeemed on this instance, over the
 * limit of discounts. The API says none, and nothing here guesses.
 */
export type RedeemVoucherProblem =
  /** The code cannot be used. No reason is given, nor available. */
  | { kind: "voucher_invalid" }
  /** The subscription waits for its first payment: its checkout still holds its own selection. A code can be redeemed once the plan has started. */
  | { kind: "subscription_incomplete" }
  /** There is no live subscription to redeem a code on (none, or a canceled one), or the session is bound to the customer alone. A checkout is how one starts. */
  | { kind: "no_subscription" }
  /** Too many attempts, a preview counting as one: the same call goes through after `retryAfterSeconds`. */
  | { kind: "rate_limited"; retryAfterSeconds: number }
  /** The payment provider could not be reached: try again later. */
  | { kind: "unavailable"; retryAfterSeconds: number | null }
  /** Anything else: read `error`. */
  | { kind: "other" };

/** A refusal whose code names `suffix`, whatever operation refused it: the code is `<Operation>.<Suffix>`. */
function refusedAs(error: unknown, status: number, suffix: string): boolean {
  return error instanceof KaitenError && error.status === status && !!error.code?.endsWith(suffix);
}

/** The problem a refused redemption is, or `null` for no error. */
export function redeemVoucherProblem(error: unknown): RedeemVoucherProblem | null {
  if (error === null || error === undefined) return null;
  if (refusedAs(error, 422, ".VoucherInvalid")) return { kind: "voucher_invalid" };
  if (refusedAs(error, 409, ".SubscriptionIncomplete")) return { kind: "subscription_incomplete" };
  if (refusedAs(error, 409, ".NoLiveSubscription") || refusedAs(error, 422, ".InstanceRequired")) {
    return { kind: "no_subscription" };
  }
  if (error instanceof RateLimitedError) {
    return { kind: "rate_limited", retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof ProviderUnavailableError) {
    return { kind: "unavailable", retryAfterSeconds: error.retryAfterSeconds };
  }
  // Too many calls, whoever said so: a gateway in front of the API answers a bare 429 with no code,
  // which is not a `RateLimitedError`. The wait is the one it gave, else a minute.
  if (error instanceof KaitenError && error.status === 429) {
    return { kind: "rate_limited", retryAfterSeconds: error.retryAfterSeconds ?? 60 };
  }
  return { kind: "other" };
}

/**
 * Where a redemption is: nothing asked; the code being checked; what it gives, waiting for the
 * customer to apply it; being applied; applied; or refused.
 *
 * A minor release may add a state, which takes its case from another and never from `applied`: take
 * one you do not know as nothing redeemed.
 */
export type RedeemVoucherStatus =
  | "idle"
  | "checking"
  | "preview"
  | "applying"
  | "applied"
  | "refused";

/** What the hook holds of a redemption: never the code. */
export interface RedeemVoucherState {
  status: RedeemVoucherStatus;
  /** What the code gives (`preview`, `applying`) or gave (`applied`). */
  redemption: SessionRedemption | null;
  problem: RedeemVoucherProblem | null;
  error: Error | null;
  /**
   * When a refusal for coming too often lets another attempt through, in milliseconds since the
   * epoch (as `Date.now()` counts them). `null` when none waits.
   */
  retryAt: number | null;
}

export const initialRedeemVoucherState: RedeemVoucherState = {
  status: "idle",
  redemption: null,
  problem: null,
  error: null,
  retryAt: null,
};

export type RedeemVoucherEvent =
  | { type: "check" }
  | { type: "checked"; redemption: SessionRedemption }
  | { type: "apply" }
  | { type: "applied"; redemption: SessionRedemption }
  | { type: "refused"; error: Error; now: number }
  | { type: "reset" };

/**
 * The transitions of a redemption. A preview is checked once and applied once: an event that does
 * not belong to the state it meets (an apply with nothing previewed, a late answer after a reset)
 * changes nothing.
 */
export function redeemVoucherReducer(
  state: RedeemVoucherState,
  event: RedeemVoucherEvent,
): RedeemVoucherState {
  switch (event.type) {
    case "check":
      // A new check starts from nothing: a previous preview is not what this code gives.
      return state.status === "checking" || state.status === "applying"
        ? state
        : { ...initialRedeemVoucherState, status: "checking" };
    case "checked":
      return state.status === "checking"
        ? { ...initialRedeemVoucherState, status: "preview", redemption: event.redemption }
        : state;
    case "apply":
      return state.status === "preview" ? { ...state, status: "applying" } : state;
    case "applied":
      return state.status === "applying"
        ? { ...initialRedeemVoucherState, status: "applied", redemption: event.redemption }
        : state;
    case "refused": {
      if (state.status !== "checking" && state.status !== "applying") return state;
      const problem = redeemVoucherProblem(event.error);
      return {
        ...initialRedeemVoucherState,
        status: "refused",
        problem,
        error: event.error,
        retryAt:
          problem?.kind === "rate_limited"
            ? event.now + Math.max(1_000, problem.retryAfterSeconds * 1_000)
            : null,
      };
    }
    case "reset":
      return initialRedeemVoucherState;
  }
}
