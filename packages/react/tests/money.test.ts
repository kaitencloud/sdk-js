import { expect, test } from "vite-plus/test";

import { DEFAULT_CURRENCY_CODE, formatKaitenMoney } from "../src/index.ts";

// Note: `amount` is always in the currency's MINOR units (integer). The whole
// point of this test is that the minor-unit exponent is currency-correct, not a
// hard-coded ÷100.

test("formats USD minor units with the en-US currency style", () => {
  expect(formatKaitenMoney(7900, "USD", { locale: "en-US" })).toBe("$79.00");
});

test("formats EUR minor units with French grouping and symbol placement", () => {
  const out = formatKaitenMoney(7900, "EUR", { locale: "fr-FR" });
  // Number formatting is locale-specific (comma decimal, trailing €); assert on
  // the stable parts rather than the exact (non-breaking) spacing.
  expect(out).toContain("79,00");
  expect(out).toContain("€");
});

test("uses the currency's real minor-unit exponent — JPY has none (÷1, not ÷100)", () => {
  const out = formatKaitenMoney(7900, "JPY", { locale: "ja-JP" });
  expect(out).toContain("7,900");
  // No fractional part for a zero-exponent currency.
  expect(out).not.toContain(".00");
  expect(out).not.toContain("79.00");
});

test("uses a 3-digit exponent for BHD (÷1000)", () => {
  expect(formatKaitenMoney(1234, "BHD", { locale: "en-US" })).toContain("1.234");
});

test("applies digit grouping to large amounts", () => {
  expect(formatKaitenMoney(100000000, "USD", { locale: "en-US" })).toBe("$1,000,000.00");
});

test("defaults to USD when no currency code is supplied", () => {
  expect(formatKaitenMoney(7900, undefined, { locale: "en-US" })).toBe("$79.00");
  expect(DEFAULT_CURRENCY_CODE).toBe("USD");
});

test("never throws on an invalid currency code — falls back to a plain decimal", () => {
  // A bare symbol is not a valid ISO-4217 code: Intl would throw, so we degrade.
  const out = formatKaitenMoney(7900, "$", { locale: "en-US" });
  expect(out).toContain("79.00");
  expect(out).not.toContain("NaN");
});

test("treats non-finite amounts as zero rather than rendering NaN", () => {
  expect(formatKaitenMoney(Number.NaN, "USD", { locale: "en-US" })).toBe("$0.00");
  expect(formatKaitenMoney(Number.POSITIVE_INFINITY, "USD", { locale: "en-US" })).toBe("$0.00");
});

test("respects caller fraction-digit overrides", () => {
  // Hosts can hide cents by forcing 0 fraction digits.
  const out = formatKaitenMoney(7900, "USD", {
    locale: "en-US",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  expect(out).toBe("$79");
});
