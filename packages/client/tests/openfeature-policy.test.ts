// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "vite-plus/test";
import * as sdk from "../src/index.ts";
import { createMockKaitenClient } from "../src/testing/index.ts";

test("direct evaluation is absent, including generated and mock escape hatches", () => {
  const client = new sdk.KaitenClient({ apiUrl: "https://api.test/api", authScheme: "none" });
  for (const value of [client, createMockKaitenClient()]) {
    for (const name of ["evaluateFlag", "evaluateFlags", "flags"]) {
      expect(name in value).toBe(false);
    }
  }
  for (const name of ["evaluateFlag", "evaluateFlagsBulk"]) {
    expect(name in sdk.KaitenApi).toBe(false);
  }
  for (const name of ["isEvaluationSuccess", "isEvaluationFailure"]) {
    expect(name in sdk).toBe(false);
  }
  expect(typeof sdk.KaitenApi.createFeatureFlag).toBe("function");
  expect(typeof client.licenses.get).toBe("function");
});

// Type-level negative API assertions are checked but never invoked.
function forbidden(client: sdk.KaitenClientLike, facade: sdk.KaitenClient) {
  // @ts-expect-error OpenFeature owns evaluation
  client.evaluateFlag("beta");
  // @ts-expect-error OpenFeature owns evaluation
  client.evaluateFlags();
  // @ts-expect-error no evaluation facade
  facade.flags.evaluate("beta");
  // @ts-expect-error no raw generated escape hatch
  sdk.KaitenApi.evaluateFlag({ path: { key: "beta" } });
  // @ts-expect-error no raw generated bulk escape hatch
  sdk.KaitenApi.evaluateFlagsBulk({});
}
void forbidden;
