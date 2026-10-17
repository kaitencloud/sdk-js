// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/**
 * Selects one of the plural forms supplied in `forms` based on `count` and an
 * optional locale, using `Intl.PluralRules`.
 *
 * `forms` is a partial map from PluralCategory → string. Supply at minimum
 * `one` and `other`; every missing category falls back to `other`.
 *
 * @example
 * // English
 * pluralize(1, { one: "1 period", other: "{n} periods" })  // "1 period"
 * pluralize(5, { one: "1 period", other: "{n} periods" })  // "5 periods"
 *
 * // Arabic (6 plural forms)
 * pluralize(11, { zero: "صفر", one: "واحد", two: "اثنان",
 *                 few: "قليل", many: "كثير", other: "آخر" }, "ar")
 */
export function pluralize(
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
  locale?: string | string[],
): string {
  let rule: Intl.LDMLPluralRule;

  try {
    rule = new Intl.PluralRules(locale).select(count);
  } catch {
    // Intl.PluralRules might not be available in very old environments.
    rule = count === 1 ? "one" : "other";
  }

  const template = forms[rule] ?? forms.other;
  // Replace {n} placeholder with the actual count (convenience shorthand).
  return template.replace(/\{n\}/g, String(count));
}
