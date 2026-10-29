// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { changePlanTarget, salesPath, SALES_PATH } from "../src/change-plan.ts";

const ORIGIN = "https://storefront.test";

const plans = [
  { slug: "starter-v1", pricingType: "FREE", selfServeCtaUrl: null },
  { slug: "pro-v2", pricingType: "PAID", selfServeCtaUrl: `${ORIGIN}/sales?plan=pro-v2` },
  {
    slug: "growth-v1",
    pricingType: "PAID",
    selfServeCtaUrl: "https://partner.example/talk?x=1#top",
  },
  { slug: "lite-v1", pricingType: "PAID", selfServeCtaUrl: null },
  { slug: "odd-v1", pricingType: "PAID", selfServeCtaUrl: "javascript:alert(1)" },
  { slug: "broken-v1", pricingType: "PAID", selfServeCtaUrl: "not an address" },
];

describe("where Change plan goes", () => {
  test("to the address of the plan the customer is on, followed in the app when it is the storefront's own", () => {
    expect(changePlanTarget(plans, "pro-v2", ORIGIN)).toEqual({
      kind: "page",
      to: "/sales?plan=pro-v2",
    });
  });

  test("to another site, opened as a site of its own, when the address is not the storefront's", () => {
    expect(changePlanTarget(plans, "growth-v1", ORIGIN)).toEqual({
      kind: "external",
      href: "https://partner.example/talk?x=1#top",
    });
  });

  test("to the pricing table from a free plan, which a checkout replaces", () => {
    expect(changePlanTarget(plans, "starter-v1", ORIGIN)).toEqual({ kind: "page", to: "/" });
  });

  test("to the sales page, with the plan, when a paid plan has no address", () => {
    expect(changePlanTarget(plans, "lite-v1", ORIGIN)).toEqual({
      kind: "page",
      to: salesPath("lite-v1"),
    });
  });

  test("never to an address that is not http(s), or not an address", () => {
    expect(changePlanTarget(plans, "odd-v1", ORIGIN)).toEqual({
      kind: "page",
      to: "/sales?plan=odd-v1",
    });
    expect(changePlanTarget(plans, "broken-v1", ORIGIN)).toEqual({
      kind: "page",
      to: "/sales?plan=broken-v1",
    });
  });

  test("to the sales page when the plan is not known yet", () => {
    expect(changePlanTarget(undefined, undefined, ORIGIN)).toEqual({
      kind: "page",
      to: SALES_PATH,
    });
    expect(changePlanTarget(plans, "nope-v1", ORIGIN)).toEqual({
      kind: "page",
      to: "/sales?plan=nope-v1",
    });
  });
});
