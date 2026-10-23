// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import {
  formatKaitenDate,
  useLocalization,
  type KaitenPaymentMethodWords,
  type KaitenPortalBillingWords,
  type KaitenSubscriptionWords,
} from "@kaitencloud/react";

// The English words of a customer session's billing screens. Like the checkout's, they live here
// and not in the core's defaults: only these components say them, and a host that draws none does
// not carry them. A language pack carries its own set, whole (`@kaitencloud/react/locales`), and a
// host's override of one string is merged over these.

/** How a subscription is said: the status of the current plan and of the billing summary. */
export const englishSubscriptionWords: KaitenSubscriptionWords = {
  trial: "Trial",
  active: "Active",
  pastDue: "Payment failed",
  canceled: "Canceled",
  incomplete: "Awaiting payment",
  trialEndsOn: (isoDate) => `Trial ends on ${formatKaitenDate(isoDate)}`,
  endsOn: (isoDate) => `Ends on ${formatKaitenDate(isoDate)}`,
  changesOn: (price, isoDate) => `Changes to ${price} on ${formatKaitenDate(isoDate)}`,
  pastDueNotice: "Your latest payment didn't go through.",
  canceledNotice: "Your subscription has ended.",
  incompleteNotice: "Your plan starts once your payment is confirmed.",
  none: "There's no subscription to show.",
  subscribe: "Subscribe",
};

/** What the customer portal says of a session's invoices, cancellation, add-ons and vouchers. */
export const englishPortalBillingWords: KaitenPortalBillingWords = {
  invoices: "Invoices",
  noInvoices: "No invoices yet.",
  invoicePeriod: (from, to) => `${formatKaitenDate(from)} – ${formatKaitenDate(to)}`,
  kindActivation: "Activation",
  kindRenewal: "Renewal",
  kindFinal: "Final invoice",
  statusManual: "Billed manually",
  statusPushed: "Awaiting payment",
  statusPaid: "Paid",
  statusFailed: "Payment failed",
  statusUncollectible: "Written off",
  statusVoid: "Void",
  pay: "Pay",
  pdf: "PDF",
  loadMore: "Show older invoices",
  cancel: "Cancel subscription",
  cancelPrompt: (isoDate) =>
    `Your subscription will end on ${formatKaitenDate(isoDate)}. You keep everything until then, and you can undo this before it ends.`,
  cancelTrialPrompt: "Your trial will end now, and you won't be charged.",
  cancelIncompletePrompt: "Your plan won't start, and you won't be charged.",
  cancelConfirm: "Cancel at period end",
  cancelNowConfirm: "Cancel now",
  cancelKeep: "Keep my subscription",
  reactivate: "Reactivate subscription",
  closingPeriod: "We're closing your billing period. Your change will go through in a moment.",
  stillClosing: "Your billing period is still being closed. Try again in a minute.",
  unavailable: "The payment provider can't be reached right now. Try again in a moment.",
  actionFailed: "That didn't work. Please try again.",
  addonQuantity: (name) => `Quantity of ${name}`,
  addonLess: (name) => `Remove one ${name}`,
  addonMore: (name) => `Add one ${name}`,
  addonUpTo: (max) => `Up to ${max}`,
  addonsManage: "Manage add-ons",
  addonsManageNote: "Choose how many of each add-on you want. Nothing changes until you confirm.",
  addonsNone: "You have no add-ons yet.",
  addonsSummary: "Your changes",
  addonsNoChange: "No changes yet.",
  addonsConfirm: "Confirm changes",
  addonsCancel: "Cancel",
  addonsUpdated: "Your add-ons have been updated.",
  addonBilledFrom: (isoDate) =>
    `Takes effect now, and is billed from your renewal on ${formatKaitenDate(isoDate)}.`,
  addonLowerFrom: (isoDate) =>
    `Takes effect now. Your renewal on ${formatKaitenDate(isoDate)} bills the new quantity, and nothing is refunded for the current period.`,
  addonRemovedFrom: (isoDate) =>
    `Removed now. Your renewal on ${formatKaitenDate(isoDate)} no longer bills it, and nothing is refunded for the current period.`,
  addonEnding: (isoDate) =>
    `Takes effect now. Your subscription ends on ${formatKaitenDate(isoDate)} and isn't renewed.`,
  addonBilledFromTrialEnd: (isoDate) =>
    `Takes effect now, and is billed from the end of your trial on ${formatKaitenDate(isoDate)}.`,
  addonRemovedInTrial: (isoDate) =>
    `Removed now. It isn't billed when your trial ends on ${formatKaitenDate(isoDate)}.`,
  addonUnbilled: "Takes effect now. Nothing is billed without a subscription.",
  addonTrueUpNote:
    "A higher quantity can also be billed for the current period, at the most you hold during it, on your next invoice.",
  addonRefusedFor: (name, reason) => `${name}: ${reason}`,
  addonNotPublic: "This add-on is no longer available.",
  addonCurrencyMismatch: "This add-on isn't sold in the currency of your subscription.",
  addonIncompatible: "This add-on isn't available with your plan or its billing period.",
  addonQuantityExceedsMax: "That's more than this add-on allows.",
  addonOtherVersionAttached: "Your plan already includes another version of this add-on.",
  addonSubscriptionIncomplete:
    "Your plan starts once your payment is confirmed. You can change add-ons after that.",
  addonInstanceRequired: "Add-ons can't be changed from this page.",
  vouchers: "Voucher",
  voucherLabel: "Voucher code",
  voucherCheck: "Check",
  voucherInvalid: "This code can't be used.",
  voucherAtCheckout: "Applied at checkout.",
  voucherWait: (seconds) =>
    `Too many attempts. Try again in ${seconds < 90 ? `${seconds} second${seconds === 1 ? "" : "s"}` : `${Math.ceil(seconds / 60)} minutes`}.`,
  voucherRedeem: "Apply",
  voucherDismiss: "Not now",
  voucherRedeemed: (name) => `${name} applied.`,
  voucherFromNextInvoice: "Applies from your next invoice.",
  voucherForInvoices: (count) => (count === 1 ? "For one invoice." : `For ${count} invoices.`),
  voucherTakesEffect: "Takes effect now.",
  voucherUntil: (isoDate) => `Until ${formatKaitenDate(isoDate)}.`,
  voucherActive: "Active vouchers",
  voucherActiveNow: "Active.",
  voucherUsedOf: (count, max) =>
    max === null
      ? `Applied to ${count} ${count === 1 ? "invoice" : "invoices"}.`
      : `Applied to ${count} of ${max} ${max === 1 ? "invoice" : "invoices"}.`,
  voucherIncomplete:
    "Your plan starts once your payment is confirmed. You can add a code after that.",
  voucherNoSubscription: "There is no subscription to apply a code to.",
  provenance: "How this limit is made up",
  provenanceBase: "base",
  provenanceAddOn: "add-on",
  provenanceVoucher: "voucher",
  provenanceWithAddOns: "with add-ons",
  provenanceUnlimited: "Unlimited with a voucher",
};

/** What the payment method card says. */
export const englishPaymentMethodWords: KaitenPaymentMethodWords = {
  title: "Payment method",
  none: "No payment method saved.",
  card: "Card",
  expires: (monthYear) => `Expires ${monthYear}`,
  expired: "Expired",
  failed: "Failed",
  expiredNotice: "This card has expired. Add a new one to keep paying automatically.",
  failedNotice: "Your last payment failed. Update your payment method.",
  add: "Add a payment method",
  update: "Update payment method",
  manage: "Manage in billing portal",
  opening: "Opening…",
  saving: "Saving your payment method…",
  saved: "Payment method updated.",
  incomplete: "We haven't received a payment method yet. Add one, or check again.",
  unavailable: "The payment provider can't be reached right now. Try again in a moment.",
  error: "Something went wrong. Please try again.",
};

/** The words of a subscription's state: the language's, and the host's own over them, over the English ones. */
export function useSubscriptionWords(): KaitenSubscriptionWords {
  const { subscription } = useLocalization();
  return React.useMemo(() => ({ ...englishSubscriptionWords, ...subscription }), [subscription]);
}

/** The words of the portal's invoices, cancellation, add-ons and vouchers. */
export function usePortalBillingWords(): KaitenPortalBillingWords {
  const { portalBilling } = useLocalization();
  return React.useMemo(() => ({ ...englishPortalBillingWords, ...portalBilling }), [portalBilling]);
}

/** The words of the payment method card. */
export function usePaymentMethodWords(): KaitenPaymentMethodWords {
  const { paymentMethodCard } = useLocalization();
  return React.useMemo(
    () => ({ ...englishPaymentMethodWords, ...paymentMethodCard }),
    [paymentMethodCard],
  );
}
