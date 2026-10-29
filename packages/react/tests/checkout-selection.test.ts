// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { isPlausibleEmail } from "../src/hooks/billing/checkout-selection.ts";

describe("plausible checkout addresses", () => {
  test.each([
    "person@example.com",
    "  person+tag@example.co.uk  ",
    "!@!.!",
    "a@..b",
    "a@b..",
    "😀@example.com",
    `${"a".repeat(248)}@b.com`,
    `${"😀".repeat(248)}@b.com`,
  ])("accepts %s", (email) => {
    expect(isPlausibleEmail(email)).toBe(true);
  });

  test.each([
    "",
    "person",
    "@example.com",
    "person@",
    "person@example",
    "person@.com",
    "person@example.",
    "person@a.b@c.d",
    "person name@example.com",
    "person@example.\ncom",
    `${"a".repeat(249)}@b.com`,
    `${"😀".repeat(249)}@b.com`,
  ])("refuses %s", (email) => {
    expect(isPlausibleEmail(email)).toBe(false);
  });

  test("handles the repeated-dot input without backtracking or collecting an unbounded address", () => {
    const start = performance.now();
    expect(isPlausibleEmail(`!@!.${"!.".repeat(124)}!`)).toBe(true);
    expect(isPlausibleEmail(`!@!.${"!.".repeat(124)} `)).toBe(true);
    expect(isPlausibleEmail(`!@!.${"!.".repeat(123)} !`)).toBe(false);
    expect(isPlausibleEmail(`!@!.${"!.".repeat(123)}@`)).toBe(false);
    expect(isPlausibleEmail(`!@!.${"!.".repeat(1_000_000)} `)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
