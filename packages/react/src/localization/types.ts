// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { CurrencyCode } from "@kaitencloud/client";

export type KaitenDateInput = string | Date;

export interface KaitenMoneyFormatOptions extends Omit<
  Intl.NumberFormatOptions,
  "style" | "currency"
> {
  /** Locale forwarded to Intl.NumberFormat. Defaults to the host locale. */
  locale?: string | string[];
}

/**
 * Formats a money amount (minor units) + ISO-4217 currency code for display.
 *
 * `amount` is an integer of minor units, or, for a price below one of them, an exact
 * decimal string such as the `unitAmountDecimal` `"0.0002"` of a price per call.
 */
export type KaitenMoneyFormatter = {
  bivarianceHack(amount: number | string, currencyCode?: CurrencyCode): string;
}["bivarianceHack"];

export interface KaitenDateFormatOptions extends Intl.DateTimeFormatOptions {
  /** Locale forwarded to Intl.DateTimeFormat. Defaults to the host locale. */
  locale?: string | string[];
  /** Text returned when a date string or Date object cannot be parsed. */
  fallback?: string;
}

export type KaitenDateFormatter = {
  bivarianceHack(date: KaitenDateInput): string;
}["bivarianceHack"];

/**
 * The words around the amounts of a checkout, from the first choice to the last payment status.
 * The amounts come from the server already formatted by `formatMoney`.
 */
export interface KaitenCheckoutWords {
  title: string;
  /** The heading of a summary that stands alone. */
  summary: string;
  /** Accessible name of the quantity of an add-on, for a stepper. */
  quantity: (name: string) => string;
  decrease: (name: string) => string;
  increase: (name: string) => string;
  voucherLabel: string;
  voucherApply: string;
  voucherApplied: string;
  voucherRemove: string;
  /** Said of every code the API refuses, whatever the reason: it never says which. */
  voucherInvalid: string;
  /** Said when the API asks to be given a moment: too many calls were made. */
  rateLimited: string;
  /** Said beside a code that was typed and not applied: it is not part of the checkout until it is. */
  voucherPending: string;
  billingEmail: string;
  billingEmailHint: string;
  /** Said under a summary while the customer still has to give a billing email, which subscribing needs. */
  billingEmailToSubscribe: string;
  /** Said in place of a summary when the API prices nothing before it has a billing email (an older Kaiten). */
  billingEmailFirst: string;
  /** The label of the total the server computed for what is due today. */
  dueToday: string;
  /** The total of a trial, which is nothing: "€0.00 today". Receives the formatted amount. */
  todayAmount: (amount: string) => string;
  /** Receives the RAW ISO bound and formats it itself, like `billingSummary.renewsOn`. */
  trialEndsOn: (isoDate: string) => string;
  choosePrice: string;
  /** Names the entitlements the instance is over, already joined: "Seats, API calls". */
  quotaExceeded: (names: string) => string;
  unavailable: string;
  error: string;
  /** Shown instead of a flow for a plan with no price to buy. */
  notSold: string;
  subscribe: string;
  processing: string;
  cancel: string;
  /** A visible statement that card details are not the host's, nor Kaiten's. */
  paymentNote: string;
  awaitingPaymentMethod: string;
  reopenSetup: string;
  /** Said to a screen reader after the name of a link that opens in a tab of its own: "(opens in a new tab)". */
  opensInNewTab: string;
  setupDone: string;
  setupIncomplete: string;
  subscribed: string;
  nothingDue: string;
  paymentReceived: string;
  receipt: string;
  confirmPayment: string;
  completePayment: string;
  waitingForPayment: string;
  paymentStillOpen: string;
  paymentFailed: string;
  /**
   * The headline of a checkout whose subscription waits for its first payment (`INCOMPLETE`), in
   * place of `subscribed`: what it bought starts once the payment is confirmed.
   */
  startsOncePaid: string;
  /** A card declined on such a checkout, in place of `paymentFailed`: nothing has started yet. */
  cardDeclined: string;
  updatePaymentMethod: string;
  paymentMethodUpdated: string;
  payInvoice: string;
  alreadySubscribed: string;
  managePlan: string;
  /** Beside an add-on the instance already holds, which a subscribe keeps and bills. Receives the quantity. */
  addOnHeld: (quantity: string) => string;
  /** Under the billing periods, when some cannot bill the add-ons the instance holds: their names, joined. */
  periodsLimitedBy: (names: string) => string;
  /** A checkout refused because its billing period cannot bill add-ons the instance holds: their names, joined. */
  addOnNotForPeriod: (names: string) => string;
  /** A checkout refused because it orders add-ons of families the instance already holds: their names, joined. */
  addOnAlreadyHeld: (names: string) => string;
  /** A checkout refused for other add-ons it cannot bill, another currency among them: their names, joined. */
  addOnRefused: (names: string) => string;
}

/**
 * What an anonymous checkout says that `KaitenCheckoutWords` does not: the form a visitor with no
 * account fills in, the security check, the review of what is due, the end of the checkout, and
 * each refusal. The words it shares with a customer's checkout (the cancel button, the payment
 * provider's page, a payment being made) are `KaitenCheckoutWords`'. Dates are RAW ISO bounds,
 * formatted by the pack.
 */
export interface KaitenAnonymousCheckoutWords {
  /** The label of the field for the visitor's company, when the page asks for one. */
  companyLabel: string;
  /** Said under the company field. */
  companyHint: string;
  /** Said under the company field of a visitor who pressed the button without giving one. */
  companyRequired: string;
  /** The label of the field for the visitor's name, when the page asks for one. */
  nameLabel: string;
  /** Said under the name field. */
  nameHint: string;
  /**
   * Added in parentheses after the label of a field the page asks for and does not require
   * ("Name (optional)"), so that the label says what the field's absent `required` would not.
   */
  optional: string;
  emailLabel: string;
  /**
   * Said under the e-mail field. The default makes no promise about mail: Kaiten sends none to the
   * buyers of a vendor, which the vendor and the payment provider do, if they do.
   */
  emailHint: string;
  /** Said under the name field of a visitor who pressed the button without giving one. */
  nameRequired: string;
  /** The name of the security check (Cloudflare Turnstile), for the group that holds its widget. */
  humanCheck: string;
  /** Said while the security check runs. */
  checking: string;
  /** Said when the security check passed. */
  checked: string;
  /** Said when the security check's script could not load, with what to try. */
  checkFailed: string;
  /** Said when the security check loaded and failed itself: the widget reported an error. */
  checkError: string;
  checkRetry: string;
  /** Said by the button that starts the checkout while the security check has not passed. */
  checkFirst: string;
  /** The button that starts the checkout of a plan that is paid. */
  continue: string;
  /** The button that starts the checkout of a free plan. */
  startFree: string;
  /** The button that starts a free trial. */
  startTrial: string;
  /** The button that sends the visitor to the payment provider's page. */
  continueToPayment: string;
  /** Goes back to the choices, from the review of what is due. */
  change: string;
  /** Receives the e-mail address the order is for. */
  reviewFor: (email: string) => string;
  /** Said of a plan with no card to give: nothing is asked for a payment method. */
  noCardNeeded: string;
  /**
   * Said of a trial that asks for no payment method, in place of `noCardNeeded`: nothing is charged
   * unless the visitor adds one. It says no more than that, as the start's answer says no more about
   * what the end of such a trial does.
   */
  noCardTrial: string;
  /** Said when this e-mail already had the plan's trial: the first period is due today. */
  trialAlreadyUsed: string;
  /** Said when the amount due changed between what was shown and the confirm. Receives both amounts, formatted. */
  amountChanged: (was: string, now: string) => string;
  /** Said when the terms changed without the amount (the end of a trial, say). */
  detailsChanged: string;
  /**
   * Said in the review of a trial that asks for a payment method: what is billed when it ends and
   * how often, from the plan's catalogue price. Receives that price with its period, formatted
   * ("$49.00 / month"), and the RAW ISO date the trial ends on.
   */
  thenPrice: (price: string, isoDate: string) => string;
  /**
   * Said in the review of a paid plan: what it renews at and when, from the catalogue's price
   * and the end of the period the server billed. Receives that price with its period,
   * formatted ("$49.00/month"), and the RAW ISO date the period ends on.
   */
  renewsAt: (price: string, isoDate: string) => string;
  /**
   * Said once the checkout completed, when the host gave no page to go on to. Receives the e-mail
   * address the order is for. The default promises no e-mail, since Kaiten sends none: a host that
   * sends one says so here, for instance "Check {email} for what to do next."
   */
  completedFor: (email: string) => string;
  /** The link that goes on to the page the host gave for after the checkout. */
  continueLink: string;
  /** Said of a session that stayed open for 24 hours. */
  closedAbandoned: string;
  /** Said of a session whose payment never came. */
  closedExpired: string;
  startAgain: string;
  /** Said when this browser holds no token for the checkout: it may have been paid for. */
  lost: string;
  /** What to do then: do not pay twice. Promises no e-mail, since Kaiten sends none to a buyer. */
  lostAdvice: string;
  /** The button that starts a new checkout from a lost one, which the visitor presses knowing it. */
  startNew: string;
  /** Receives the seconds to wait: "Try again in 30 seconds." Under two seconds it says "in a moment", never "in 0 seconds". */
  tryAgainIn: (seconds: number) => string;
  turnstileFailed: string;
  turnstileUnavailable: string;
  rateLimited: string;
  notSelfServe: string;
  planUnavailable: string;
  addonRefused: string;
  invalidEmail: string;
  quotaReached: string;
  notAvailable: string;
  /** Said when the payment provider cannot be reached. Ends the sentence: the wait to announce follows it. */
  providerUnavailable: string;
  /** Said by the button that starts the checkout, while the e-mail field is empty or not an address. */
  emailFirst: string;
  sessionClosed: string;
  dueTodayChanged: string;
  network: string;
}

/**
 * How a customer session's subscription is said: the status of `CurrentPlan` and
 * `BillingSummary`, the note on a `Paywall`. Dates are RAW ISO bounds, formatted by the pack, like
 * `currentPlan.renewsOn`.
 */
export interface KaitenSubscriptionWords {
  trial: string;
  active: string;
  /** A subscription with an invoice past its due date. It changes nothing a customer may do. */
  pastDue: string;
  canceled: string;
  /**
   * A subscription whose checkout waits for its first payment (`INCOMPLETE`): what it bought,
   * its plan and its add-ons, starts once that payment is confirmed.
   */
  incomplete: string;
  trialEndsOn: (isoDate: string) => string;
  /** The end of a subscription that was canceled and runs until its period is over. */
  endsOn: (isoDate: string) => string;
  /** A plan change scheduled for a later renewal. Receives the formatted price and the RAW date. */
  changesOn: (price: string, isoDate: string) => string;
  pastDueNotice: string;
  canceledNotice: string;
  /** Names the plan currently served, without claiming a reason for the ended subscription. */
  canceledPlanNotice?: (name: string) => string;
  /** Said of a subscription that waits for its first payment: its plan starts once it is confirmed. */
  incompleteNotice: string;
  /** Said where a subscription would be: a session bound to the customer, with no instance. */
  none: string;
  /** What a wall offers a customer who can buy a plan by themselves. */
  subscribe: string;
}

/**
 * What the customer portal says beyond the sections that were always there: the invoices, the
 * cancellation, the quantity of an add-on, a voucher check and where a limit comes from. Dates are
 * RAW ISO bounds, formatted by the pack.
 */
export interface KaitenPortalBillingWords {
  invoices: string;
  noInvoices: string;
  /** The period an invoice covers. */
  invoicePeriod: (fromIsoDate: string, toIsoDate: string) => string;
  kindActivation: string;
  kindRenewal: string;
  kindFinal: string;
  statusManual: string;
  statusPushed: string;
  statusPaid: string;
  statusFailed: string;
  statusUncollectible: string;
  statusVoid: string;
  pay: string;
  pdf: string;
  loadMore: string;
  cancel: string;
  /** Receives the RAW end of the period: the date the subscription ends on. */
  cancelPrompt: (isoDate: string) => string;
  /** Said in place of {@link cancelPrompt} to a customer in their trial, whose cancellation is at once. */
  cancelTrialPrompt: string;
  /**
   * Said in place of {@link cancelPrompt} of a subscription whose checkout waits for its first
   * payment (`INCOMPLETE`): cancelling it ends it at once, the plan it bought never starts, and its
   * invoice is not charged.
   */
  cancelIncompletePrompt: string;
  /** Confirms a cancellation at the end of the period. */
  cancelConfirm: string;
  /** Confirms a cancellation that ends the subscription at once: a trial, or a checkout that waits for its payment. */
  cancelNowConfirm: string;
  cancelKeep: string;
  reactivate: string;
  /** A change the API refused while a billing period is being closed, waited out. */
  closingPeriod: string;
  /** The same refusal, a second time: the customer tries again. */
  stillClosing: string;
  unavailable: string;
  actionFailed: string;
  addonQuantity: (name: string) => string;
  addonLess: (name: string) => string;
  addonMore: (name: string) => string;
  addonUpTo: (max: string) => string;
  /** The button that opens the add-ons panel, and the panel's title. */
  addonsManage: string;
  /** Under the panel's title: nothing is sent until the customer confirms. */
  addonsManageNote: string;
  /** The add-ons card of an instance that holds none, when some are offered. */
  addonsNone: string;
  /** The heading of what the panel will change. */
  addonsSummary: string;
  /** In place of the changes, while there is none. */
  addonsNoChange: string;
  addonsConfirm: string;
  addonsCancel: string;
  /** Said once the panel's changes all went through. */
  addonsUpdated: string;
  /** Optional additions: older language packs use the English UI fallback. Dates are RAW ISO. */
  addonPendingQuantity?: (quantity: string, isoDate: string) => string;
  addonPendingRemoval?: (isoDate: string) => string;
  addonKeepQuantity?: string;
  billingAdvance?: string;
  billingArrears?: string;
  addonOverage?: (percent: string) => string;
  /** An increase, with a live subscription that renews. Receives the RAW date of the renewal. */
  addonBilledFrom: (isoDate: string) => string;
  /** A lower quantity, with a live subscription that renews. Receives the RAW date of the renewal. */
  addonLowerFrom: (isoDate: string) => string;
  /** A removal, with a live subscription that renews. Receives the RAW date of the renewal. */
  addonRemovedFrom: (isoDate: string) => string;
  /** Any change to a subscription that ends at the end of its period. Receives the RAW date it ends on. */
  addonEnding: (isoDate: string) => string;
  /**
   * An increase or a lower quantity during a trial, which is never billed for the time it lasts:
   * the first invoice, at its end, bills what is held then. Receives the RAW date the trial ends on.
   */
  addonBilledFromTrialEnd: (isoDate: string) => string;
  /** A removal during a trial: the invoice at its end does not bill it. Receives the RAW date the trial ends on. */
  addonRemovedInTrial: (isoDate: string) => string;
  /** Any change while no subscription is live: nothing is billed. */
  addonUnbilled: string;
  /**
   * Compatibility copy for a host that knows the family's policy. The current public payload
   * omits that policy, so the SDK's portal does not render this note.
   */
  addonTrueUpNote: string;
  /** A refusal of the panel, said of the add-on it stopped at. Receives its name and the reason. */
  addonRefusedFor: (name: string, reason: string) => string;
  /** A change refused because the add-on is no longer for sale, which trying again does not change. */
  addonNotPublic: string;
  /** A change refused because the add-on is priced in another currency than the subscription's. */
  addonCurrencyMismatch: string;
  /** A change refused because the add-on does not fit the plan, or has no price for its billing period. */
  addonIncompatible: string;
  /** A change refused because it asks for more units than the add-on allows. */
  addonQuantityExceedsMax: string;
  /** A change refused because the instance holds another version of the add-on. */
  addonOtherVersionAttached: string;
  /** A change refused while the subscription waits for the payment of its checkout. */
  addonSubscriptionIncomplete: string;
  /** A change refused because the session is the customer's alone, with no instance to change. */
  addonInstanceRequired: string;
  vouchers: string;
  voucherLabel: string;
  voucherCheck: string;
  /** Said of every code the API refuses, whatever the reason: it never says which. */
  voucherInvalid: string;
  voucherAtCheckout: string;
  /** A voucher check that was refused for coming too often. Receives the seconds to wait. */
  voucherWait: (seconds: number) => string;
  /** Redeems the code a check showed, on a subscription that is live. */
  voucherRedeem: string;
  /** Leaves the code a check showed unredeemed. */
  voucherDismiss: string;
  /** Said once a code was redeemed. Receives the voucher's name. */
  voucherRedeemed: (name: string) => string;
  /** A discount that has not discounted an invoice yet: the current period is never invoiced again. */
  voucherFromNextInvoice: string;
  /** How many invoices a discount covers. Receives the count. */
  voucherForInvoices: (count: number) => string;
  /** What a boost or a flag grant does on redemption. */
  voucherTakesEffect: string;
  /** Until when a boost or a flag grant lasts. Receives the RAW ISO bound and formats it itself. */
  voucherUntil: (isoDate: string) => string;
  /** The heading of the list of redemptions that are in force. */
  voucherActive: string;
  /** A boost or a flag grant in force that has no end date. */
  voucherActiveNow: string;
  /** How many invoices a discount has covered so far. Receives the count, and the most it covers or null. */
  voucherUsedOf: (count: number, max: number | null) => string;
  /** Said in place of the field while the subscription waits for its first payment. */
  voucherIncomplete: string;
  /** Said when there turned out to be no subscription to redeem a code on. */
  voucherNoSubscription: string;
  /** The button that opens how a limit is made up. */
  provenance: string;
  provenanceBase: string;
  provenanceAddOn: string;
  provenanceVoucher: string;
  /** A limit the add-ons set in another way than by adding: the server's figure after them. */
  provenanceWithAddOns: string;
  provenanceUnlimited: string;
  provenanceLayer?: (name: string) => string;
  provenanceException?: string;
  provenanceBeforeException?: (value: string) => string;
  provenanceEffective?: (value: string) => string;
  grantSet?: (value: string) => string;
  grantAdd?: (value: string) => string;
  grantMultiply?: (value: string) => string;
  grantMinimum?: (value: string) => string;
  grantFrom?: (isoDate: string) => string;
  grantNoEnd?: string;
  voucherDiscount?: (value: string) => string;
  voucherFlag?: (name: string, variant: string) => string;
}

/** What `PaymentMethodCard` says. */
export interface KaitenPaymentMethodWords {
  title: string;
  none: string;
  /** What a payment method is called when the provider gave no brand. */
  card: string;
  /** Receives the month and the year as the card writes them: "12/2030". */
  expires: (monthYear: string) => string;
  expired: string;
  failed: string;
  expiredNotice: string;
  failedNotice: string;
  add: string;
  update: string;
  manage: string;
  opening: string;
  saving: string;
  saved: string;
  incomplete: string;
  unavailable: string;
  error: string;
}

/**
 * What `TrialBanner` says: how long a trial has left, what its end charges and to which card, and
 * what the customer can do about it. Dates are RAW ISO bounds, formatted by the pack; a price is
 * already formatted, with its period ("$79.00/month").
 */
export interface KaitenTrialBannerWords {
  /** The name of the banner as a region, for a screen reader. */
  title: string;
  /** Said when a day or more is left. Receives the whole days. */
  endsInDays: (days: number) => string;
  /** Said when less than a day is left. Receives the whole hours. */
  endsInHours: (hours: number) => string;
  /** Said when less than an hour is left. Receives the whole minutes. */
  endsInMinutes: (minutes: number) => string;
  /** Said when less than a minute is left. */
  endsInAMoment: string;
  endsOn: (isoDate: string) => string;
  /** What the end of the trial charges and when. Receives the server's price and the end of the trial. */
  chargeOn: (price: string, isoDate: string) => string;
  /**
   * Same, said while no card is on file: the portal gives what the end would charge, not what
   * happens to a trial without a card. Receives the server's price and the end of the trial.
   */
  chargeWouldOn: (price: string, isoDate: string) => string;
  /** Said when the end of the trial charges nothing. */
  nothingCharged: string;
  /** The card the charge goes to. Receives its label: "Visa •••• 4242". */
  cardOnFile: (label: string) => string;
  /** Said when no card is on file, which the end of the trial may depend on. */
  noCard: string;
  /** What a card is called when the provider gave no brand. */
  card: string;
  addCard: string;
  cancel: string;
  /** Said before the trial is ended at the customer's request. */
  cancelPrompt: string;
  cancelConfirm: string;
  cancelKeep: string;
  opening: string;
  saving: string;
  saved: string;
  /** Said back from the provider's page when no card was saved on it. */
  incomplete: string;
  unavailable: string;
  /** Said when the billing period is still being closed: the same action goes through in a moment. */
  stillClosing: string;
  error: string;
}

export interface KaitenLocalization {
  /**
   * Formats a price for display. `amount` is in minor units (e.g. cents) and
   * `currencyCode` is ISO-4217 (e.g. `"USD"`). Defaults to the Intl currency
   * style in the host locale via `formatKaitenMoney`. Override to force a
   * locale, hide decimals, or use a custom money format across all components.
   */
  formatMoney: KaitenMoneyFormatter;
  branding: {
    poweredBy: string;
  };
  states: {
    loading: string;
    failed: string;
    retry: string;
  };
  pricingTable: {
    monthly: string;
    annual: string;
    /** Accessible name for the billing period toggle (monthly / yearly). */
    billingInterval: string;
    choosePlan: string;
    selectPlan: string;
    popular: string;
    recommended: string;
    features: string;
    limits: string;
    addOns: string;
    /** Shown instead of a price when a plan has no amount (e.g. enterprise / contact-sales). */
    customPrice: string;
    /** The link of a plan that is not self-serve, to its `selfServeCtaUrl`. */
    contactUs: string;
  };
  featureComparison: {
    title: string;
    feature: string;
    general: string;
    included: string;
    config: string;
    unavailable: string;
  };
  featureCatalog: {
    title: string;
    description: string;
    search: string;
    allCategories: string;
    /** Label before the list of plans a feature is available on. */
    availableOn: string;
    /** Shown when a search or category filter matches nothing. */
    empty: string;
  };
  billingSummary: {
    title: string;
    description: string;
    subscription: string;
    currentCycleUsage: string;
    statusActive: string;
    statusExpired: string;
    statusNotStarted: string;
    /**
     * "Renews March 14, 2026" — the term's end while the licence is running.
     * Receives the RAW ISO bound and formats it itself, the same contract as
     * `usageMeters.currentWindow`: the locale travels with the pack instead of
     * being threaded down to every call site.
     */
    renewsOn: (isoDate: string) => string;
    /** Same bound, past tense, once the term has ended. */
    expiredOn: (isoDate: string) => string;
    /** The term's start bound, when it has not begun yet. */
    startsOn: (isoDate: string) => string;
    manageBilling: string;
    viewInvoices: string;
    upgrade: string;
    /** "AI credits are at 92%." — names the quota that tripped the threshold. */
    quotaWarning: (name: string, percentage: number) => string;
    /**
     * "AI credits is past its included amount, within its allowance." — usage is beyond the granted
     * value but still under the ceiling the grant tolerates, so nothing is refused yet.
     */
    quotaInAllowance: (name: string) => string;
    /** "AI credits has reached its limit." — usage sits on the ceiling: the next report is refused. */
    quotaAtLimit: (name: string) => string;
    /** "AI credits is over its limit." — usage is past the ceiling, for instance after a limit was lowered. */
    quotaOverLimit: (name: string) => string;
    /**
     * Said in place of a quota's figures when its usage could not be read: how much is used is
     * unknown, which is not the same as nothing used.
     */
    usageUnavailable: string;
    noUsage: string;
  };
  customerPortal: {
    currentPlan: string;
    includedFeatures: string;
    usageMeters: string;
    addOns: string;
    featureFlags: string;
  };
  currentPlan: {
    title: string;
    /**
     * Formats the license renewal date. The SDK passes ISO 8601 strings from
     * the Kaiten API, and custom callers may pass a Date object. Implementations
     * should preserve a readable fallback for invalid or unexpected values.
     */
    renewsOn: KaitenDateFormatter;
    credits: string;
    upgradeVersion: string;
    addQuota: string;
    addAddOns: string;
  };
  includedFeatures: {
    title: string;
    feature: string;
    usage: string;
    limit: string;
    status: string;
    enabled: string;
    disabled: string;
    /** A quota that is close to what its grant permits, but not past its granted value. */
    nearLimit: string;
    /** A quota past its granted value, within the allowance the grant tolerates. */
    inAllowance: string;
    /** A quota on the ceiling its grant permits: the next report is refused. */
    atLimit: string;
    /** A quota past the ceiling its grant permits. */
    overLimit: string;
    config: string;
    unavailable: string;
    /** Accessible label for an unlimited (uncapped) entitlement, shown as ∞. */
    unlimited: string;
    /** Disclosure label for the collapsed group of unlimited entitlements. */
    unlimitedGroup: (count: number) => string;
    /** Accessible single-cell summary for each table row. */
    rowSummary: (name: string, usage: string, limit: string, status: string) => string;
  };
  usageMeters: {
    title: string;
    /**
     * Bounds of the window a periodic counter is measured in, as the ISO
     * timestamps the API returns — each pack formats them itself, exactly as
     * `subscription.renewsOn` does, so the locale travels with the pack.
     *
     * One pair of keys for every usage surface: a second one would only be a way
     * to drift.
     */
    currentWindow: (start: string, end: string) => string;
    /** A counter with no reset period — it counts for all time. */
    lifetime: string;
  };
  addOns: {
    title: string;
    active: string;
    available: string;
    remove: string;
    add: string;
    quotaAndCredits: string;
  };
  flagsSummary: {
    title: string;
    runtimeEvaluation: string;
    rollout: (percentage: number) => string;
    enabled: string;
    disabled: string;
  };
  paywall: {
    limitReached: string;
    approachingLimit: string;
    featureUnavailable: string;
    notAvailable: string;
    addQuota: string;
    addAddOn: string;
    contactSales: string;
    upgrade: string;
    dismiss: string;
    flagDisabledDescription: string;
    /** Shown when the paywall blocks because access data failed to load (fail-closed). */
    errorDescription: string;
    usageDescription: (current: string, limit: string) => string;
  };
  /**
   * How a price reads after its amount: "/month", "every 3 months", "per 1M
   * tokens". See `formatKaitenPrice`.
   */
  price: {
    /** The suffix of a price billed every month: "/month". */
    perMonth: string;
    /** The suffix of a price billed every year: "/year". */
    perYear: string;
    /**
     * The suffix of a price billed every `{n}` months, `{n}` being two or more: "every {n}
     * months" reads "every 3 months" for a quarterly price.
     */
    everyMonths: string;
    /** The suffix of a price billed every `{n}` years, `{n}` being two or more. */
    everyYears: string;
    /** The suffix of a usage price, after the sale unit it is per: "per {unit}" reads "per 1M tokens". */
    perUnit: string;
    /** The unit of a usage price that names none, nor does its entitlement: "per unit". */
    unit: string;
  };
  /**
   * What `CheckoutFlow` and `CheckoutSummary` say. Optional, and absent from the English defaults
   * the core carries: the words of a checkout are `@kaitencloud/react-ui`'s to default, so that a
   * host that draws no checkout does not carry them. A language pack carries its own whole, and
   * a host's override of one string is merged over the English the components hold.
   */
  checkoutFlow?: KaitenCheckoutWords;
  /**
   * What `AnonymousCheckoutFlow` says beside `checkoutFlow`. Optional and absent from the English
   * defaults, like `checkoutFlow`: the English lives in `@kaitencloud/react-ui`.
   */
  anonymousCheckout?: KaitenAnonymousCheckoutWords;
  /**
   * What `CurrentPlan`, `BillingSummary` and `Paywall` say of a customer session's subscription.
   * Optional and absent from the English defaults, like `checkoutFlow`.
   */
  subscription?: KaitenSubscriptionWords;
  /** What `CustomerPortal` says of a customer session's invoices, cancellation, add-ons and vouchers. Optional, like `checkoutFlow`. */
  portalBilling?: KaitenPortalBillingWords;
  /** What `PaymentMethodCard` says. Optional, like `checkoutFlow`. */
  paymentMethodCard?: KaitenPaymentMethodWords;
  /** What `TrialBanner` says. Optional, like `checkoutFlow`. */
  trialBanner?: KaitenTrialBannerWords;
}

/**
 * `Partial`, all the way down — but never into a function.
 *
 * `LocalizationProvider` merges overrides deeply, so a host can hand it one
 * string of one section. The type used to say `Partial<KaitenLocalization>`,
 * which is shallow: `{ paywall: { upgrade: "…" } }` failed to compile unless
 * the whole `paywall` section came with it, and every key added to a section
 * broke every host that overrode any of it. The formatter fields
 * (`formatMoney`, `renewsOn`…) are functions, and a function is replaced
 * whole, so the recursion stops there.
 */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** What `locale` and `localization` accept: any subset of the strings and formatters. */
export type KaitenLocalizationOverrides = DeepPartial<KaitenLocalization>;
