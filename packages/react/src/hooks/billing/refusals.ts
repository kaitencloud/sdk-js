import {
  BoundaryPendingError,
  KaitenError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
} from "@kaitencloud/client";

/**
 * What a refused checkout is, in the words a screen needs, read from the error the
 * client threw. The error itself stays on the hook's `error`: this is the part of it
 * a component chooses its message by, without matching a code string.
 *
 * Every refusal of a voucher is the same one, whatever its reason, and carries nothing
 * about the code.
 */
export type CheckoutProblem =
  /** The instance already uses more than the plan grants: the slugs of the entitlements that are over. */
  | { kind: "quota_exceeded"; entitlementSlugs: string[] }
  /** The customer has no billing email yet, and the checkout needs one. */
  | { kind: "billing_email_required" }
  /** The voucher code cannot be used. No reason is given, nor available. */
  | { kind: "voucher_invalid" }
  /** The instance already has a live subscription: a plan change is not a self-serve action. */
  | { kind: "already_subscribed" }
  /** The customer is back from the setup page, and no payment method was saved on it. */
  | { kind: "setup_incomplete" }
  /** The payment provider could not be reached: try again later. */
  | { kind: "unavailable"; retryAfterSeconds: number | null }
  /** Too many calls were made: the same call goes through after `retryAfterSeconds`. */
  | { kind: "rate_limited"; retryAfterSeconds: number }
  /**
   * The plan is paid, and the vendor has no payment provider that takes card payments, or none that takes
   * its currency: it cannot be bought here. The API answers both alike.
   */
  | { kind: "not_payable_online" }
  /** Anything else: read `error`. */
  | { kind: "other" };

/** A refusal whose code names `suffix`, whatever operation refused it: the code is `<Operation>.<Suffix>`. */
function refusedAs(error: unknown, status: number, suffix: string): boolean {
  return error instanceof KaitenError && error.status === status && !!error.code?.endsWith(suffix);
}

/** Whether the checkout refused a voucher code, which is what an invalid code looks like to a customer. */
export const isVoucherRefusal = (error: unknown): boolean =>
  refusedAs(error, 422, ".VoucherInvalid");

/** The problem a checkout's error is, or `null` for no error. */
export function checkoutProblem(error: unknown): CheckoutProblem | null {
  if (error === null || error === undefined) return null;
  if (error instanceof QuotaExceededError) {
    return { kind: "quota_exceeded", entitlementSlugs: error.entitlementSlugs };
  }
  if (isVoucherRefusal(error)) return { kind: "voucher_invalid" };
  if (refusedAs(error, 422, ".BillingEmailRequired")) return { kind: "billing_email_required" };
  if (refusedAs(error, 409, ".AlreadySubscribed")) return { kind: "already_subscribed" };
  if (refusedAs(error, 409, ".SetupSessionIncomplete")) return { kind: "setup_incomplete" };
  if (refusedAs(error, 422, ".ProviderCannotCapturePayment")) return { kind: "not_payable_online" };
  if (error instanceof RateLimitedError) {
    return { kind: "rate_limited", retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof ProviderUnavailableError) {
    return { kind: "unavailable", retryAfterSeconds: error.retryAfterSeconds };
  }
  return { kind: "other" };
}

/**
 * What a refused change to the quantity of an add-on is, in the words a screen needs, read from
 * the error the client threw, like {@link CheckoutProblem}. The error itself stays on the hook's
 * `error`.
 */
export type AddonQuantityProblem =
  /**
   * The add-on is not for sale: a version that is unknown, archived, unpublished, or no longer the
   * one the catalogue sells. The same change never goes through.
   */
  | { kind: "addon_not_public" }
  /** The add-on is priced in another currency than the subscription's: it cannot be attached to it. */
  | { kind: "currency_mismatch" }
  /**
   * The add-on does not fit the plan: not one of the families the plan takes, not one a scheduled
   * plan takes, no price for the subscription's billing period, or a price that meters what the
   * plan meters already. The API answers them alike.
   */
  | { kind: "incompatible" }
  /** More units than the add-on allows, or fewer than none. */
  | { kind: "quantity_exceeds_max" }
  /** The instance holds another version of the add-on's family: it is changed there, not here. */
  | { kind: "other_version_attached" }
  /** The subscription waits for the payment of its checkout: the plan starts once it is confirmed. */
  | { kind: "subscription_incomplete" }
  /** The session is bound to the customer alone: there is no instance to change the add-ons of. */
  | { kind: "instance_required" }
  /** The billing period that ended is still being closed: the same change goes through once it is. */
  | { kind: "boundary_pending"; retryAfterSeconds: number }
  /** The payment provider could not be reached: try again later. */
  | { kind: "unavailable"; retryAfterSeconds: number | null }
  /** Anything else: read `error`. */
  | { kind: "other" };

/** The problem a refused change to an add-on's quantity is, or `null` for no error. */
export function addonQuantityProblem(error: unknown): AddonQuantityProblem | null {
  if (error === null || error === undefined) return null;
  if (refusedAs(error, 422, ".AddonNotPublic")) return { kind: "addon_not_public" };
  if (refusedAs(error, 422, ".CurrencyMismatch")) return { kind: "currency_mismatch" };
  if (refusedAs(error, 422, ".Incompatible")) return { kind: "incompatible" };
  if (refusedAs(error, 422, ".QuantityExceedsMax")) return { kind: "quantity_exceeds_max" };
  if (refusedAs(error, 409, ".OtherVersionAttached")) return { kind: "other_version_attached" };
  if (refusedAs(error, 409, ".SubscriptionIncomplete")) return { kind: "subscription_incomplete" };
  if (refusedAs(error, 422, ".InstanceRequired")) return { kind: "instance_required" };
  if (error instanceof BoundaryPendingError) {
    return { kind: "boundary_pending", retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof ProviderUnavailableError) {
    return { kind: "unavailable", retryAfterSeconds: error.retryAfterSeconds };
  }
  return { kind: "other" };
}

/** Whether a refusal is the billing period that ended still being closed: one to wait out and send again. */
export const isBoundaryPending = (error: unknown): error is BoundaryPendingError =>
  error instanceof BoundaryPendingError;
