// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

export type {
  AuthenticatedKaitenProviderConfig,
  KaitenClientConfig,
  KaitenClientLike,
  KaitenPollingConfig,
  KaitenProviderConfig,
  PublicKaitenProviderConfig,
} from "@kaitencloud/client";

export type {
  CustomerSessionKaitenProviderConfig,
  KaitenAnonymousCheckoutProps,
  KaitenProviderMode,
  KaitenProviderProps,
  KaitenScopeProviderProps,
  StaticKaitenProviderConfig,
} from "./providers/kaiten-provider.tsx";

// The customer-session surface of `@kaitencloud/client`, which
// `mode="customer-session"` reads: every type that `usePortal()` returns, that
// `useKaitenSessionClient()` takes or gives, and the ones those are made of.
export type {
  CheckoutInput,
  CheckoutPaymentStatus,
  CheckoutPreview,
  CheckoutRequiresPaymentMethod,
  CheckoutResult,
  CheckoutSubscribed,
  CompletedPaymentMethodSession,
  EntitlementProvenance,
  InvoiceKind,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceTotals,
  KaitenCustomerSession,
  KaitenCustomerSessionProvider,
  KaitenPage,
  KaitenPortal,
  KaitenSessionClientConfig,
  KaitenSessionClientLike,
  PaymentMethodSession,
  PaymentMethodStatus,
  PaymentMethodSummary,
  PortalCustomer,
  PortalInstance,
  PortalInstanceSummary,
  PortalSession,
  PortalSubscription,
  PortalTrial,
  PortalVoucher,
  SessionAddon,
  SessionInvoice,
  SessionInvoiceLine,
  SessionRedemption,
  SubscriptionStatus,
  TrialCharge,
  UpcomingInvoice,
  VoucherBoost,
  VoucherDiscount,
  VoucherSummary,
  VoucherValidation,
} from "@kaitencloud/client";

// The anonymous checkout of `@kaitencloud/client`, which `useAnonymousCheckout` reads and
// `anonymousCheckoutClient` takes.
export type {
  CheckoutBillingPeriod,
  CheckoutConfirmation,
  CheckoutDueToday,
  CheckoutSession,
  CheckoutSessionOpened,
  CheckoutSessionPreview,
  CheckoutSessionStart,
  CheckoutSessionStatus,
  KaitenAnonymousCheckoutClientLike,
  StartCheckoutInput,
  TrialRefusedReason,
} from "@kaitencloud/client";

export type { KaitenApiError, KaitenThrownError } from "@kaitencloud/client";

export type { SessionSnapshotMembers } from "./lib/portal-snapshot.ts";

export type {
  KaitenAnonymousCheckoutWords,
  KaitenCheckoutWords,
  KaitenPaymentMethodWords,
  KaitenPortalBillingWords,
  KaitenSubscriptionWords,
  KaitenTrialBannerWords,
  KaitenDateFormatOptions,
  KaitenDateFormatter,
  KaitenDateInput,
  KaitenLocalization,
  KaitenLocalizationOverrides,
  KaitenMoneyFormatOptions,
  KaitenMoneyFormatter,
} from "./localization/types.ts";

export type { KaitenTelemetryEvent, KaitenTelemetryOptions } from "./telemetry/types.ts";

export type {
  Addon,
  AddonAddedEventDetail,
  AggregationMethod,
  BillingCapabilities,
  BillingInterval,
  BillingPrice,
  BooleanEntitlementValue,
  ConfigEntitlementValue,
  CreditBalance,
  CurrencyCode,
  Customer,
  Entitlement,
  EntitlementGroup,
  EntitlementGroupRef,
  EntitlementGroupUsageItem,
  EntitlementPresentation,
  EntitlementType,
  EntitlementUsage,
  EntitlementValue,
  FeatureFlagType,
  Instance,
  KaitenBrandingCapability,
  KaitenCatalog,
  KaitenComponentEvent,
  KaitenComponentEventMap,
  KaitenComponentEventName,
  License,
  LicenseEntitlement,
  LicenseLifecycleState,
  LicenseTerm,
  LicenseType,
  LicensingSnapshot,
  NumberEntitlementValue,
  PaymentUpdatedEventDetail,
  Plan,
  PlanChangedEventDetail,
  PlanEntitlement,
  PlanPrice,
  PriceBillingModel,
  PricingType,
  PortalAction,
  PortalActionType,
  QuotaAddedEventDetail,
  ReportUsageInput,
  ReportUsageResult,
  ResolvedEntitlement,
  ResolvedFeatureFlag,
  SubscriptionCanceledEventDetail,
  UsageBehavior,
  User,
} from "@kaitencloud/client";
