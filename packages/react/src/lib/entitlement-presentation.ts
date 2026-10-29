// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { EntitlementPresentation } from "../types.ts";

/**
 * Whether an entitlement belongs in customer-facing components. The definition's
 * `userFacing` flag is the source of truth; `undefined`/`null` (REST read path,
 * older APIs) stays visible for backwards compatibility — only an explicit
 * `false` (an internal counter) hides the row.
 */
export function isCustomerFacing(entitlement: EntitlementPresentation): boolean {
  return entitlement.userFacing !== false;
}

/**
 * The unit label for a numeric value ("seat"/"seats"), or null when the
 * entitlement carries no unit metadata.
 */
export function unitLabel(entitlement: EntitlementPresentation, count: number): string | null {
  const singular = entitlement.unitSingular ?? null;
  const plural = entitlement.unitPlural ?? singular;
  if (!singular && !plural) return null;
  return Math.abs(count) === 1 ? (singular ?? plural) : (plural ?? singular);
}

/**
 * The *sale* unit label for a numeric value ("1M tokens"), or null when the
 * entitlement carries no distinct sale unit.
 *
 * An entitlement is not always sold in the unit it is metered in: usage is
 * counted in tokens and quoted per million. This is what turns "$8 per unit"
 * into "$8 per 1M tokens" on a pricing table.
 *
 * It does NOT fall back to `unitLabel`: returning null forces the caller to
 * choose the base unit deliberately, rather than silently quoting a per-million
 * price as if it were per-token.
 */
export function saleUnitLabel(entitlement: EntitlementPresentation, count: number): string | null {
  const singular = entitlement.saleUnitSingular ?? null;
  const plural = entitlement.saleUnitPlural ?? singular;
  if (!singular && !plural) return null;
  return Math.abs(count) === 1 ? (singular ?? plural) : (plural ?? singular);
}

/**
 * Convert a base-unit value into sale units — 40,000,000 tokens at a factor of
 * 1,000,000 is `40` ("40 × 1M tokens"). Returns null when the entitlement has no
 * usable factor.
 *
 * The absent factor is deliberately NOT defaulted to `1`: the REST read path
 * never carries one, and treating "unknown" as "one base unit per sale unit"
 * would quote a 40M-token limit as 40M sale units. A non-positive factor is
 * rejected for the same reason — it can only produce a wrong quote, and zero
 * would divide by zero.
 */
export function toSaleUnits(entitlement: EntitlementPresentation, value: number): number | null {
  const factor = entitlement.saleUnitFactor;
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) return null;
  return value / factor;
}
