// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { ResolvedEntitlement } from "@kaitencloud/react";

/**
 * How the styled components read a quota: where its usage stands against what its grant permits.
 *
 * This is the rule of the Kaiten console, ported as it is, so that a customer sees the same state in
 * the console and in an application built on this SDK. It belongs to the styled components only. The
 * headless core keeps its own, older reading (`ResolvedEntitlement.status`, `percentageUsed`), which
 * hosts gate on and which must not move; nothing here feeds back into it.
 *
 * A grant is two numbers: the granted value and the allowance, a percentage of it that usage may
 * exceed before the API refuses a report. Everything below is derived from those two and the usage.
 */

/**
 * Where a quota stands. `unbounded` has no state to be in: nothing caps it, so there is nothing to
 * measure against.
 */
export type UsageState =
  | "healthy"
  | "watch"
  | "near_limit"
  | "in_allowance"
  | "at_limit"
  | "over_limit"
  | "unbounded";

/** Whether nothing caps the grant: no value, or the unlimited sentinel, or a nonsensical negative. */
function hasNoCeiling(limit: number | null | undefined): limit is null | undefined {
  return limit === null || limit === undefined || limit < 0;
}

/**
 * The allowance a grant tolerates, as a percentage of its granted value. A hard limit tolerates none,
 * and so does anything that is not a whole, positive percentage: a grant written before the field
 * existed, the unlimited sentinel, a fraction. Reading those as zero is what the API does.
 */
export function getAllowancePercent(overagePercent: number | null | undefined): number {
  return typeof overagePercent === "number" &&
    Number.isInteger(overagePercent) &&
    overagePercent > 0
    ? overagePercent
    : 0;
}

/**
 * The most usage the grant permits: the granted value plus its allowance, not rounded. The API
 * accepts a report up to and including it and refuses the next. `null` when nothing caps the grant.
 * Zero is a real ceiling: a grant of nothing permits nothing.
 */
export function getUsageCeiling(
  limit: number | null | undefined,
  overagePercent?: number | null,
): number | null {
  if (hasNoCeiling(limit)) {
    return null;
  }
  const percent = getAllowancePercent(overagePercent);
  return percent > 0 ? limit + (limit * percent) / 100 : limit;
}

/**
 * How full the grant is, as a share of the ceiling it permits rather than of the value it grants: a
 * grant with an allowance still has room at its granted value. Above 1 once usage is past the
 * ceiling. `null` when nothing caps the grant.
 */
export function getUsageRatio(
  used: number,
  limit: number | null | undefined,
  overagePercent?: number | null,
): number | null {
  const ceiling = getUsageCeiling(limit, overagePercent);
  if (ceiling === null) {
    return null;
  }
  // A ceiling of nothing leaves no room: any usage at all is past it, which no finite ratio says.
  if (ceiling === 0) {
    return used > 0 ? Number.POSITIVE_INFINITY : 1;
  }
  return used / ceiling;
}

/**
 * Where a quota stands against its grant. The order matters and mirrors the console:
 *
 * - past the ceiling is `over_limit`, and exactly on it `at_limit`: the API refuses a report only
 *   above the ceiling, so the ceiling itself is the last accepted usage and the grant is spent
 *   there, whether the wall is the granted value or the end of its allowance;
 * - beyond the granted value but under the ceiling is `in_allowance`, whatever the saturation says,
 *   because consuming the tolerated overage is the one thing an allowance exists to allow and a wide
 *   allowance can leave the saturation low (105 of 100 with 50% is a ratio of 0.70);
 * - below that, the saturation decides: from 80% `near_limit`, from 50% `watch`, else `healthy`.
 */
export function getUsageState(
  used: number,
  limit: number | null | undefined,
  overagePercent?: number | null,
): UsageState {
  const ratio = getUsageRatio(used, limit, overagePercent);

  if (ratio === null) {
    return "unbounded";
  }
  if (ratio > 1) {
    return "over_limit";
  }
  if (ratio === 1) {
    return "at_limit";
  }
  if (getAllowancePercent(overagePercent) > 0 && used > (limit as number)) {
    return "in_allowance";
  }
  if (ratio >= 0.8) {
    return "near_limit";
  }
  if (ratio >= 0.5) {
    return "watch";
  }
  return "healthy";
}

/** The states that call for a look: near the wall, past the grant, on the wall, or past it. */
export function isUsageAtRisk(state: UsageState): boolean {
  return (
    state === "near_limit" ||
    state === "in_allowance" ||
    state === "at_limit" ||
    state === "over_limit"
  );
}

/** A state's colour, as a fill for a bar and as a class for text read against a surface. */
export interface UsageTone {
  fill: string;
  text: string;
}

/**
 * The colour a state reads in. One mapping for the bar, the figures beside it and the words, so a row
 * never shows a green bar next to an amber number.
 *
 * Red from the wall on, since a spent grant blocks as surely as a breached one. Amber for the two
 * states that are still served but deserve a look. Green for the rest.
 *
 * The text classes are the `-subtle-foreground` pair, never `--warning` or `--destructive`
 * themselves: those two are fill colours, tuned to carry text on top of them, and used as text on a
 * light surface they fail contrast. The green has no such pair in the palette, and plain foreground
 * text is what a healthy figure has always been.
 */
export function getUsageTone(state: UsageState): UsageTone {
  switch (state) {
    case "at_limit":
    case "over_limit":
      return { fill: "bg-ktn-destructive", text: "text-destructive-subtle-foreground" };
    case "near_limit":
    case "in_allowance":
      return { fill: "bg-ktn-warning", text: "text-warning-subtle-foreground" };
    default:
      return { fill: "bg-ktn-success", text: "text-ktn-foreground" };
  }
}

/**
 * Where a customer's quota stands, read off a resolved entitlement.
 *
 * `state` is `null` when none can be computed: the usage read failed (`unavailable`), so how much
 * is used is unknown. That is deliberately not zero. A failed read is not "nothing consumed", and
 * painting it as such would show a healthy quota the customer may have exhausted.
 */
export interface QuotaReading {
  /** What was consumed. Zero only when the usage was read and there was none. */
  used: number;
  /** The granted value, or `null` when nothing caps the quota. */
  limit: number | null;
  /** The allowance in force, as a percentage of the granted value. Zero for a hard limit. */
  overagePercent: number;
  /** The usage the grant permits at most, or `null` when nothing caps the quota. */
  ceiling: number | null;
  /** Usage as a share of the ceiling (see {@link getUsageRatio}), or `null` when nothing caps the quota. */
  ratio: number | null;
  /** Whether the usage read failed, so that `used` says nothing. */
  unavailable: boolean;
  /** Where the quota stands, or `null` when the usage read failed. */
  state: UsageState | null;
  /**
   * Usage as a whole percentage of the GRANTED value, not capped: 105 inside an allowance is 105.
   * Zero when nothing caps the quota or the grant is nothing.
   */
  percentOfGrant: number;
}

export function readQuota(
  entitlement: Pick<
    ResolvedEntitlement,
    | "currentValue"
    | "limitCapExceededOveragePercent"
    | "limitValue"
    | "unlimited"
    | "usageUnavailable"
  >,
): QuotaReading {
  const granted = entitlement.limitValue.type === "number" ? entitlement.limitValue.value : null;
  const limit = entitlement.unlimited === true || hasNoCeiling(granted) ? null : granted;
  const unavailable = entitlement.usageUnavailable === true;
  const used = entitlement.currentValue?.type === "number" ? entitlement.currentValue.value : 0;
  const overagePercent = getAllowancePercent(entitlement.limitCapExceededOveragePercent);

  return {
    used,
    limit,
    overagePercent,
    ceiling: getUsageCeiling(limit, overagePercent),
    ratio: getUsageRatio(used, limit, overagePercent),
    unavailable,
    state: unavailable ? null : getUsageState(used, limit, overagePercent),
    percentOfGrant: limit !== null && limit > 0 ? Math.round((used / limit) * 100) : 0,
  };
}
