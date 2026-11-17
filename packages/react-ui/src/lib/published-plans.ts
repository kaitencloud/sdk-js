// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Plan } from "@kaitencloud/react";

/**
 * The plans a catalogue component may show a visitor: every plan but those the catalogue
 * says are not published.
 *
 * `published` is the catalogue's own visibility flag, mapped from the licence's lifecycle
 * state. Under a server token `usePlans()` returns every licence of the organization, drafts
 * and archived versions included, so a component that showed them all put unreleased plans
 * on a public page. `!== false` (not a truthiness test) is deliberate and matches
 * `useUpgradeOptions`: `undefined` means the read path did not say (host-supplied `plans`,
 * an older API) and stays visible; only an explicit `false` hides a plan.
 */
export function publishedPlans<TPlan extends Plan>(plans: readonly TPlan[]): TPlan[] {
  return plans.filter((plan) => plan.published !== false);
}
