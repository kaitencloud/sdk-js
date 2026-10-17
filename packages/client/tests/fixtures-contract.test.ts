// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { contractProblems } from "./support/contract-schema.ts";

// The recorded answers are what the mapping tests read. They only mean something
// while they are answers the contract allows, so each is checked against its
// response schema in `contracts/openapi.yaml`. When the snapshot is synced and a
// member becomes required, nullable or bounded, this file fails where the
// fixtures no longer fit, and the fixtures are regenerated from Kaiten as
// `fixtures/README.md` says.

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;
}

describe("the public catalogue fixture", () => {
  const catalog = fixture<Record<string, unknown>>("public-catalog.acme.json");

  test("is an answer the contract allows", () => {
    expect(contractProblems("PublicCatalog", catalog)).toEqual([]);
  });

  test("is refused when it no longer fits, so the check can fail", () => {
    const { plans: _plans, ...withoutPlans } = catalog;
    expect(contractProblems("PublicCatalog", withoutPlans)).not.toEqual([]);
    expect(contractProblems("PublicCatalog", { ...catalog, plans: [{ id: 7 }] })).not.toEqual([]);
  });
});
