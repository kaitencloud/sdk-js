import { formatKaitenDate, formatKaitenUsageWindowBound } from "./date.ts";
import { formatKaitenMoney } from "./money.ts";
import { pluralize } from "./pluralize.ts";
import type { KaitenLocalization } from "./types.ts";

export const defaultLocalization: KaitenLocalization = {
  formatMoney: (amount, currencyCode) => formatKaitenMoney(amount, currencyCode),
  branding: {
    poweredBy: "Powered by Kaiten",
  },
  states: {
    loading: "Loading",
    failed: "Failed to load",
    retry: "Try again",
  },
  pricingTable: {
    monthly: "Monthly",
    annual: "Annual",
    billingInterval: "Billing interval",
    choosePlan: "Choose plan",
    selectPlan: "Select plan",
    popular: "Popular",
    recommended: "Recommended",
    features: "Features",
    limits: "Limits",
    addOns: "Add-ons",
    customPrice: "Custom",
    contactUs: "Contact us",
  },
  featureComparison: {
    title: "Feature comparison",
    feature: "Feature",
    general: "General",
    included: "Included",
    config: "Config",
    unavailable: "-",
  },
  featureCatalog: {
    title: "Product features",
    description: "Explore the capabilities included in each plan.",
    search: "Search catalog...",
    allCategories: "All",
    availableOn: "Available on:",
    empty: "No feature matches this filter.",
  },
  billingSummary: {
    title: "Billing & usage",
    description: "Manage your subscription and quotas.",
    subscription: "Subscription",
    currentCycleUsage: "Current cycle usage",
    statusActive: "Active",
    statusExpired: "Expired",
    statusNotStarted: "Not started",
    renewsOn: (isoDate) => `Renews ${formatKaitenDate(isoDate)}`,
    expiredOn: (isoDate) => `Expired ${formatKaitenDate(isoDate)}`,
    startsOn: (isoDate) => `Starts ${formatKaitenDate(isoDate)}`,
    manageBilling: "Manage billing",
    viewInvoices: "View invoices",
    upgrade: "Upgrade subscription",
    quotaWarning: (name, percentage) => `${name} is at ${percentage}% of its limit.`,
    noUsage: "No metered quota on this plan.",
  },
  customerPortal: {
    currentPlan: "Current plan",
    includedFeatures: "Included features",
    usageMeters: "Usage meters",
    addOns: "Add-ons",
    featureFlags: "Feature flags",
  },
  currentPlan: {
    title: "Current plan",
    renewsOn: (date) => `Renews on ${formatKaitenDate(date)}`,
    credits: "Credits",
    upgradeVersion: "Upgrade version",
    addQuota: "Add quota",
    addAddOns: "Add add-ons",
  },
  includedFeatures: {
    title: "Included features",
    feature: "Feature",
    usage: "Usage",
    limit: "Limit",
    status: "Status",
    enabled: "Enabled",
    disabled: "Disabled",
    nearLimit: "Near limit",
    overLimit: "Over limit",
    config: "Config",
    unavailable: "-",
    unlimited: "Unlimited",
    unlimitedGroup: (count) =>
      `${pluralize(count, { one: "1 unlimited feature", other: "{n} unlimited features" })}`,
    rowSummary: (name, usage, limit, status) => `${name}: ${usage} of ${limit}, ${status}.`,
  },
  usageMeters: {
    title: "Usage meters",
    currentWindow: (start, end) =>
      `This period: ${formatKaitenUsageWindowBound(start)} → ${formatKaitenUsageWindowBound(end)}`,
    lifetime: "All time",
  },
  addOns: {
    title: "Add-ons",
    active: "Active",
    available: "Available",
    remove: "Remove",
    add: "Add",
    quotaAndCredits: "Quota and credits",
  },
  flagsSummary: {
    title: "Feature flags",
    runtimeEvaluation: "Runtime evaluation",
    rollout: (percentage) => pluralize(percentage, { one: "1% rollout", other: "{n}% rollout" }),
    enabled: "Enabled",
    disabled: "Disabled",
  },
  paywall: {
    limitReached: "Limit reached",
    approachingLimit: "Approaching limit",
    featureUnavailable: "Feature unavailable",
    notAvailable: "Not available",
    addQuota: "Add quota",
    addAddOn: "Add add-on",
    contactSales: "Contact sales",
    upgrade: "Upgrade",
    dismiss: "Dismiss",
    flagDisabledDescription:
      "This feature is currently gated for this customer. Unlock it by changing plan or enabling the related add-on.",
    errorDescription: "We couldn't verify your access right now. Please try again in a moment.",
    usageDescription: (current, limit) => `You've used ${current} of ${limit} allowed.`,
  },
  price: {
    perInterval: (interval) =>
      interval === "month" ? "/month" : interval === "year" ? "/year" : "",
    everyIntervals: (count, interval) =>
      `every ${count} ${interval === "year" ? "years" : "months"}`,
    perUnit: (unit) => `per ${unit}`,
    unit: "unit",
  },
  checkoutFlow: {
    title: "Checkout",
    description: "Review your selection before proceeding.",
    plan: "Plan",
    addOn: "Add-on",
    total: "Total",
    processing: "Processing...",
    proceedToPayment: "Continue",
    cancel: "Cancel",
    error: "Unable to complete checkout. Please try again.",
    intervalShortMonth: "/mo",
    intervalShortYear: "/year",
    priceLabel: (price, interval) => {
      if (!interval) return price;
      if (interval === "month") return `${price} per month`;
      if (interval === "year") return `${price} per year`;
      return `${price} per ${interval}`;
    },
  },
};
