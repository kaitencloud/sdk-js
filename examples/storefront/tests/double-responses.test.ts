// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { money } from "../server/double/responses.ts";

describe("the stand-in's label of an amount in minor units", () => {
  test("has a decimal for each digit of the currency's minor unit", () => {
    expect(money(4900, "EUR")).toBe("49.00 EUR");
    expect(money(4950, "EUR")).toBe("49.50 EUR");
    expect(money(0, "EUR")).toBe("0.00 EUR");
    expect(money(4900, "JPY")).toBe("4900 JPY");
    expect(money(12500, "KWD")).toBe("12.500 KWD");
    expect(money(-4950, "EUR")).toBe("-49.50 EUR");
  });

  test("counts the minor units as the API does, where the runtime's locale data counts fewer", () => {
    expect(money(4900, "HUF")).toBe("49.00 HUF");
    expect(money(150000, "IDR")).toBe("1500.00 IDR");
    expect(money(12500, "IQD")).toBe("12.500 IQD");
  });

  test("stays in minor units for a currency the API does not know", () => {
    expect(money(4900, "SLL")).toBe("4900 minor units of SLL");
  });
});
