// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { mapPublicCatalog } from "../src/client/billing.ts";
import { majorUnitAmount } from "../src/index.ts";
import type { BillingPrice, KaitenApi, Plan } from "../src/index.ts";

const CATALOG = mapPublicCatalog(
  JSON.parse(
    readFileSync(new URL("./fixtures/public-catalog.acme.json", import.meta.url), "utf8"),
  ) as KaitenApi.PublicCatalog,
);

const price = (unitAmountDecimal: string, currencyCode: string) =>
  majorUnitAmount({ unitAmountDecimal, currencyCode });

describe("a price in major units, exactly", () => {
  test("long runs of zeros retain every significant digit without repeated suffix searches", () => {
    const zeros = "0".repeat(100_000);
    const start = performance.now();
    expect(price(`0.${zeros}1`, "JPY")).toBe(`0.${zeros}1`);
    expect(price(`-0.${zeros}1${zeros}`, "EUR")).toBe(`-0.00${zeros}1`);
    expect(price(`0.${zeros}`, "KWD")).toBe("0");
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  test.for([
    // [minor units, currency, major units]
    ["4900", "EUR", "49"],
    ["0.0002", "EUR", "0.000002"],
    ["200", "EUR", "2"],
    ["12500", "KWD", "12.5"],
    ["980", "JPY", "980"],
    ["10000", "CLF", "1"],
    ["1", "CLF", "0.0001"],
    ["5", "USD", "0.05"],
    ["0.5", "EUR", "0.005"],
    ["0", "EUR", "0"],
    ["0.00", "EUR", "0"],
    ["0", "JPY", "0"],
    ["1", "JPY", "1"],
    ["2900.50", "EUR", "29.005"],
    ["980.5", "JPY", "980.5"],
    // Leading zeros are not digits of the amount.
    ["007", "EUR", "0.07"],
    ["000", "KWD", "0"],
    // The API's limit is 12 integer digits and 12 decimals: all of them survive.
    ["999999999999.999999999999", "EUR", "9999999999.99999999999999"],
    ["0.000000000001", "JPY", "0.000000000001"],
    // A float cannot hold these: 2^53 + 1, and a sum that drifts.
    ["9007199254740993", "EUR", "90071992547409.93"],
    ["0.07", "EUR", "0.0007"],
    ["-250", "EUR", "-2.5"],
    ["-0", "EUR", "0"],
  ] as const)("%s %s is %s", ([minor, currency, major]) => {
    expect(price(minor, currency)).toBe(major);
  });

  test("0.0002 cents a call is 0.000002 euros a call, and 200 cents per 1M tokens is 2 euros", () => {
    const usage = (slug: string) =>
      plan("pro").billingPrices!.find((entry) => entry.meteredEntitlementSlug === slug)!;

    expect(usage("tokens")).toMatchObject({ unitAmountDecimal: "200", saleUnitFactor: 1_000_000 });
    expect(majorUnitAmount(usage("tokens"))).toBe("2");
    expect(usage("api-calls")).toMatchObject({ unitAmountDecimal: "0.0002", saleUnitFactor: 1 });
    expect(majorUnitAmount(usage("api-calls"))).toBe("0.000002");
  });

  test("the string formats exactly, with the currency's own digits and room for more", () => {
    const label = (amount: string, currency: string, locale = "en-US") =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 20,
      }).format(amount as `${number}`);

    expect(label(price("200", "EUR")!, "EUR")).toBe("€2.00");
    expect(label(price("0.0002", "EUR")!, "EUR")).toBe("€0.000002");
    expect(label(price("4900", "EUR")!, "EUR", "fr-FR")).toMatch(/^49,00\s€$/);
    expect(label(price("12500", "KWD")!, "KWD")).toBe("KWD\u00a012.500");
    expect(label(price("980", "JPY")!, "JPY")).toBe("¥980");
  });

  test("it reads the amount of a 1.0 price, which has no decimal string", () => {
    expect(majorUnitAmount({ amount: 4900, currencyCode: "EUR" })).toBe("49");
    expect(majorUnitAmount({ amount: 12500, currencyCode: "KWD" })).toBe("12.5");
    // The decimal string wins when both are there: it is the exact one.
    expect(majorUnitAmount({ amount: 0, unitAmountDecimal: "0.0002", currencyCode: "EUR" })).toBe(
      "0.000002",
    );
  });

  test.for([
    ["no currency", { unitAmountDecimal: "100" }],
    ["a currency the API does not know", { unitAmountDecimal: "100", currencyCode: "XXX" }],
    ["a currency in lower case", { unitAmountDecimal: "100", currencyCode: "eur" }],
    ["a symbol for a currency", { unitAmountDecimal: "100", currencyCode: "€" }],
    ["no amount", { currencyCode: "EUR" }],
    ["a fractional amount", { amount: 0.5, currencyCode: "EUR" }],
    ["an amount that is not safe", { amount: 2 ** 53, currencyCode: "EUR" }],
    ["NaN", { amount: Number.NaN, currencyCode: "EUR" }],
    ["an empty decimal", { unitAmountDecimal: "", currencyCode: "EUR" }],
    ["an exponent", { unitAmountDecimal: "1e3", currencyCode: "EUR" }],
    ["a decimal comma", { unitAmountDecimal: "1,5", currencyCode: "EUR" }],
    ["a grouping comma", { unitAmountDecimal: "1,000", currencyCode: "EUR" }],
    ["a space", { unitAmountDecimal: " 12", currencyCode: "EUR" }],
    ["a plus sign", { unitAmountDecimal: "+12", currencyCode: "EUR" }],
    ["a bare point", { unitAmountDecimal: ".5", currencyCode: "EUR" }],
    ["a trailing point", { unitAmountDecimal: "5.", currencyCode: "EUR" }],
    ["NaN as text", { unitAmountDecimal: "NaN", currencyCode: "EUR" }],
    ["Infinity as text", { unitAmountDecimal: "Infinity", currencyCode: "EUR" }],
  ] as const)("%s has no major-unit amount", ([, input]) => {
    expect(majorUnitAmount(input)).toBeUndefined();
  });

  // The decimal point moves; no digit is created, lost or changed. Shifted back,
  // the result is the amount, for amounts beyond what a float holds exactly.
  test("property: shifting the result back gives the amount, digit for digit", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    const exponents = { EUR: 2, JPY: 0, KWD: 3, CLF: 4 } as const;
    const codes = Object.keys(exponents) as (keyof typeof exponents)[];

    for (let index = 0; index < 10_000; index += 1) {
      const code = codes[next() % codes.length]!;
      const digits = 1 + (next() % 22);
      const minor = Array.from({ length: digits }, () => String(next() % 10))
        .join("")
        .replace(/^0+(?=\d)/, "");
      const major = price(minor, code)!;
      const [whole = "", fraction = ""] = major.split(".");

      expect(BigInt(whole + fraction.padEnd(exponents[code], "0"))).toBe(BigInt(minor));
      expect(fraction.length).toBeLessThanOrEqual(exponents[code]);
      expect(fraction.endsWith("0")).toBe(false);
      expect(whole === "0" || !whole.startsWith("0")).toBe(true);
    }
  });
});

function plan(family: string): Plan {
  const found = CATALOG.plans.find((entry) => entry.familyId === family);
  if (!found) throw new Error(`no ${family} plan in the fixture`);
  return found;
}

describe("the headline never carries a usage price", () => {
  test("a plan's price is its default flat fee, whatever it also charges per unit", () => {
    const pro = plan("pro");
    const metered = pro.billingPrices!.filter(
      (entry: BillingPrice) => entry.billingModel !== "FLAT_FEE",
    );

    expect(metered.length).toBeGreaterThan(0);
    expect(pro.price).toBe(4900);
    expect(pro.annualPrice).toBe(49000);
    // Every price the 1.0 lists hold is a flat fee: no usage price is among them,
    // so nothing a 1.0 reader adds up can include one.
    expect(pro.prices?.every((entry) => entry.billingModel === "FLAT_FEE")).toBe(true);
    expect(pro.prices?.some((entry) => metered.some((usage) => usage.id === entry.id))).toBe(false);
    // And a plan with usage prices has more than one price to quote, not a total.
    expect(metered.map((entry) => majorUnitAmount(entry))).toEqual(["2", "0.000002"]);
  });
});
