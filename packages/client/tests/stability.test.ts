// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { expect, test } from "vite-plus/test";

import * as Client from "../src/index.ts";

// STABILITY.md is what a host reads to know which names it may build on. A name that the
// package exports and the document never mentions is a name nobody decided on, and one a
// release would freeze by accident.
// From the package, or from the workspace root, whichever a runner starts in.
const STABILITY = ["packages/client/STABILITY.md", "STABILITY.md"]
  .map((path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  })
  .find((text) => text !== undefined)!;

// What 1.1.0 shipped before this document named exports one by one. They are 1.x API all the same;
// the list is closed, and a name added to the root after it is named in STABILITY.md or the test fails.
const RELEASED_UNNAMED = new Set([
  "KaitenNetworkError",
  "UNLIMITED_THRESHOLD",
  "assertPublishableKey",
  "defaultActions",
  "getMaximumAllowedUsage",
  "getUsageScope",
  "isEvaluationFailure",
  "isEvaluationSuccess",
  "isPeriodicEntitlement",
  "isPublishableKey",
  "isSoftLimit",
  "isUnlimitedThreshold",
  "normalizeBrandingCapability",
  "normalizePlanPrices",
  "normalizePlansResponse",
  "normalizeResolvedEntitlements",
  "resolveLicenseTerm",
  "resolveUsageScope",
  "retry",
  "withQuery",
]);

test("STABILITY.md names every export of the root added since 1.1.0", () => {
  const unnamed = Object.keys(Client).filter(
    (name) => !RELEASED_UNNAMED.has(name) && !new RegExp(`\\b${name}\\b`).test(STABILITY),
  );
  expect(unnamed).toEqual([]);
});

test("the list of what 1.1.0 left unnamed names only exports that exist", () => {
  const exported = new Set(Object.keys(Client));
  expect([...RELEASED_UNNAMED].filter((name) => !exported.has(name))).toEqual([]);
});
