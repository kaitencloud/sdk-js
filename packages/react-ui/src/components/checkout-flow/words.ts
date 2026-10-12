import * as React from "react";

import { formatKaitenDate, useLocalization, type KaitenCheckoutWords } from "@kaitencloud/react";

/**
 * The English words of a checkout. They live here and not in the core's defaults because only
 * these components say them: a host that draws no checkout carries none of them. A language
 * pack carries its own set, whole (`@kaitencloud/react/locales`), and a host's override of
 * one string is merged over these.
 */
export const englishCheckoutWords: KaitenCheckoutWords = {
  title: "Checkout",
  summary: "Summary",
  quantity: (name) => `Quantity of ${name}`,
  decrease: (name) => `Remove one ${name}`,
  increase: (name) => `Add one ${name}`,
  voucherLabel: "Voucher code",
  voucherApply: "Apply",
  voucherApplied: "Voucher applied",
  voucherRemove: "Remove voucher",
  voucherInvalid: "This code can't be used.",
  rateLimited: "Too many attempts. Try again in a moment.",
  voucherPending: "Apply the code, or clear the field, to continue.",
  skipTrial: "Start without the free trial",
  billingEmail: "Billing email",
  billingEmailHint: "Invoices are sent to this address.",
  billingEmailFirst: "Enter your billing email to see what is due today.",
  dueToday: "Due today",
  todayAmount: (amount) => `${amount} today`,
  trialEndsOn: (isoDate) => `Trial ends on ${formatKaitenDate(isoDate)}`,
  choosePrice: "Choose a plan to see what is due today.",
  quotaExceeded: (names) =>
    `Your usage is above what this plan includes: ${names}. Choose a larger plan, or add-ons.`,
  unavailable: "The payment provider can't be reached right now. Try again in a moment.",
  error: "Unable to complete checkout. Please try again.",
  notSold: "This plan can't be bought online.",
  subscribe: "Subscribe",
  processing: "Processing...",
  cancel: "Cancel",
  paymentNote: "Your card details are handled by the payment provider. They never reach this site.",
  awaitingPaymentMethod:
    "Save your payment method in the window we opened. We'll continue as soon as you're back.",
  reopenSetup: "Open the page again",
  setupDone: "I've saved my payment method",
  setupIncomplete:
    "We haven't received a payment method yet. Open the page again, or check once more.",
  subscribed: "You're subscribed",
  nothingDue: "Nothing is due today.",
  paymentReceived: "Payment received.",
  receipt: "View receipt",
  confirmPayment: "Confirm your payment to finish.",
  completePayment: "Complete payment",
  waitingForPayment: "Waiting for your payment...",
  paymentStillOpen:
    "We haven't seen your payment yet. We'll check again when you come back to this window.",
  paymentFailed: "You're subscribed, but your card was declined.",
  updatePaymentMethod: "Update payment method",
  paymentMethodUpdated: "Payment method updated.",
  payInvoice: "Pay invoice",
  alreadySubscribed: "You already have a subscription.",
  managePlan: "Manage your subscription",
};

/** The words a checkout says: the language's, and the host's own over them, over the English ones. */
export function useCheckoutWords(): KaitenCheckoutWords {
  const { checkoutFlow } = useLocalization();
  return React.useMemo(() => ({ ...englishCheckoutWords, ...checkoutFlow }), [checkoutFlow]);
}
