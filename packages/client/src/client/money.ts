// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Money, read exactly.
//
// Every amount in this SDK is in a currency's minor units, as the API counts
// them. A price may be a fraction of one: `unitAmountDecimal: "0.0002"` is two
// ten-thousandths of a cent, the price of one call. A label wants the major
// unit instead (`0.000002` euros), and getting there through a floating-point
// number is how `0.07` cents turns into `0.0007000000000000001` euros. The move
// from minor to major units is a shift of the decimal point, so it is done on
// the digits of the string and never leaves it.

import type { CurrencyCode } from "./types.ts";

/**
 * The decimals of each currency's minor unit, as the API counts them: JPY 0,
 * EUR 2, KWD 3, CLF 4. It is the API's own table, not the locale data of the
 * runtime, which does not agree with it for every currency, and an amount in
 * minor units means what the API says it means. Codes are in rows of a line each,
 * joined with `+` and not `.join()`: a call at the top level cannot be shown to be
 * pure, and would keep this table in every bundle that imports the client.
 */
const CODES_BY_EXPONENT: Readonly<Record<number, string>> = {
  0: "BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF",
  2:
    "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BRL BSD BTN BWP BYN " +
    "BZD CAD CDF CHF CNY COP CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS " +
    "GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR " +
    "LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD " +
    "PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN " +
    "SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UYU UZS VES WST XCD YER ZAR ZMW ZWG",
  3: "BHD IQD JOD KWD LYD OMR TND",
  4: "CLF UYW",
};

// Built on first use, not when the module loads: a call at the top level cannot be
// shown to be pure, so a bundler would keep this table, and the code that builds
// it, in every host that imports `KaitenClient` and never converts a price.
let exponents: ReadonlyMap<string, number> | undefined;

const exponentOf = (code: string): number | undefined => {
  exponents ??= new Map(
    Object.entries(CODES_BY_EXPONENT).flatMap(([exponent, codes]) =>
      codes.split(" ").map((entry) => [entry, Number(exponent)] as const),
    ),
  );
  return exponents.get(code);
};

/** A decimal in plain notation: digits, a point, digits. No exponent, no grouping. */
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** `decimal` with its point moved `places` to the left, as a plain decimal. */
function shiftLeft(decimal: string, places: number): string | undefined {
  const match = DECIMAL.exec(decimal);
  if (!match) return undefined;

  const [, sign, whole = "", fraction = ""] = match;
  const digits = whole + fraction;
  const point = whole.length - places;
  const integer = point > 0 ? digits.slice(0, point) : "";
  const decimals = (point > 0 ? "" : "0".repeat(-point)) + digits.slice(Math.max(point, 0));

  const shown = integer.replace(/^0+(?=\d)/, "") || "0";
  let end = decimals.length;
  while (end > 0 && decimals[end - 1] === "0") end -= 1;
  const trimmed = decimals.slice(0, end);
  const magnitude = trimmed ? `${shown}.${trimmed}` : shown;
  return sign && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

/** What {@link majorUnitAmount} reads: a `PlanPrice`, a `BillingPrice`, or a part of either. */
export interface MinorUnitPrice {
  /** The exact amount in minor units, as a decimal string (`"4900"`, `"0.0002"`). */
  unitAmountDecimal?: string;
  /** The amount in minor units, when it is an integer. Read when there is no `unitAmountDecimal`. */
  amount?: number;
  currencyCode?: CurrencyCode;
}

/**
 * A price's amount in the currency's major units, as an exact decimal string:
 * `"0.000002"` euros for `unitAmountDecimal: "0.0002"`, `"2"` for `"200"`, `"12.5"`
 * Kuwaiti dinars for `"12500"`. It has no trailing zeros, and no more digits than
 * the amount has: round or pad it where it is shown.
 *
 * The result is the price of what the price is for. A usage or overage price is
 * per sale unit (`saleUnitFactor` measured units, "1M tokens"), and this does not
 * divide it down to one measured unit: the label is "€2.00 per 1M tokens", not a
 * fraction of a cent per token. A flat fee is per billing period. Never add
 * prices of different models together.
 *
 * Pass the string to `Intl.NumberFormat` as it is, which formats a decimal string
 * exactly, with room for the digits:
 *
 * ```ts
 * const amount = majorUnitAmount(price); // "0.000002"
 * new Intl.NumberFormat("en-US", {
 *   style: "currency",
 *   currency: price.currencyCode,
 *   maximumFractionDigits: 20,
 * }).format(amount as `${number}`); // "€0.000002", and "€2.00" for "2"
 * ```
 *
 * Returns `undefined` when the price has no amount, when the amount is not a plain
 * decimal (`"1e3"`, `"1,5"` and `"NaN"` are not), or when the currency is missing
 * or not one the API knows: an amount whose exponent is a guess is not shown.
 */
export function majorUnitAmount(price: MinorUnitPrice): string | undefined {
  const exponent = price.currencyCode === undefined ? undefined : exponentOf(price.currencyCode);
  if (exponent === undefined) return undefined;

  const decimal =
    price.unitAmountDecimal ??
    (Number.isSafeInteger(price.amount) ? String(price.amount) : undefined);
  return decimal === undefined ? undefined : shiftLeft(decimal, exponent);
}
