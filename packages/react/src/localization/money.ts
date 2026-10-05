import type { CurrencyCode } from "@kaitencloud/client";

import type { KaitenMoneyFormatOptions } from "./types.ts";

/**
 * Fallback currency used when a plan/add-on/price omits `currencyCode`. Mirrors
 * the previous hard-coded `"$"` default, but as a real ISO-4217 code so the
 * Intl currency style applies. Hosts should set explicit codes on their data.
 */
export const DEFAULT_CURRENCY_CODE: CurrencyCode = "USD";

/**
 * Formats a money `amount` for display.
 *
 * `amount` is in the currency's **minor units** (integer): cents for USD/EUR,
 * whole yen for JPY, fils for BHD, etc. The correct minor-unit exponent is read
 * from `Intl.NumberFormat` for the given `currencyCode`, so the major-unit
 * conversion is currency-correct (USD ÷100, JPY ÷1, BHD ÷1000) rather than a
 * hard-coded ÷100.
 *
 * @example
 * formatKaitenMoney(7900, "EUR", { locale: "fr-FR" }) // "79,00 €"
 * formatKaitenMoney(7900, "USD", { locale: "en-US" }) // "$79.00"
 * formatKaitenMoney(7900, "JPY", { locale: "ja-JP" }) // "￥7,900"
 */
export function formatKaitenMoney(
  amount: number,
  currencyCode: CurrencyCode = DEFAULT_CURRENCY_CODE,
  options: KaitenMoneyFormatOptions = {},
): string {
  const { locale, ...formatOptions } = options;

  if (!Number.isFinite(amount)) {
    return formatKaitenMoney(0, currencyCode, options);
  }

  try {
    // The minor-unit exponent must come from a *clean* currency formatter so it
    // reflects the currency itself (2 for USD/EUR, 0 for JPY, 3 for BHD) and is
    // not skewed by caller display overrides like `maximumFractionDigits: 0`.
    const exponent =
      new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).resolvedOptions()
        .maximumFractionDigits ?? 2;

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
    const major = (amount / 100).toLocaleString(typeof locale === "string" ? locale : undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${currencyCode} ${major}`.trim();
  }
}
