// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useLocalization, type KaitenAnonymousCheckoutWords } from "@kaitencloud/react";

/**
 * The English words of an anonymous checkout. They live here and not in the core's defaults for
 * the reason the customer checkout's do: only these components say them, and a host that draws no
 * checkout carries none. A language pack carries its own set, whole (`@kaitencloud/react/locales`),
 * and a host's override of one string is merged over these.
 */
export const englishAnonymousCheckoutWords: KaitenAnonymousCheckoutWords = {
  nameLabel: "Name",
  emailLabel: "Email",
  emailHint: "Your receipt and the next steps are sent to this address.",
  humanCheck: "Security check",
  checking: "Running the security check...",
  checked: "Security check passed.",
  checkFailed:
    "The security check could not load. If a content blocker or a firewall is in the way, allow challenges.cloudflare.com, then try again.",
  checkRetry: "Try the check again",
  checkFirst: "The button is available once the security check passes.",
  continue: "Continue",
  startFree: "Start for free",
  startTrial: "Start free trial",
  continueToPayment: "Continue to payment",
  change: "Change my choices",
  reviewFor: (email) => `For ${email}`,
  noCardNeeded: "No payment method is asked for.",
  trialAlreadyUsed:
    "This email has already had this plan's trial, so the first period is due today.",
  amountChanged: (was, now) =>
    `The amount due changed from ${was} to ${now}. Check it before you continue.`,
  detailsChanged: "The terms of your order changed. Check them before you continue.",
  checkEmail: (email) => `Check ${email}: we'll write to you there with what to do next.`,
  continueLink: "Continue",
  closedAbandoned: "This checkout stayed open for too long and was closed. Nothing was charged.",
  closedExpired: "The payment didn't come through in time, so this checkout was closed.",
  startAgain: "Start again",
  lost: "We can't find this checkout in this browser.",
  lostAdvice:
    "If you already paid, there is nothing more to do: check your email for the confirmation, or contact us before paying again.",
  startNew: "Start a new checkout",
  tryAgainIn: (seconds) =>
    `Try again in ${seconds < 90 ? `${seconds} second${seconds === 1 ? "" : "s"}` : `${Math.ceil(seconds / 60)} minutes`}.`,
  turnstileFailed: "We couldn't verify the security check. Please complete it again.",
  turnstileUnavailable: "The security check can't be reached right now.",
  rateLimited: "Too many attempts.",
  notSelfServe: "This plan isn't sold online. Contact us to get it.",
  planUnavailable: "This plan can't be bought right now.",
  addonRefused: "One of the options you chose can't be bought with this plan.",
  invalidEmail: "This email address isn't valid.",
  quotaReached: "We can't take new sign-ups right now. Please contact us.",
  notAvailable: "Online sign-up isn't available right now.",
  sessionClosed: "This checkout is already closed.",
  dueTodayChanged:
    "The amount due changed after your payment method was saved. Nothing was charged. Start again to see the new amount.",
  network: "We couldn't reach the server. Check your connection and try again.",
};

/** The words an anonymous checkout says: the language's, and the host's own over them, over the English ones. */
export function useAnonymousCheckoutWords(): KaitenAnonymousCheckoutWords {
  const { anonymousCheckout } = useLocalization();
  return React.useMemo(
    () => ({ ...englishAnonymousCheckoutWords, ...anonymousCheckout }),
    [anonymousCheckout],
  );
}
