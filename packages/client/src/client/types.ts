// Re-export API-aligned types from the OpenAPI snapshot.
export type {
  BooleanEntitlementValue,
  ConfigEntitlementValue,
  EntitlementUsage,
  EvaluationFailure,
  EvaluationSuccess,
  NumberEntitlementValue,
  User,
} from "../core/index.ts";

// The backend renamed this component from the transport name to the domain name
// (`EntitlementGroupUsageItem` -> `EntitlementGroupUsage`). The old name is part
// of this SDK's published surface, so it is kept as an alias: following an
// upstream rename all the way to the public contract would break every host for
// no gain on their side.
export type { EntitlementGroupUsage as EntitlementGroupUsageItem } from "../core/index.ts";

import type {
  BooleanEntitlementValue,
  ConfigEntitlementValue,
  EvaluationFailure,
  EvaluationSuccess,
  NumberEntitlementValue,
  User,
} from "../core/index.ts";

export type EntitlementValue =
  | BooleanEntitlementValue
  | NumberEntitlementValue
  | ConfigEntitlementValue;

export type EvaluationResult = EvaluationSuccess | EvaluationFailure;

export interface BulkEvaluationResponse {
  flags: EvaluationResult[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type LicenseType = "DEVELOPMENT" | "TRIAL" | "PAID" | "COMMUNITY";

export type EntitlementType = "BOOLEAN" | "NUMBER" | "CONFIG";

export type MeterType = "CALCULATED_USAGE" | "RAW_EVENT";

export type AggregationMethod = "COUNT" | "SUM" | "AVERAGE" | "MIN" | "MAX" | "LATEST";

export type UsageBehavior = "append" | "set";

export type FeatureFlagType = "boolean" | "string" | "number" | "object";

export type BillingInterval = "month" | "year" | "one_time";

export type PortalActionType =
  | "upgrade_plan"
  | "add_quota"
  | "manage_addon"
  | "open_checkout"
  | "cancel_subscription"
  | "update_payment"
  | "contact_sales";

export type KaitenComponentEventName =
  | "kaiten:plan-changed"
  | "kaiten:addon-added"
  | "kaiten:subscription-canceled"
  | "kaiten:payment-updated"
  | "kaiten:quota-added";

// ---------------------------------------------------------------------------
// Core models
// ---------------------------------------------------------------------------

export interface EntitlementGroupRef {
  id: string;
  name: string;
  slug: string;
}

export interface EntitlementGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface Entitlement {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: EntitlementType;
  meterType?: MeterType;
  aggregationMethod?: AggregationMethod;
  entitlementGroups?: EntitlementGroupRef[] | null;
}

export interface Customer {
  id: string;
  slug: string;
  name: string;
  externalCustomerId: string | null;
  createdBy: User;
  createdAt: string;
  updatedBy: User;
  updatedAt: string;
}

/**
 * Whether a version of a license may be served. `PUBLISHED` versions can be
 * offered; a `DRAFT` has never been offered and an `ARCHIVED` version has been
 * withdrawn. Several versions of one family can be `PUBLISHED` at once.
 */
export type LicenseLifecycleState = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface License {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: LicenseType;
  version: string;
  versionName?: string;
  /**
   * Whether this version may be served. An instance already attached to an
   * `ARCHIVED` version keeps its entitlements: the state decides what a catalog
   * offers, not what an existing instance is entitled to.
   */
  lifecycleState: LicenseLifecycleState;
  /** The family this license is a version of: licenses sharing it are versions of one product. */
  familyId: string;
  isDefault: boolean;
  renewalDate?: string | null;
  billingInterval?: BillingInterval | null;
}

export interface Instance {
  id: string;
  slug: string;
  name: string;
  description: string;
  customerId: string;
  customerSlug: string;
  licenseId: string;
  licenseSlug: string;
  deploymentZoneId?: string;
  startLicenseDate: string;
  endLicenseDate: string;
  metadata: Record<string, unknown>;
  createdBy: User;
  createdAt: string;
  updatedBy: User;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// License entitlements
// ---------------------------------------------------------------------------

export type { LicenseEntitlement } from "../core/index.ts";

/**
 * Full entitlement definition attached to a grant by the GraphQL read path
 * (`License.entitlements[].entitlement`). Carries the presentation metadata the
 * REST license-entitlement projection drops.
 */
export interface EntitlementDefinitionRef extends EntitlementPresentation {
  slug: string;
  name: string;
  description?: string | null;
  entitlementGroups?: readonly EntitlementGroupRef[] | null;
}

/**
 * Structural grant row accepted by the normalizers. Both read paths satisfy it:
 * REST `LicenseEntitlement` rows directly (no `entitlement` field), and GraphQL
 * rows with the full definition attached.
 */
export interface LicenseEntitlementRow {
  entitlementSlug?: string;
  entitlementName: string;
  entitlementType?: string;
  licenseSlug: string;
  value: import("../core/index.ts").LicenseEntitlement["value"];
  /**
   * Server-computed on the GraphQL read path, with the exact semantics of the
   * usage reporter (only the sentinel disables the cap). Absent on REST rows,
   * where the normalizers fall back to the legacy negative-number check.
   */
  unlimited?: boolean;
  /**
   * How far past `value` the API keeps accepting usage, as a percentage of it:
   * `-1` when the grant is unlimited, `0` for a hard limit, positive for a soft
   * one. Null on the BOOLEAN and CONFIG grants that have no value to cap, and
   * absent on a grant written before the field existed, which reads as hard.
   */
  limitCapExceededOveragePercent?: number | null;
  entitlementGroups?: readonly EntitlementGroupRef[] | null;
  entitlement?: EntitlementDefinitionRef | null;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * A usage report.
 *
 * There is deliberately no `timestamp`: a report is always counted at the moment
 * the API receives it. The window it lands in is derived from database time —
 * and for a `LICENSE_START` anchor, from the instance's own license start date —
 * so a caller-supplied clock has nothing to say about which window a report
 * belongs to. `ReportEntitlementUsageBody` declares `additionalProperties: false`
 * over `value`, `behavior` and `metadata`, so sending one is a rejected request,
 * not an ignored field.
 */
export interface ReportUsageInput {
  value: EntitlementValue;
  behavior: UsageBehavior;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

export interface ResolvedFeatureFlag {
  key: string;
  enabled: boolean;
  value: unknown;
  variant?: string;
  reason?: string;
  percentage?: number | null;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Embedded components / licensing snapshot
// ---------------------------------------------------------------------------

/**
 * ISO-4217 currency code, e.g. `"USD"`, `"EUR"`, `"JPY"`. Used by
 * `formatKaitenMoney` to drive `Intl.NumberFormat` (symbol, grouping, and the
 * currency's minor-unit exponent). Kept as a documented string alias rather than
 * a 150-member union to stay ergonomic; invalid codes degrade gracefully at
 * format time instead of failing to type-check.
 */
export type CurrencyCode = string;

export interface PlanPrice {
  /**
   * Price in the currency's **minor units** (integer): cents for USD/EUR,
   * whole yen for JPY (which has no minor unit), fils for BHD, etc. `7900` with
   * `currencyCode: "EUR"` renders as `79,00 €`. Never a major-unit decimal.
   */
  amount: number;
  /** ISO-4217 currency code (e.g. `"USD"`). */
  currencyCode?: CurrencyCode;
  interval?: BillingInterval;
  label?: string;
}

export interface PortalAction {
  type: PortalActionType;
  label: string;
  targetId?: string;
  href?: string;
  disabled?: boolean;
  eventName?: KaitenComponentEventName;
  metadata?: Record<string, unknown>;
}

/**
 * Customer-facing presentation metadata carried by the entitlement DEFINITION
 * (org-level catalog), as served by the GraphQL read surface. All optional:
 * the REST license-entitlement projection does not carry them.
 */
export interface EntitlementPresentation {
  /** Provider-namespaced icon token (e.g. `"lucide:users"`). */
  icon?: string | null;
  /** Singular label of the base unit (NUMBER only), e.g. `"seat"`. */
  unitSingular?: string | null;
  /** Plural label of the base unit (NUMBER only), e.g. `"seats"`. */
  unitPlural?: string | null;
  /**
   * Singular label of the SALE unit (NUMBER only), e.g. `"1M tokens"`. The unit
   * the entitlement is *priced and quoted* in, which is not always the unit it
   * is *metered* in — usage is counted in tokens, sold per million.
   */
  saleUnitSingular?: string | null;
  /** Plural label of the sale unit (NUMBER only), e.g. `"1M tokens"`. */
  saleUnitPlural?: string | null;
  /**
   * How many base units make one sale unit — `1000000` for an entitlement
   * metered in tokens and sold per 1M tokens. Divide a base-unit value by this
   * to quote in sale units: a 40,000,000-token limit at `saleUnitFactor:
   * 1000000` is "40 × 1M tokens", so a $8 sale-unit price reads "$8 per 1M
   * tokens" instead of "$8 per unit".
   *
   * `null`/`undefined` means the entitlement has no distinct sale unit (the
   * REST read path never carries one) — quote in base units, do NOT default to
   * `1` and present it as a real factor.
   */
  saleUnitFactor?: number | null;
  /**
   * Whether this entitlement is meant to appear in customer-facing components.
   * `false` = internal counter, hide. `undefined` = unknown (older API) — treat
   * as visible for backwards compatibility.
   */
  userFacing?: boolean | null;
  /** Ascending sort order in customer-facing components. */
  displayOrder?: number | null;
}

export interface PlanEntitlement extends EntitlementPresentation {
  slug: string;
  name: string;
  description?: string | null;
  type: EntitlementType | Lowercase<EntitlementValue["type"]>;
  value?: EntitlementValue;
  /**
   * True when the grant carries the unlimited sentinel. Server-computed on the
   * GraphQL read path; derived from the value on REST rows. Prefer this over
   * inspecting the raw numeric value.
   */
  unlimited?: boolean;
  label?: string;
  category?: string | null;
  tags?: string[] | null;
}

export interface Addon {
  id?: string;
  slug: string;
  name: string;
  description?: string | null;
  active?: boolean;
  /** Price in the currency's minor units (integer). See {@link PlanPrice.amount}. */
  price?: number;
  /** ISO-4217 currency code (e.g. `"USD"`). */
  currencyCode?: CurrencyCode;
  interval?: BillingInterval;
  prices?: PlanPrice[];
  entitlements?: PlanEntitlement[];
  features?: string[];
  action?: PortalAction | null;
}

export interface CreditBalance {
  id?: string;
  slug: string;
  name: string;
  unit: string;
  included: number;
  consumed: number;
  available: number;
  resetAt?: string | null;
  action?: PortalAction | null;
}

export interface Plan {
  id?: string;
  slug: string;
  name: string;
  description?: string | null;
  /** Monthly price in the currency's minor units (integer). See {@link PlanPrice.amount}. */
  price?: number;
  /** Annual price in the currency's minor units (integer). See {@link PlanPrice.amount}. */
  annualPrice?: number;
  /** ISO-4217 currency code (e.g. `"USD"`). */
  currencyCode?: CurrencyCode;
  interval?: BillingInterval;
  prices?: PlanPrice[];
  features?: string[];
  entitlements?: PlanEntitlement[];
  addOns?: Addon[];
  highlighted?: boolean;
  badge?: string;
  popular?: boolean;
  /** `true` when the license behind this plan is `PUBLISHED`: see {@link License.lifecycleState}. */
  published?: boolean;
  /** Lifecycle state of the license behind this plan. */
  lifecycleState?: LicenseLifecycleState;
  /** Family of the license behind this plan: plans sharing it are versions of one product. */
  familyId?: string;
}

export interface ResolvedEntitlement extends EntitlementPresentation {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  type: EntitlementType;
  category?: string | null;
  tags?: string[] | null;
  limitValue: EntitlementValue;
  currentValue?: EntitlementValue | null;
  /**
   * True when the numeric limit is the "unlimited" sentinel (a negative value).
   * Encodes the unlimited concept at the type level so consumers read a boolean
   * instead of re-checking the magic `-1`.
   * Unlimited entitlements have `remaining: null` and never drive a paywall.
   * Always populated by the SDK; optional only so manually-built fixtures need
   * not set it.
   */
  unlimited?: boolean;
  remaining?: number | null;
  /**
   * The allowance carried by the grant, as a percentage of its included value:
   * `0` for a hard limit, positive for a soft one, `-1`/null when nothing caps
   * it. Beside `maximumAllowedUsage` so a host can tell "at the included cap
   * but still served" from "the server will refuse the next report" — two
   * states that both read above 100% used.
   */
  limitCapExceededOveragePercent?: number | null;
  /** The highest usage the API accepts. Null when nothing caps the grant. */
  maximumAllowedUsage?: number | null;
  percentageUsed?: number | null;
  /**
   * True when the grant is known but its consumption could not be read.
   *
   * Distinct from "nothing consumed yet": the usage read failed, so
   * `currentValue`, `remaining` and `percentageUsed` are all null rather than
   * zero. Consumers must treat it as *not* allowed — reporting a failed usage
   * read as 0% consumed opens every quota gate at once.
   */
  usageUnavailable?: boolean;
  /**
   * Start of the current usage window, inclusive. `null` or absent means this is
   * a lifetime counter — the API populates both bounds exactly when a reset
   * period is configured, and zero-fills windows never reported into.
   *
   * Only meaningful when the window was actually read: see `usageWindowUnknown`
   * and `usageUnavailable`, either of which makes both bounds say nothing.
   */
  currentPeriodStart?: string | null;
  /** End of the current usage window, exclusive. See `currentPeriodStart`. */
  currentPeriodEnd?: string | null;
  /**
   * True when the read path did not carry the window bounds at all, so their
   * absence says nothing about the entitlement's cadence.
   *
   * Distinct from bounds that are genuinely absent, which mean "lifetime
   * counter". No shipped read path sets it today — the GraphQL document used to,
   * because it did not select the bounds, and both paths now do. It stays in the
   * contract as the shape a path must use if it ever again reads usage without
   * the window: a monthly quota and a lifetime one would otherwise arrive
   * indistinguishable. Consumers must render no window at all rather than
   * claiming one; `resolveUsageScope` answers `UNKNOWN` for exactly this.
   */
  usageWindowUnknown?: boolean;
  status: "enabled" | "disabled" | "near_limit" | "over_limit";
  configLabel?: string | null;
  source: "license" | "addon" | "credit";
  actions?: PortalAction[];
}

export interface BillingCapabilities {
  paymentMethods: boolean;
  invoices: boolean;
  unsubscribe: boolean;
  checkout: boolean;
}

export interface KaitenBrandingCapability {
  removable: boolean;
}

export interface KaitenCatalog {
  plans: Plan[];
  branding?: KaitenBrandingCapability;
}

/**
 * The period the instance's license actually covers.
 *
 * Derived from `Instance.startLicenseDate` / `endLicenseDate`, which the API has
 * always sent and the SDK never read — so an expired license kept every one of
 * its entitlements. `null` when there is no instance (nothing to date).
 *
 * The comparison is against the *client* clock, so this is an indication and not
 * an enforcement: the server remains the authority, exactly as for the rest of
 * the gating surface. It is enough to stop presenting an expired license as
 * current, and to stop opening quota gates against it.
 */
export interface LicenseTerm {
  status: "active" | "expired" | "not_started";
  startsAt: string;
  expiresAt: string;
}

export interface LicensingSnapshot {
  source: "snapshot";
  updatedAt?: string;
  customer: Customer | null;
  instance: Instance | null;
  license: License | null;
  licenseTerm?: LicenseTerm | null;
  plans: Plan[];
  addOns: Addon[];
  credits: CreditBalance[];
  entitlements: ResolvedEntitlement[];
  flags: ResolvedFeatureFlag[];
  actions: PortalAction[];
  capabilities: BillingCapabilities;
  branding?: KaitenBrandingCapability;
  metadata?: Record<string, unknown>;
}

export interface PlanChangedEventDetail {
  planId?: string;
  planName?: string;
  totalPrice?: number;
  interval?: BillingInterval;
  subscriptionId?: string;
  metadata?: Record<string, unknown>;
}

export interface AddonAddedEventDetail {
  addonId?: string;
  addonSlug?: string;
  metadata?: Record<string, unknown>;
}

export interface SubscriptionCanceledEventDetail {
  subscriptionId?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentUpdatedEventDetail {
  paymentMethodId?: string;
  metadata?: Record<string, unknown>;
}

export interface QuotaAddedEventDetail {
  creditSlug?: string;
  amount?: number;
  metadata?: Record<string, unknown>;
}

export interface KaitenComponentEventMap {
  "kaiten:plan-changed": PlanChangedEventDetail;
  "kaiten:addon-added": AddonAddedEventDetail;
  "kaiten:subscription-canceled": SubscriptionCanceledEventDetail;
  "kaiten:payment-updated": PaymentUpdatedEventDetail;
  "kaiten:quota-added": QuotaAddedEventDetail;
}

export type KaitenComponentEvent<
  TName extends KaitenComponentEventName = KaitenComponentEventName,
> = CustomEvent<KaitenComponentEventMap[TName]>;
