// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Plan, PlanPrice } from "@kaitencloud/client";
import { describe, expect, test } from "vite-plus/test";

import { cheapestFirst } from "../src/plan-order.ts";

function fee(amount: number, options: Partial<PlanPrice> = {}): PlanPrice {
  return { amount, currencyCode: "EUR", interval: "month", isDefault: true, ...options };
}

function plan(slug: string, pricingType: Plan["pricingType"], prices: PlanPrice[] = []): Plan {
  return { slug, name: slug[0]!.toUpperCase() + slug.slice(1), pricingType, prices };
}

const slugs = (plans: readonly Plan[]) => plans.map((each) => each.slug);

describe("cheapestFirst", () => {
  test("lists a catalogue read by family slug from the cheapest", () => {
    // What GET /public/catalog answers: premium, standard, starter.
    const catalogue = [
      plan("premium", "CUSTOM"),
      plan("standard", "PAID", [fee(4900), fee(49000, { interval: "year" })]),
      plan("starter", "FREE", [fee(0)]),
    ];
    expect(slugs(cheapestFirst(catalogue))).toEqual(["starter", "standard", "premium"]);
  });

  test("puts the free plans first and the plans priced on request last, whatever their fees", () => {
    const catalogue = [
      plan("enterprise", "CUSTOM", [fee(100)]),
      plan("pro", "PAID", [fee(4900)]),
      plan("community", "FREE"),
      plan("starter", "FREE", [fee(0)]),
    ];
    // Two free plans keep the catalogue's order between them.
    expect(slugs(cheapestFirst(catalogue))).toEqual(["community", "starter", "pro", "enterprise"]);
  });

  test("compares a yearly fee by its month", () => {
    const catalogue = [
      plan("monthly", "PAID", [fee(24900)]),
      plan("yearly", "PAID", [fee(270000, { interval: "year" })]),
    ];
    // 2,700 a year is 225 a month, under 249.
    expect(slugs(cheapestFirst(catalogue))).toEqual(["yearly", "monthly"]);
  });

  test("reads the default fees, and the others only when a plan has no default", () => {
    const catalogue = [
      plan("pro", "PAID", [fee(4900), fee(1000, { isDefault: false })]),
      plan("lite", "PAID", [fee(1900)]),
      plan("solo", "PAID", [fee(900, { isDefault: false })]),
    ];
    expect(slugs(cheapestFirst(catalogue))).toEqual(["solo", "lite", "pro"]);
  });

  test("never compares fees in two currencies", () => {
    const catalogue = [
      plan("pro", "PAID", [fee(4900)]),
      plan("japan", "PAID", [fee(980, { currencyCode: "JPY" })]),
      plan("lite", "PAID", [fee(1900)]),
      plan("kuwait", "PAID", [fee(12500, { currencyCode: "KWD" })]),
      plan("priceless", "PAID"),
    ];
    // Euros first, as the catalogue names them first; a plan without a fee after every priced one.
    expect(slugs(cheapestFirst(catalogue))).toEqual([
      "lite",
      "pro",
      "japan",
      "kuwait",
      "priceless",
    ]);
  });

  test("leaves the catalogue as it was", () => {
    const catalogue = [plan("standard", "PAID", [fee(4900)]), plan("starter", "FREE", [fee(0)])];
    cheapestFirst(catalogue);
    expect(slugs(catalogue)).toEqual(["standard", "starter"]);
  });
});
