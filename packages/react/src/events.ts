// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { KaitenComponentEventMap, KaitenComponentEventName } from "@kaitencloud/client";

export const kaitenComponentEvents = {
  planChanged: "kaiten:plan-changed",
  addonAdded: "kaiten:addon-added",
  subscriptionCanceled: "kaiten:subscription-canceled",
  paymentUpdated: "kaiten:payment-updated",
  quotaAdded: "kaiten:quota-added",
} as const satisfies Record<string, KaitenComponentEventName>;

export function emitKaitenEvent<TName extends KaitenComponentEventName>(
  name: TName,
  detail: KaitenComponentEventMap[TName],
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
