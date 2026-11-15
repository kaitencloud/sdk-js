// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "vite-plus/test";

import { withInstanceSlug } from "../src/hooks/flag-context.ts";

test("adds the instance to the kaiten namespace and keeps the rest of the host's context", () => {
  expect(withInstanceSlug({ plan: "pro", kaiten: { team: "fe" } }, "prod")).toEqual({
    plan: "pro",
    kaiten: { team: "fe", instanceSlug: "prod" },
  });
  expect(withInstanceSlug({ plan: "pro" }, "prod")).toEqual({
    plan: "pro",
    kaiten: { instanceSlug: "prod" },
  });
});

test("never overwrites what the host wrote", () => {
  const own = { kaiten: { instanceSlug: "mine" } };
  expect(withInstanceSlug(own, "prod")).toBe(own);
  const odd = { kaiten: "not a namespace" };
  expect(withInstanceSlug(odd, "prod")).toBe(odd);
  const list = { kaiten: ["x"] };
  expect(withInstanceSlug(list, "prod")).toBe(list);
});

test("adds nothing without an instance", () => {
  const context = { plan: "pro" };
  expect(withInstanceSlug(context, null)).toBe(context);
  expect(withInstanceSlug(context, "")).toBe(context);
});
