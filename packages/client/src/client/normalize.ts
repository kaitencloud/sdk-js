// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { getMaximumAllowedUsage, UNLIMITED_THRESHOLD } from "../domain/entitlement-usage.ts";
import type {
  EntitlementPresentation,
  EntitlementType,
  EntitlementValue,
  Instance,
  KaitenBrandingCapability,
  License,
  LicenseTerm,
  LicenseEntitlementRow,
  EntitlementUsage,
  Plan,
  PlanEntitlement,
  PlanPrice,
  PortalAction,
  ResolvedEntitlement,
} from "./types.ts";

export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function normalizePlanPrices(plan: Plan): Plan {
  if (plan.prices?.length) return plan;

  const prices: PlanPrice[] = [];
  if (typeof plan.price === "number") {
    prices.push({
      amount: plan.price,
      currencyCode: plan.currencyCode,
      interval: plan.interval,
    });
  }
  if (typeof plan.annualPrice === "number") {
    prices.push({
      amount: plan.annualPrice,
      currencyCode: plan.currencyCode,
      interval: "year",
      label: "Annual",
    });
  }

  return {
    ...plan,
    prices,
  };
}

export function normalizePlansResponse(data: unknown): Plan[] {
  const rawPlans = Array.isArray(data)
    ? data
    : Array.isArray((data as { plans?: unknown[] })?.plans)
      ? (data as { plans: Plan[] }).plans
      : [];

  return rawPlans.map((plan) => normalizePlanPrices(plan as Plan));
}

export function normalizeBrandingCapability(
  branding?: Partial<KaitenBrandingCapability> | null,
): KaitenBrandingCapability {
  return {
    removable: Boolean(branding?.removable),
  };
}

export function defaultActions(): PortalAction[] {
  return [
    {
      type: "upgrade_plan",
      label: "Upgrade version",
      eventName: "kaiten:plan-changed",
    },
    {
      type: "add_quota",
      label: "Add quota",
      eventName: "kaiten:quota-added",
    },
    {
      type: "manage_addon",
      label: "Add add-ons",
      eventName: "kaiten:addon-added",
    },
  ];
}

// The API attaches entitlement groups to each license entitlement
// (LicenseEntitlement.entitlementGroups on REST; entitlement.entitlementGroups on
// the GraphQL path). Surface them as the presentation axis the components
// consume: `category` is the first group's human-readable name (shown as a row
// subtitle / comparison section), and `tags` are the group slugs
// (machine-matchable — this is what `useUsageGroup(groupSlug)` filters on). Before
// this mapping the signal was dropped, leaving category/tags permanently undefined
// and the grouping code paths dead against real data.
function rowGroups(row: LicenseEntitlementRow): LicenseEntitlementRow["entitlementGroups"] {
  return row.entitlementGroups ?? row.entitlement?.entitlementGroups;
}

function groupCategory(groups: LicenseEntitlementRow["entitlementGroups"]): string | null {
  return groups?.[0]?.name ?? null;
}

function groupTags(groups: LicenseEntitlementRow["entitlementGroups"]): string[] | null {
  const tags = (groups ?? []).map((group) => group.slug).filter(Boolean);
  return tags.length ? tags : null;
}

// Presentation metadata rides on the full entitlement definition (GraphQL read
// path only — the REST projection drops it). Absent definition = all undefined,
// which components treat as "visible, unordered, unitless" for compatibility.
function rowPresentation(row: LicenseEntitlementRow): EntitlementPresentation & {
  description?: string | null;
} {
  const definition = row.entitlement;
  if (!definition) return {};
  return {
    description: definition.description,
    icon: definition.icon,
    unitSingular: definition.unitSingular,
    unitPlural: definition.unitPlural,
    // The sale unit is what makes a price quotable: metered in tokens, sold per
    // 1M. It rides the same definition as the base unit and was the one piece of
    // it that never left this function.
    saleUnitSingular: definition.saleUnitSingular,
    saleUnitPlural: definition.saleUnitPlural,
    saleUnitFactor: definition.saleUnitFactor,
    userFacing: definition.userFacing,
    displayOrder: definition.displayOrder,
  };
}

// The unlimited flag is server-computed on the GraphQL read path. REST rows
// don't carry it, so fall back to the same exact-sentinel check the reporter
// enforces (only `-1` disables the cap — any other value, negative or not, is
// a real threshold), keeping both transports in agreement.
function rowUnlimited(row: LicenseEntitlementRow): boolean {
  return row.unlimited ?? (row.value.type === "number" && row.value.value === -1);
}

/**
 * The value an instance is entitled to: its usage row's `limit` when the read
 * carried one of the grant's own type, the licence grant otherwise.
 */
function effectiveLimit(row: LicenseEntitlementRow, usage?: EntitlementUsage): EntitlementValue {
  const grant = row.value as EntitlementValue;
  const limit = usage?.limit as EntitlementValue | undefined;
  return limit && limit.type === grant.type ? limit : grant;
}

/**
 * How far past the effective limit the API keeps accepting usage, in percent:
 * the usage row's `limitCapExceededOveragePercent` when the read carried one,
 * the licence grant's otherwise.
 *
 * The two travel together. A current server answers its usage reads with the
 * limit and the percent in force, add-ons and voucher boosts applied, so a limit
 * raised by an add-on is measured against the allowance that goes with it. An
 * older server sends no percent, and the GraphQL read does not select it yet:
 * both fall back to the grant, which is what they have always done.
 */
function effectiveOveragePercent(
  row: LicenseEntitlementRow,
  usage?: EntitlementUsage,
): number | null | undefined {
  const percent = usage?.limitCapExceededOveragePercent;
  return typeof percent === "number" ? percent : row.limitCapExceededOveragePercent;
}

// Customer-facing sort: displayOrder ascending (nulls last), then name.
function byDisplayOrder(
  left: { displayOrder?: number | null; name: string },
  right: {
    displayOrder?: number | null;
    name: string;
  },
): number {
  const l = left.displayOrder ?? Number.MAX_SAFE_INTEGER;
  const r = right.displayOrder ?? Number.MAX_SAFE_INTEGER;
  if (l !== r) return l - r;
  return left.name.localeCompare(right.name);
}

export function planFromLicense(
  license: License,
  entitlements: readonly LicenseEntitlementRow[] | null | undefined,
): Plan {
  const planEntitlements: PlanEntitlement[] = (entitlements ?? [])
    .map((entitlement) => ({
      slug: entitlement.entitlementSlug ?? "",
      name: entitlement.entitlementName,
      type: (entitlement.entitlementType ?? "BOOLEAN") as EntitlementType,
      value: entitlement.value as EntitlementValue,
      unlimited: rowUnlimited(entitlement),
      category: groupCategory(rowGroups(entitlement)),
      tags: groupTags(rowGroups(entitlement)),
      ...rowPresentation(entitlement),
    }))
    .sort(byDisplayOrder);

  return {
    id: license.id,
    slug: license.slug,
    name: license.name,
    description: license.description || undefined,
    published: license.lifecycleState === "PUBLISHED",
    lifecycleState: license.lifecycleState,
    familyId: license.familyId,
    highlighted: license.isDefault,
    entitlements: planEntitlements,
  };
}

export function normalizeResolvedEntitlements(
  entitlements: readonly LicenseEntitlementRow[] | null | undefined,
  usageRows: EntitlementUsage[] | null | undefined,
  options?: {
    /**
     * The usage read failed. Numeric entitlements then carry no consumption at
     * all rather than defaulting to zero — see `ResolvedEntitlement.usageUnavailable`.
     */
    usageUnavailable?: boolean;
    /**
     * The usage rows are real but carry no window bounds, because the read path
     * does not select them. Their absence then says nothing about cadence, so no
     * entitlement may be presented as a lifetime counter — see
     * `ResolvedEntitlement.usageWindowUnknown`.
     */
    usageWindowUnknown?: boolean;
  },
): ResolvedEntitlement[] {
  const usageUnavailable = options?.usageUnavailable === true;
  const usageWindowUnknown = options?.usageWindowUnknown === true;
  const usageBySlug = new Map((usageRows ?? []).map((row) => [row.entitlementSlug, row]));

  return (entitlements ?? [])
    .map((entitlement): ResolvedEntitlement => {
      const slug = entitlement.entitlementSlug ?? "";
      const usage = usageBySlug.get(slug);
      // What the instance is entitled to: the usage row's `limit` when the read
      // carried one, the licence grant otherwise. A Kaiten server with add-ons
      // and vouchers answers its gauges with the instance's EFFECTIVE value —
      // the grant with its add-ons and boosts applied, the very value its usage
      // gate enforces — and an older one with the grant itself, so the row is
      // right on both. Measuring against the grant alone would show a customer
      // who bought 3 extra seats as over their limit while the server still
      // accepts their reports. The overage percent follows the same rule.
      const measured = usageUnavailable ? undefined : usage;
      const limit = effectiveLimit(entitlement, measured);
      const overagePercent = effectiveOveragePercent(entitlement, measured);
      // A successful read with no row for this slug means nothing has been
      // consumed, which is zero. A failed read means unknown — and the two must
      // not collapse into the same number.
      const currentValue =
        limit.type === "number"
          ? usageUnavailable
            ? null
            : (usage?.value ?? { type: "number", value: 0 })
          : limit;

      // Unlimited grants have no cap to consume toward, so report no
      // remaining/percentage and a healthy status rather than measuring usage
      // against the sentinel (which read as over_limit / 0 left).
      const unlimited =
        limit === entitlement.value
          ? rowUnlimited(entitlement)
          : limit.type === "number" && limit.value === UNLIMITED_THRESHOLD;
      // What the API actually accepts up to, which a soft limit puts above the
      // entitled value. Null whenever nothing caps it, so the callers keep
      // answering "no cap" the way they always have.
      const maxAllowed =
        unlimited || limit.type !== "number"
          ? null
          : getMaximumAllowedUsage(limit.value, overagePercent);

      return {
        id: `${entitlement.licenseSlug}:${slug}`,
        slug,
        name: entitlement.entitlementName,
        type: (entitlement.entitlementType ?? "BOOLEAN") as EntitlementType,
        category: groupCategory(rowGroups(entitlement)),
        tags: groupTags(rowGroups(entitlement)),
        ...rowPresentation(entitlement),
        source: "license",
        limitValue: limit,
        currentValue,
        unlimited,
        // Only numeric grants can have unknown consumption: a boolean or config
        // grant is fully described by the license itself.
        ...(usageUnavailable && limit.type === "number" ? { usageUnavailable: true } : {}),
        // The window travels only when it was actually read. An absent pair on a
        // successful read is a fact about the entitlement — the API sets both
        // bounds exactly when a reset period is configured, and zero-fills
        // windows never reported into, so "no bounds" means lifetime counter and
        // never "no report yet". An absent pair because nobody asked for it is a
        // fact about the request, and says nothing at all; that is what
        // `usageWindowUnknown` marks, and why the two are not the same shape.
        //
        // The SDK never computes a window. `period.go` owns that arithmetic and
        // it is server-side, phased off the instance's own license start date for
        // a LICENSE_START anchor — a client-side guess would be wrong for every
        // instance but one.
        ...(usageWindowUnknown ? { usageWindowUnknown: true } : {}),
        ...(usageUnavailable || usageWindowUnknown
          ? {}
          : {
              currentPeriodStart: usage?.currentPeriodStart ?? null,
              currentPeriodEnd: usage?.currentPeriodEnd ?? null,
            }),
        limitCapExceededOveragePercent: overagePercent ?? null,
        maximumAllowedUsage: maxAllowed,
        // Counted against what the API accepts, not against the included
        // value: a soft limit still has room at its granted figure, and
        // reporting nothing left there would gate a customer the server would
        // have served.
        remaining:
          maxAllowed !== null && currentValue?.type === "number"
            ? Math.max(maxAllowed - currentValue.value, 0)
            : null,
        // Deliberately still a share of the INCLUDED value, so a meter reads
        // 100% where the customer has consumed what they bought, and above it
        // through the allowance. Rescaling to the ceiling would report someone
        // at their cap as 91% and hide the moment they cross it.
        percentageUsed:
          limit.type === "number" && currentValue?.type === "number" && limit.value > 0
            ? (currentValue.value / limit.value) * 100
            : limit.type === "boolean"
              ? limit.value
                ? 100
                : 0
              : null,
        status: entitlementStatus(limit, currentValue, maxAllowed),
      };
    })
    .sort(byDisplayOrder);
}

/**
 * Where an entitlement stands: `enabled`/`disabled` for a boolean grant, and
 * for a capped number, `over_limit` from the highest usage the API accepts,
 * `near_limit` from 80% of the entitled value.
 *
 * `limit` is the instance's effective limit, not the licence's grant.
 *
 * over_limit is the terminal state -- nothing more will be accepted -- so it
 * starts where the server starts rejecting. The band between the entitled
 * value and the ceiling is served but worth warning about, which is what
 * near_limit already means.
 */
export function entitlementStatus(
  limit: EntitlementValue,
  current: EntitlementValue | null | undefined,
  maxAllowed: number | null,
): ResolvedEntitlement["status"] {
  if (limit.type === "boolean") return limit.value ? "enabled" : "disabled";
  if (limit.type !== "number" || maxAllowed === null || current?.type !== "number") {
    return "enabled";
  }
  if (current.value >= maxAllowed) return "over_limit";
  return limit.value > 0 && current.value / limit.value >= 0.8 ? "near_limit" : "enabled";
}

/**
 * Reads the license period off the instance the snapshot describes.
 *
 * `startLicenseDate` and `endLicenseDate` were carried across the wire, mapped
 * onto `Instance`, and then read by nothing: an expired license kept every
 * entitlement it had ever granted. This is the one place the dates become a
 * fact the rest of the SDK can act on.
 *
 * `now` is injected so the derivation stays pure and testable. Unparseable or
 * absent dates yield `null` rather than a guess — an unknown term must not be
 * reported as expired, which would lock out a live customer over a malformed
 * field.
 */
export function resolveLicenseTerm(
  instance: Instance | null | undefined,
  now: Date = new Date(),
): LicenseTerm | null {
  if (!instance) return null;

  const startsAt = instance.startLicenseDate;
  const expiresAt = instance.endLicenseDate;
  const start = Date.parse(startsAt ?? "");
  const end = Date.parse(expiresAt ?? "");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  const at = now.getTime();
  const status: LicenseTerm["status"] =
    at < start ? "not_started" : at >= end ? "expired" : "active";

  return { status, startsAt, expiresAt };
}
