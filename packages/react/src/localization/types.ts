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
  skipTrial: string;
  billingEmail: string;
  billingEmailHint: string;
  /** Said in place of a summary while the customer has no billing email: the API prices nothing before it. */
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
  updatePaymentMethod: string;
  paymentMethodUpdated: string;
  payInvoice: string;
  alreadySubscribed: string;
  managePlan: string;
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
    nearLimit: string;
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
