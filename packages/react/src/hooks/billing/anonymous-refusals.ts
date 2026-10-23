// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import {
  CheckoutSessionClosedError,
  CheckoutTokenMissingError,
  DueTodayChangedError,
  KaitenError,
  KaitenNetworkError,
  ProviderUnavailableError,
  RateLimitedError,
  TurnstileFailedError,
  TurnstileUnavailableError,
} from "@kaitencloud/client";

/**
 * What a refusal of an anonymous checkout is, in the words a screen needs, read from the error the
 * client threw. The error itself stays on the hook's `error`: this is the part of it a component
 * chooses its message by, without matching a code string.
 *
 * Nothing in it says anything about the visitor's e-mail, and a voucher code is refused the same
 * way for every reason, as everywhere else.
 */
export type AnonymousCheckoutProblem =
  /** The Turnstile token was refused: invalid, expired, already used, or from another site. The visitor passes the check again. */
  | { kind: "turnstile_failed" }
  /** Cloudflare could not be reached from the API: wait, and the same start goes through. */
  | { kind: "turnstile_unavailable"; retryAfterSeconds: number }
  /** Too many calls were made, from the visitor's address or with the publishable key: the same call goes through after the wait. */
  | { kind: "rate_limited"; retryAfterSeconds: number }
  /** The payment provider, or the quota check, could not be reached: try again later. */
  | { kind: "unavailable"; retryAfterSeconds: number | null }
  /**
   * The publishable key does not allow an anonymous checkout, has no Turnstile secret, is not the
   * kind of credential the start takes, or the `returnUrl` is not on its allowed origins. A
   * configuration to fix, not a visitor's: trying again cannot help.
   */
  | { kind: "not_available" }
  /** The plan is sold by contact only. */
  | { kind: "not_self_serve" }
  /** The plan, or its price, is not for sale as it was chosen: not public any more, not a flat fee, or it cannot be sold without a fallback. */
  | { kind: "plan_not_available" }
  /** The plan is paid and the vendor has no payment provider that takes cards, or none that takes its currency. */
  | { kind: "not_payable_online" }
  /** An add-on was refused: not for sale, more than allowed, or in another currency. */
  | { kind: "addon_refused" }
  /** The voucher code cannot be used. No reason is given, nor available. */
  | { kind: "voucher_invalid" }
  /** The e-mail address is not one the API accepts. */
  | { kind: "invalid_email" }
  /** The vendor cannot take another customer or instance: its quota is reached. */
  | { kind: "quota_reached" }
  /** The session is closed already; `status` says how (`COMPLETED`, `ABANDONED`, `EXPIRED`). */
  | { kind: "session_closed"; status: string | null }
  /** This browser holds no token for the session, or the API refused it: the session may have completed meanwhile. */
  | { kind: "session_lost" }
  /** The amount due changed after the payment method was saved: nothing was charged, and the visitor starts again. */
  | { kind: "due_today_changed" }
  /** The request never reached the API. */
  | { kind: "network" }
  /** Anything else: read `error`. */
  | { kind: "other" };

/** A refusal whose code names `suffix`, whatever operation refused it: the code is `<Operation>.<Suffix>`. */
function refusedAs(error: unknown, status: number, suffix: string): boolean {
  return error instanceof KaitenError && error.status === status && !!error.code?.endsWith(suffix);
}

/**
 * What an error was thrown by: the start (or a preview), which names no session and answers with the
 * publishable key alone, or a call about a session (the confirm and the reads), which holds that
 * session's token.
 */
export type AnonymousCheckoutOperation = "start" | "session";

/**
 * The problem an error of an anonymous checkout is, or `null` for no error.
 *
 * `operation` matters for a refused credential. On a session, a 401 means this browser's token for
 * it is no good (`session_lost`). On the start there is no token: a 401, or a 403
 * `Auth.WrongCredentialKind`, is the publishable key that was refused, which is the host's
 * configuration (`not_available`), and says nothing about a session the visitor could have lost.
 */
export function anonymousCheckoutProblem(
  error: unknown,
  operation: AnonymousCheckoutOperation = "session",
): AnonymousCheckoutProblem | null {
  if (error === null || error === undefined) return null;
  if (error instanceof TurnstileFailedError) return { kind: "turnstile_failed" };
  if (error instanceof TurnstileUnavailableError) {
    return { kind: "turnstile_unavailable", retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof RateLimitedError) {
    return { kind: "rate_limited", retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof CheckoutTokenMissingError) return { kind: "session_lost" };
  if (error instanceof CheckoutSessionClosedError) {
    return { kind: "session_closed", status: error.sessionStatus ?? null };
  }
  if (error instanceof DueTodayChangedError) return { kind: "due_today_changed" };
  if (error instanceof KaitenNetworkError) return { kind: "network" };
  if (error instanceof ProviderUnavailableError) {
    return { kind: "unavailable", retryAfterSeconds: error.retryAfterSeconds };
  }
  if (!(error instanceof KaitenError)) return { kind: "other" };

  if (operation === "session") {
    // The token of a session was refused: forgotten by the client, and no use to this browser any more.
    if (error.status === 401) return { kind: "session_lost" };
  } else if (error.status === 401 || refusedAs(error, 403, "Auth.WrongCredentialKind")) {
    // The publishable key itself was refused, and no session exists yet to have lost.
    return { kind: "not_available" };
  }
  if (
    refusedAs(error, 403, ".AnonymousCheckoutDisabled") ||
    refusedAs(error, 422, ".TurnstileNotConfigured") ||
    refusedAs(error, 422, ".InvalidReturnUrl")
  ) {
    return { kind: "not_available" };
  }
  if (refusedAs(error, 422, ".NotSelfServe")) return { kind: "not_self_serve" };
  if (
    refusedAs(error, 422, ".PriceNotPublic") ||
    refusedAs(error, 422, ".PriceNotFlatFee") ||
    refusedAs(error, 422, ".InvalidPriceSelection") ||
    refusedAs(error, 422, ".FallbackRequired")
  ) {
    return { kind: "plan_not_available" };
  }
  if (refusedAs(error, 422, ".ProviderCannotCapturePayment")) return { kind: "not_payable_online" };
  if (
    refusedAs(error, 422, ".AddonNotPublic") ||
    refusedAs(error, 422, ".QuantityExceedsMax") ||
    refusedAs(error, 422, ".CurrencyMismatch")
  ) {
    return { kind: "addon_refused" };
  }
  if (refusedAs(error, 422, ".VoucherInvalid")) return { kind: "voucher_invalid" };
  if (refusedAs(error, 422, ".InvalidEmail")) return { kind: "invalid_email" };
  if (refusedAs(error, 409, ".EntitlementLimitReached")) return { kind: "quota_reached" };
  if (error.status === 503 && error.code === "Entitlement.VerificationUnavailable") {
    return { kind: "unavailable", retryAfterSeconds: error.retryAfterSeconds ?? null };
  }
  return { kind: "other" };
}
