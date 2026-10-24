// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type {
  BillingPrice,
  PlanPrice,
  KaitenLocalization,
  KaitenPortalBillingWords,
} from "@kaitencloud/react";

/** Display a supplied value, never turn a missing one into a grant. */
export function grantValueText(value: unknown, localization: KaitenLocalization): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") {
    return value ? localization.includedFeatures.enabled : localization.includedFeatures.disabled;
  }
  if (typeof value === "number") return value.toLocaleString();
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The operation the API named. Unknown operations are not given known effects. */
export function grantDescription(
  kind: string,
  value: unknown,
  words: KaitenPortalBillingWords,
  localization: KaitenLocalization,
): string | null {
  if (kind === "UNLIMITED") return localization.includedFeatures.unlimited;
  const text = grantValueText(value, localization);
  if (text === null) return null;
  switch (kind) {
    case "SET":
      return words.grantSet?.(text) ?? null;
    case "ADD":
      return words.grantAdd?.(text) ?? null;
    case "MULTIPLY":
      return words.grantMultiply?.(text) ?? null;
    case "MAX":
      return words.grantMinimum?.(text) ?? null;
    default:
      return null;
  }
}

export function billingTimingText(
  price: BillingPrice | PlanPrice | null | undefined,
  words: KaitenPortalBillingWords,
): string | null {
  const timing = price && "billingTiming" in price ? price.billingTiming : undefined;
  return timing === "ADVANCE"
    ? (words.billingAdvance ?? null)
    : timing === "ARREARS"
      ? (words.billingArrears ?? null)
      : null;
}
