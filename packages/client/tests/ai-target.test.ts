// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, it } from "vite-plus/test";
import type { AiTarget } from "../src/ai/module.ts";

it("uses the Entitlement resource name for the high-level AI selector", () => {
  const target: AiTarget = { instance: "acme", entitlement: "credits" };
  expect(target.entitlement).toBe("credits");
  // @ts-expect-error The unreleased pool selector was replaced, not retained as an alias.
  const legacy: AiTarget = { instance: "acme", pool: "credits" };
  expect(legacy).not.toHaveProperty("entitlement");
});
