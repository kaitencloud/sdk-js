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

// The three exponents a catalogue can carry: EUR counts hundredths, JPY has no minor
// unit and KWD counts thousandths. A price is an integer of minor units, so what is
// shown has to give the same integer back, whatever the currency.

test("formats the fixed cases of each exponent, as Intl writes them", () => {
  const cases: [number, string, string, string][] = [
    [4900, "EUR", "en-US", "€49.00"],
    [4900, "EUR", "fr-FR", "49,00 €"],
    [980, "JPY", "en-US", "¥980"],
    [12500, "KWD", "en-US", "KWD 12.500"],
    [3000, "USD", "en-US", "$30.00"],
    [0, "EUR", "en-US", "€0.00"],
  ];

  for (const [amount, currency, locale, expected] of cases) {
    expect(formatKaitenMoney(amount, currency, { locale })).toBe(expected);
  }
});

test("shows the three decimals of a Kuwaiti dinar, never two", () => {
  expect(formatKaitenMoney(1, "KWD", { locale: "en-US" })).toBe("KWD 0.001");
  expect(formatKaitenMoney(999, "KWD", { locale: "en-US" })).toBe("KWD 0.999");
  expect(formatKaitenMoney(1000, "KWD", { locale: "en-US" })).toBe("KWD 1.000");
  expect(formatKaitenMoney(12_345_678, "KWD", { locale: "en-US" })).toBe("KWD 12,345.678");
});

// A seeded generator, so a failure replays: the property is about the arithmetic, not
// about luck.
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * The minor units a formatted amount stands for: its digits, with the grouping and
 * the symbol taken out, read as a decimal and shifted by the currency's exponent,
 * all on strings and BigInt. A float would hide the drift the property looks for.
 */
function minorUnitsOf(shown: string, decimalSeparator: string, exponent: number): bigint {
  const digits = shown.replace(new RegExp(`[^0-9${decimalSeparator}]`, "g"), "");
  const [whole = "", fraction = ""] = digits.split(decimalSeparator);
  expect(fraction.length).toBeLessThanOrEqual(exponent);
  return BigInt(whole + fraction.padEnd(exponent, "0"));
}

const EXPONENTS = [
  ["EUR", 2],
  ["JPY", 0],
  ["KWD", 3],
] as const;

test.each(EXPONENTS)(
  "%s: 10,000 random amounts up to 10^12 give the same minor units back",
  (currency, exponent) => {
    const next = generator(0x4b41_4954 + exponent);
    const amounts = [0, 1, 10 ** exponent, 10 ** 12];
    while (amounts.length < 10_000) amounts.push(Math.floor(next() * 10 ** 12));

    for (const amount of amounts) {
      const english = formatKaitenMoney(amount, currency, { locale: "en-US" });
      expect(minorUnitsOf(english, ".", exponent), `${amount} shown as ${english}`).toBe(
        BigInt(amount),
      );
      const french = formatKaitenMoney(amount, currency, { locale: "fr-FR" });
      expect(minorUnitsOf(french, ",", exponent), `${amount} shown as ${french}`).toBe(
        BigInt(amount),
      );
    }
  },
);
