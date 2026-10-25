// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import {
  formatKaitenPrice,
  usePortal,
  type KaitenLocalization,
  type KaitenPortal,
  type KaitenSubscriptionWords,
  type PortalSubscription,
} from "@kaitencloud/react";

// What a customer session's portal says of a subscription, in the six states a screen tells apart,
// and what each is called. `CurrentPlan`, `BillingSummary` and `Paywall` read it from here, so that
// the three say the same thing of the same subscription.
//
// It reads the subscription, never the licence: billing does not move a licence's end date, so
// nothing here looks at `endLicenseDate` or at the term made from it.

/**
 * - `unbound`: the session is bound to the customer only, so there is no instance and no subscription.
 * - `unsubscribed`: an instance that has no subscription, or never had one.
 * - `incomplete`: a checkout that waits for its first payment. What it bought starts once that is
 *   confirmed: until then the instance keeps the plan and the limits it had.
 * - `trial`, `active`, `past_due`, `canceled`: the subscription's status.
 * - `unknown`: a status the API may add, which is shown by what the subscription says of its period.
 */
export type SubscriptionStateKind =
  | "unbound"
  | "unsubscribed"
  | "incomplete"
  | "trial"
  | "active"
  | "past_due"
  | "canceled"
  | "unknown";

export interface SubscriptionState {
  kind: SubscriptionStateKind;
  subscription: PortalSubscription | null;
  /** The subscription is canceled and runs until the end of its period. Never true once it is `canceled`. */
  ending: boolean;
  /** What a customer can do by themselves, as the portal says it. */
  capabilities: KaitenPortal["capabilities"];
  currentPlan?: string;
}

/** The state of the portal's subscription, `null` when there is no portal to read. */
export function subscriptionStateOf(portal: KaitenPortal | undefined): SubscriptionState | null {
  if (!portal) return null;
  const { subscription, instance, capabilities } = portal;
  if (instance === null)
    return { kind: "unbound", subscription: null, ending: false, capabilities };
  if (subscription === null) {
    return { kind: "unsubscribed", subscription: null, ending: false, capabilities };
  }
  const kind: SubscriptionStateKind =
    subscription.status === "INCOMPLETE"
      ? "incomplete"
      : subscription.status === "TRIAL"
        ? "trial"
        : subscription.status === "ACTIVE"
          ? "active"
          : subscription.status === "PAST_DUE"
            ? "past_due"
            : subscription.status === "CANCELED"
              ? "canceled"
              : "unknown";
  return {
    kind,
    subscription,
    ending: subscription.cancelAtPeriodEnd && kind !== "canceled",
    capabilities,
    currentPlan: instance.licenseName,
  };
}

/** The state of the customer session's subscription, `null` under any other mode and while it loads. */
export function useSubscriptionState(): SubscriptionState | null {
  return subscriptionStateOf(usePortal().data);
}

export type StatusTone = "neutral" | "warning" | "success";

export interface SubscriptionDescription {
  /** The status in a word: "Trial", "Awaiting payment", "Payment failed", "Canceled". `null` for a subscription that is simply running. */
  status: { label: string; tone: StatusTone } | null;
  /** When it renews, ends or leaves its trial. */
  detail: string | null;
  /** A plan change that is scheduled, said once. */
  change: string | null;
  /** A sentence for a subscription that needs saying more of: waiting for its first payment, past due, or over. */
  notice: string | null;
}

/**
 * What a subscription is called, from the words of the language. `renewsOn` is the core's
 * (`currentPlan.renewsOn`): a running subscription renews, and a subscription that is canceled
 * or past due is not said to.
 */
export function describeSubscription(
  state: SubscriptionState,
  words: KaitenSubscriptionWords,
  localization: KaitenLocalization,
): SubscriptionDescription {
  const { subscription } = state;
  const empty: SubscriptionDescription = { status: null, detail: null, change: null, notice: null };
  if (!subscription) return empty;

  const change = subscription.scheduledChange
    ? words.changesOn(
        formatKaitenPrice(subscription.scheduledChange.price, localization) ?? "",
        subscription.scheduledChange.effectiveAt,
      )
    : null;

  switch (state.kind) {
    case "incomplete":
      // Nothing it bought has started, so it is not said to renew or to end.
      return {
        status: { label: words.incomplete, tone: "neutral" },
        detail: subscription.incompleteExpiresAt
          ? (words.incompleteUntil?.(subscription.incompleteExpiresAt) ?? null)
          : null,
        change,
        notice: words.incompleteNotice,
      };
    case "trial":
      return {
        status: { label: words.trial, tone: "neutral" },
        detail: state.ending
          ? words.endsOn(subscription.currentPeriodEnd)
          : words.trialEndsOn(subscription.trialEndsAt ?? subscription.currentPeriodEnd),
        change,
        notice: null,
      };
    case "past_due":
      return {
        status: { label: words.pastDue, tone: "warning" },
        detail: state.ending ? words.endsOn(subscription.currentPeriodEnd) : null,
        change,
        notice: words.pastDueNotice,
      };
    case "canceled": {
      const reason =
        subscription.cancellationReason === "TRIAL_ENDED_WITHOUT_PAYMENT_METHOD"
          ? words.trialEndedWithoutPaymentMethod
          : subscription.cancellationReason === "INCOMPLETE_EXPIRED"
            ? words.incompleteExpired
            : null;
      const ended =
        state.currentPlan && words.canceledPlanNotice
          ? words.canceledPlanNotice(state.currentPlan)
          : words.canceledNotice;
      return {
        status: { label: words.canceled, tone: "neutral" },
        detail: subscription.canceledAt
          ? (words.canceledOn?.(subscription.canceledAt) ?? null)
          : null,
        change: null,
        notice: [reason, ended].filter(Boolean).join(" "),
      };
    }
    case "active":
      return {
        status: null,
        detail: state.ending
          ? words.endsOn(subscription.currentPeriodEnd)
          : localization.currentPlan.renewsOn(subscription.currentPeriodEnd),
        change,
        notice: null,
      };
    default:
      return { ...empty, change };
  }
}
