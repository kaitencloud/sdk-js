import type { CurrencyCode } from "@kaitencloud/client";

export type KaitenDateInput = string | Date;

export interface KaitenMoneyFormatOptions extends Omit<
  Intl.NumberFormatOptions,
  "style" | "currency"
> {
  /** Locale forwarded to Intl.NumberFormat. Defaults to the host locale. */
  locale?: string | string[];
}

/** Formats a money amount (minor units) + ISO-4217 currency code for display. */
export type KaitenMoneyFormatter = {
  bivarianceHack(amount: number, currencyCode?: CurrencyCode): string;
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
  checkoutFlow: {
    title: string;
    description: string;
    plan: string;
    addOn: string;
    total: string;
    processing: string;
    proceedToPayment: string;
    cancel: string;
    error: string;
    /** Short suffix for monthly pricing in unstyled summary lines */
    intervalShortMonth: string;
    /** Short suffix for yearly pricing in unstyled summary lines */
    intervalShortYear: string;
    /**
     * Screen-reader label for a price token, e.g. "$79.00 per month". Receives
     * the already-formatted price string (from `formatMoney`) so the symbol and
     * digits are spoken correctly rather than "$79.00/mo" → "dollar sign...".
     */
    priceLabel: (price: string, interval: string | undefined) => string;
  };
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
