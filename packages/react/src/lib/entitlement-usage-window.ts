// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { resolveUsageScope } from "@kaitencloud/client";

import type { KaitenLocalization } from "../localization/types.ts";
import type { ResolvedEntitlement } from "../types.ts";

/**
 * What a usage meter is allowed to say about the window it counts in — or
 * `null`, which means say nothing.
 *
 * A bare "12,400,000 / 40,000,000" is ambiguous in the one way that changes what
 * the reader should do: at the cap, a lifetime counter means *buy more* and a
 * periodic one means *wait*. Rendering the window is what makes those two
 * different sentences instead of the same number.
 *
 * The `null` branches matter as much as the labelled ones:
 *
 * - **No numeric cap, no window.** A window is a property of a counter, and a
 *   boolean or config grant has nothing to count. Labelling one "all time" would
 *   be false — an easy mistake, made and corrected once already while this
 *   feature was built. The guard is on `limitValue.type`, not
 *   on `entitlement.type`, so it agrees with what the meter surfaces themselves
 *   filter on and does not let a `NUMBER_AI_CREDIT` — a numeric grant the SDK's
 *   own three-member `EntitlementType` union cannot name — slip through
 *   unlabelled.
 * - **Scope unknown.** The usage read failed, or the read path never carried the
 *   bounds. Either way nobody read a cadence, and printing "all time" would be
 *   asserting one. Silence is the honest rendering.
 */
export function usageWindowLabel(
  entitlement: ResolvedEntitlement,
  localization: KaitenLocalization,
): string | null {
  if (entitlement.limitValue.type !== "number") return null;

  const scope = resolveUsageScope(entitlement);
  if (scope === "UNKNOWN") return null;

  if (scope === "LIFETIME") return localization.usageMeters.lifetime;

  // Raw ISO bounds: the pack formats them, so the locale travels with the pack
  // rather than having to be threaded down to every call site.
  return localization.usageMeters.currentWindow(
    entitlement.currentPeriodStart ?? "",
    entitlement.currentPeriodEnd ?? "",
  );
}
