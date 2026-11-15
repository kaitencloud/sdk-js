// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "vite-plus/test";
import * as sdk from "../src/index.ts";

test("React offers no direct flag evaluation hook or cache key", () => {
  for (const name of [
    "useFeatureFlag",
    "useFeatureFlags",
    "isEvaluationSuccess",
    "isEvaluationFailure",
  ]) {
    expect(name in sdk).toBe(false);
  }
  expect("featureFlag" in sdk.kaitenKeys).toBe(false);
});

function forbidden() {
  // @ts-expect-error official OpenFeature SDK owns evaluation hooks
  sdk.useFeatureFlag("beta");
  // @ts-expect-error official OpenFeature SDK owns bulk evaluation
  sdk.useFeatureFlags();
  // @ts-expect-error Show only guards entitlements
  const show: sdk.ShowProps = { when: "flag-enabled", flagKey: "beta", children: null };
  // @ts-expect-error Gate does not evaluate a flag
  const gate: sdk.GateProps = { entitlement: "seats", flagKey: "beta", children: () => null };
  // @ts-expect-error a paywall only guards entitlements
  const options: Parameters<typeof sdk.usePaywallTrigger>[1] = { flagKey: "beta" };
  return { show, gate, options };
}
void forbidden;
