// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Re-export API-aligned types from the OpenAPI snapshot.
export type {
  BooleanEntitlementValue,
  ConfigEntitlementValue,
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
  EntitlementUsage as ApiEntitlementUsage,
  EvaluationFailure,
  EvaluationSuccess,
  NumberEntitlementValue,
  User,
} from "../core/index.ts";

/**
 * One entitlement's usage row, as the usage routes answer it.
 *
 * A current server answers with the instance's effective entitlement: `limit`
 * and `limitCapExceededOveragePercent` are the licence's grant with the
 * instance's add-ons and voucher boosts applied, the values its usage gate
 * enforces, and `source` and `provenance` say where they come from. An older
 * server answers with the grant itself, and sends neither.
 *
 * The contract marks `source` required and the generated type follows. This
 * one keeps `source`, `provenance` and the overage percent optional: a row built
 * against the 1.0 shape (a test double, a host's own fixture, the GraphQL
 * mapping, which cannot tell the layers apart) must keep compiling, and a member
 * that becomes required on a type hosts construct would break them. Reading them
 * is unaffected; the raw type is still `KaitenApi.EntitlementUsage`.
 *
 * All three also accept `null`. A report the server answers from its journal,
 * because the same key was already applied, carries the figures of that first
 * report and not a fresh reading of the layers, so its `source` and
 * `provenance` are `null`, as the contract declares: read them as "not computed
 * for this answer", never as "no layer grants this". Narrow with
 * `row.source != null` before using them.
 */
export type EntitlementUsage = Omit<
  ApiEntitlementUsage,
  "source" | "provenance" | "limitCapExceededOveragePercent"
> & {
  /**
   * The layer that grants the entitlement: `license` when the licence does, its
   * value possibly changed by add-ons and boosts, `addon` when only add-ons do.
   * Open: more may come. Absent on a server that predates it, `null` on the
   * answer to a replayed report.
   */
  source?: "license" | "addon" | (string & {}) | null;
  /**
   * Why `limit` is what it is: the licence's grant, the add-ons, the voucher
   * boosts. Absent on a server that predates it, `null` on the answer to a
   * replayed report.
   */
  provenance?: EntitlementProvenance | null;
  /**
   * How far above `limit` usage is still accepted, in percent: `0` for a hard
   * limit, positive for a soft one, `-1` when `limit` is unlimited. The
   * allowance of the instance's effective limit, not of the licence's grant.
   * Absent on a server that predates it, `null` for a BOOLEAN or CONFIG
   * entitlement, which has no value to cap.
   */
  limitCapExceededOveragePercent?: number | null;
};

/** `SET`, `ADD`, `MULTIPLY` or `UNLIMITED`: how a voucher boost changes an entitlement. Open: more may come. */
export type BoostModifierType = "SET" | "ADD" | "MULTIPLY" | "UNLIMITED" | (string & {});

/**
 * Why an entitlement's effective value is what it is: the licence grant, then
 * each add-on attached, then each voucher boost in its window. The identifiers
 * name the rows each layer comes from, for a vendor to find them by.
 */
export interface EntitlementProvenance {
  /** The licence's grant. Null when only add-ons grant the entitlement. */
  license: {
    licenseEntitlementId: string;
    value: EntitlementValue;
    limitCapExceededOveragePercent: number | null;
  } | null;
  /** The active add-on grants, in attachment order. */
  addons: {
    instanceAddonId: string;
    addonId: string;
    addonEntitlementId: string;
    quantity: number;
    /** `ADD`, `OVERRIDE` or `MAX`. Open: more may come. */
    overrideBehavior: "ADD" | "OVERRIDE" | "MAX" | (string & {});
    /** One unit's grant: it counts `quantity` times. */
    value: EntitlementValue;
    limitCapExceededOveragePercent: number | null;
    attachedAt: string;
  }[];
  /** The voucher boosts in their window, in redemption order. */
  boosts: {
    instanceVoucherId: string;
    voucherId: string;
    voucherEntitlementGrantId: string;
    modifierType: BoostModifierType;
    modifierValue: number | null;
    redeemedAt: string;
    effectiveStartsAt: string;
    effectiveExpiresAt: string | null;
  }[];
  /**
   * The arithmetic of a number entitlement, step by step. Null for a flag or a
   * configuration, and when no add-on or boost changes the number.
   */
  number: {
    /** The licence's value. Null when only add-ons grant it. */
    license: number | null;
    afterAddons: number;
    boostSet: number | null;
    boostAdd: number | null;
    boostMultiply: number | null;
    unlimited: boolean;
    /** The effective value; `-1` when unlimited. */
    effective: number;
  } | null;
}

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

/**
 * An entitlement's type. `NUMBER_AI_CREDIT` is a number entitlement counted in
 * AI credits: it carries a `number` value and is metered like `NUMBER`, so
 * branch on `limitValue.type` rather than on this to tell numbers apart.
 *
 * Closed over these four. `NUMBER_AI_CREDIT` was added to what 1.0.0 named
 * because the API already sent it; code that switches over this type
 * exhaustively needs its case, and no other member will follow in 1.x.
 */
export type EntitlementType = "BOOLEAN" | "NUMBER" | "CONFIG" | "NUMBER_AI_CREDIT";

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
 * belongs to. `ReportEntitlementUsageBody` declares `additionalProperties: false`,
 * so sending one is a rejected request, not an ignored field.
 */
export interface ReportUsageInput {
  value: EntitlementValue;
  behavior: UsageBehavior;
  metadata?: Record<string, unknown>;
  /**
   * Idempotency key: 1 to 128 characters of `[A-Za-z0-9._:-]`, matched exactly
   * and case-sensitively, such as a UUID or `llm-call:9f2c:tokens`. It travels
   * in the `Idempotency-Key` request header, never in the body.
   *
   * The API applies a report once per key, per instance and entitlement, over
   * its idempotency window (35 days by default; a key older than that is
   * forgotten and counts as new): sent again with the same `behavior` and value,
   * the report answers its original result with `idempotentReplayed: true` and
   * counts nothing; sent with another `behavior` or value, it is refused with
   * `TransactionIdReusedError`. A refused report (`ThresholdExceeded`) does not
   * spend its key.
   *
   * A server that honours the key says so by echoing it as `transactionId` in
   * the result. The client sends the key regardless, but retries a report that
   * failed on the network or with a 500, 502, 503 or 504, up to three attempts
   * under the same key, only once this client has received such an echo. Until
   * then a failure surfaces after the first attempt: a server that ignored the
   * header would count a retry twice. The client never makes a key up, and a
   * report without one is sent exactly once.
   *
   * A key outside that format is refused before anything is sent, with an
   * `InvalidTransactionIdError`; so is an empty one, which the API would read as
   * no key at all.
   */
  transactionId?: string;
}

/**
 * What a usage report resolves with: the counter after it, plus what the API
 * said about the report in its response headers.
 *
 * On a replay (`idempotentReplayed: true`) the body is rebuilt from the report's
 * journal entry, which keeps the figures of the counter but not the layers they
 * were computed from: `source` and `provenance` are `null`, and the overage
 * percent is the one recorded with that report. A first answer fills all three
 * for a number entitlement.
 */
export type ReportUsageResult = EntitlementUsage & {
  /**
   * The key the report was accepted under, echoed by the server on the first
   * answer and on every replay: the `transactionId` you sent, or `null` when you
   * sent none. A string says the server honours the key. Absent from a server
   * that predates the header.
   */
  transactionId?: string | null;
  /**
   * `true` when the API answered a report already applied under the same
   * `Idempotency-Key` (`Idempotent-Replayed: true`). The body is then that
   * report's original result, nothing was counted again, and its window,
   * value and limit are the ones of that report: do not read it as the current
   * gauge. Its `source` and `provenance` are `null`. Absent otherwise.
   */
  idempotentReplayed?: true;
  /**
   * Why the report's `metadata` was not stored, when it was not
   * (`Kaiten-Metadata-Dropped`): `"too_large"` above 4 KiB. The report itself
   * was counted. Absent otherwise.
   */
  metadataDropped?: string;
};

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

/**
 * How a price is charged. `FLAT_FEE` is a fixed amount per billing period;
 * `USAGE_BASED` charges every sale unit consumed; `OVERAGE` charges only the
 * sale units consumed above the included quota.
 *
 * Open: the API may add a model in a minor release, so handle an unknown value
 * (by not rendering the price, for instance) rather than assuming this list is
 * exhaustive.
 */
export type PriceBillingModel = "FLAT_FEE" | "USAGE_BASED" | "OVERAGE" | (string & {});

/**
 * How a licence or an add-on is sold: `FREE`, `PAID`, or `CUSTOM` (priced by
 * sales, "Contact us"). Open, like {@link PriceBillingModel}.
 */
export type PricingType = "FREE" | "PAID" | "CUSTOM" | (string & {});

/**
 * A price as `@kaitencloud/client` 1.0 typed it: an integer amount and a billing
 * interval.
 *
 * The lists typed `PlanPrice[]` (`Plan.prices`, `Addon.prices`) only ever hold
 * prices that this shape describes faithfully: a flat fee, an integer amount,
 * and an interval of exactly one month or one year. Every other price — a
 * quarterly or semi-annual fee, a usage or overage price, a price in fractions
 * of a minor unit — is in `billingPrices`, typed {@link BillingPrice}. A
 * consumer written against 1.0, which reads `interval === "month"` as "per
 * month" and `amount` as the whole price, therefore never misreads one.
 *
 * The optional members below were added in 1.2. The client sets `id`,
 * `unitAmountDecimal`, `billingModel` and `isDefault` on the prices it maps from
 * the API; the others are only ever set on a {@link BillingPrice}.
 */
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
  /** The price's id: what a checkout names as `licensePriceId`. */
  id?: string;
  /**
   * The exact unit amount in the currency's minor units, as a decimal string
   * (`"4900"`, `"0.0002"`). Equal to `amount` whenever the price is integral.
   */
  unitAmountDecimal?: string;
  /**
   * How many `interval`s one billing period spans: `3` for a quarterly price and
   * `6` for a semi-annual one, both with `interval: "month"`. Absent means one.
   */
  intervalCount?: number;
  billingModel?: PriceBillingModel;
  /** For a `USAGE_BASED` or `OVERAGE` price, the entitlement it meters. */
  meteredEntitlementSlug?: string;
  /**
   * For a metered price, how many measured units make the sale unit the price
   * is per: `1000000` for a price per 1M tokens. The amount is per sale unit.
   */
  saleUnitFactor?: number;
  /** Whether this is the default price of its billing period. */
  isDefault?: boolean;
}

/**
 * Any price the billing API serves, mapped to the SDK's money conventions:
 * `currencyCode` for the API's `currency`, integer minor units for the amount.
 *
 * Unlike {@link PlanPrice}, `amount` is optional: it is absent when the price
 * is not a whole number of minor units (`unitAmountDecimal: "0.0002"`, a price
 * per token), which is then rendered from `unitAmountDecimal` and never
 * rounded into an integer. A metered price (`USAGE_BASED`, `OVERAGE`) has no
 * `interval` and is quoted per sale unit; never add it into a headline price.
 */
export interface BillingPrice extends Omit<
  PlanPrice,
  "amount" | "id" | "unitAmountDecimal" | "currencyCode" | "billingModel" | "isDefault"
> {
  id: string;
  /** The amount in minor units, when it is an integer. */
  amount?: number;
  /** The exact unit amount in minor units, as a decimal string. Always set. */
  unitAmountDecimal: string;
  currencyCode: CurrencyCode;
  billingModel: PriceBillingModel;
  isDefault: boolean;
  /** Singular label of the sale unit a metered price is per, e.g. `"1M tokens"`. */
  saleUnitSingular?: string | null;
  /** Plural label of that sale unit. */
  saleUnitPlural?: string | null;
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
  /** The add-on family this add-on is a version of. */
  familySlug?: string;
  pricingType?: PricingType;
  /** The most units one instance may hold. Null when unbounded. */
  maxQuantity?: number | null;
  /** How many units the instance holds, on an add-on read from a customer's portal. */
  quantity?: number;
  /** Every price of the add-on. See {@link PlanPrice} for why `prices` holds fewer. */
  billingPrices?: BillingPrice[];
  /** The licence families this add-on can be attached to. */
  compatibleLicenseFamilies?: string[];
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
  /** Every active price of the plan. See {@link PlanPrice} for why `prices` holds fewer. */
  billingPrices?: BillingPrice[];
  pricingType?: PricingType;
  /** Length of the trial a subscription starts with, in days. Null without a trial. */
  trialPeriodDays?: number | null;
  /** Whether subscribing requires a payment method, even when nothing is due today. */
  requiresPaymentMethod?: boolean;
  /**
   * Whether a customer can subscribe to this plan by themselves, through a
   * checkout. When false, offer `selfServeCtaUrl` instead, when there is one.
   */
  selfServe?: boolean;
  /** Where to send a customer for a plan that is not self-serve ("Contact us"). */
  selfServeCtaUrl?: string | null;
  /** The add-on families that can be attached to this plan. */
  compatibleAddonFamilies?: string[];
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
   * The allowance in force, as a percentage of the limit: `0` for a hard limit,
   * positive for a soft one, `-1`/null when nothing caps it. It is the
   * instance's effective allowance when the usage read carried it, as a current
   * server's REST read does, and the licence grant's otherwise. Beside
   * `maximumAllowedUsage` so a host can tell "at the included cap but still
   * served" from "the server will refuse the next report" — two states that both
   * read above 100% used.
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
  /** The public add-ons, on a catalog read with a publishable key. */
  addOns?: Addon[];
  /**
   * What the organization offers to self-serve customers, on a catalog read
   * with a publishable key: `checkout` when at least one plan is self-serve,
   * `paymentMethods` when its billing provider can capture a payment method.
   */
  capabilities?: Pick<BillingCapabilities, "checkout" | "paymentMethods">;
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
