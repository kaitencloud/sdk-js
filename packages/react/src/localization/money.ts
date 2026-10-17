// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { CurrencyCode } from "@kaitencloud/client";

import type { KaitenMoneyFormatOptions } from "./types.ts";

/**
 * Fallback currency used when a plan/add-on/price omits `currencyCode`. Mirrors
 * the previous hard-coded `"$"` default, but as a real ISO-4217 code so the
 * Intl currency style applies. Hosts should set explicit codes on their data.
 */
export const DEFAULT_CURRENCY_CODE: CurrencyCode = "USD";

/** A plain decimal, as `unitAmountDecimal` writes one: digits, and optionally a point and digits. */
const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Formats a money `amount` for display.
 *
 * `amount` is in the currency's **minor units**: cents for USD/EUR, whole yen
 * for JPY, fils for BHD, etc. The correct minor-unit exponent is read from
 * `Intl.NumberFormat` for the given `currencyCode`, so the major-unit
 * conversion is currency-correct (USD ÷100, JPY ÷1, BHD ÷1000) rather than a
 * hard-coded ÷100.
 *
 * An integer is a price in whole minor units. A string is an exact decimal
 * amount of minor units, such as the `unitAmountDecimal` of a price below one
 * of them (`"0.0002"` cents is `€0.000002`): `Intl` reads its digits, shifted by
 * the exponent, and none is dropped. A string that is not a plain decimal reads
 * as zero, as a non-finite number does.
 *
 * @example
 * formatKaitenMoney(7900, "EUR", { locale: "fr-FR" }) // "79,00 €"
 * formatKaitenMoney(7900, "USD", { locale: "en-US" }) // "$79.00"
 * formatKaitenMoney(7900, "JPY", { locale: "ja-JP" }) // "￥7,900"
 * formatKaitenMoney("0.0002", "EUR", { locale: "en-US" }) // "€0.000002"
 */
export function formatKaitenMoney(
  amount: number | string,
  currencyCode: CurrencyCode = DEFAULT_CURRENCY_CODE,
  options: KaitenMoneyFormatOptions = {},
): string {
  const { locale, ...formatOptions } = options;

  if (typeof amount === "number" ? !Number.isFinite(amount) : !DECIMAL.test(amount)) {
    return formatKaitenMoney(0, currencyCode, options);
  }

  try {
    // The minor-unit exponent must come from a *clean* currency formatter so it
    // reflects the currency itself (2 for USD/EUR, 0 for JPY, 3 for BHD) and is
    // not skewed by caller display overrides like `maximumFractionDigits: 0`.
    const exponent =
      new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).resolvedOptions()
        .maximumFractionDigits ?? 2;

    if (typeof amount === "string") {
      // With every digit the amount has, and at least the currency's own precision:
      // `Intl` keeps the currency's minimum, and the caller's fraction digits replace both.
      // The shift is the exponent of the string, which `Intl` reads exactly.
      const exact = new Intl.NumberFormat(locale, {
        maximumFractionDigits: 20,
        ...formatOptions,
        style: "currency",
        currency: currencyCode,
      });
      return exact.format(`${amount}e-${exponent}` as `${number}`);
    }

    const formatter = new Intl.NumberFormat(locale, {
      ...formatOptions,
      style: "currency",
      currency: currencyCode,
    });
    return formatter.format(amount / 10 ** exponent);
  } catch {
    // Invalid/unknown currency code (e.g. a bare symbol passed by a misconfigured
    // host). Fall back to a plain decimal so the UI never throws; assume the
    // common 2-digit minor unit since we can't resolve the real exponent.
    const major = (Number(amount) / 100).toLocaleString(
      typeof locale === "string" ? locale : undefined,
      { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    );
    return `${currencyCode} ${major}`.trim();
  }
}
