// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { KaitenAppearance } from "../../src/appearance/types.ts";
import { ALL_KEYS, DERIVED_FROM, type VariableKey } from "./tokens.ts";

export type VariableScope = "both" | "light" | "dark";

/** The scopes a value can live in, in the order the editor writes and reads them. */
export const VARIABLE_SCOPES: VariableScope[] = ["both", "light", "dark"];

export interface AppearanceDraft {
  baseTheme: NonNullable<KaitenAppearance["baseTheme"]>;
  /** What holds in either mode. */
  variables: Partial<Record<VariableKey, string>>;
  /** What does not — layered over `variables`, for that mode only. */
  modes: {
    light: Partial<Record<VariableKey, string>>;
    dark: Partial<Record<VariableKey, string>>;
  };
}

/** Omitting `baseTheme` means "follow the host page", so emitting it is a choice. */
const DEFAULT_BASE_THEME = "light";

export const EMPTY_DRAFT: AppearanceDraft = {
  baseTheme: DEFAULT_BASE_THEME,
  variables: {},
  modes: { light: {}, dark: {} },
};

/** The bucket a scope writes to. `both` is `variables`; the rest is per mode. */
export function bucketOf(
  draft: AppearanceDraft,
  scope: VariableScope,
): Partial<Record<VariableKey, string>> {
  return scope === "both" ? draft.variables : draft.modes[scope];
}

/**
 * What a key resolves to in one mode, and where that value came from.
 *
 * A per-mode value wins over the mode-independent one, so the editor has to
 * show which bucket it is actually editing — otherwise typing into `light`
 * while a `both` value exists looks like it did nothing.
 */
export function effectiveEntry(
  draft: AppearanceDraft,
  key: VariableKey,
  mode: "light" | "dark",
): { value: string | undefined; scope: VariableScope } {
  const perMode = draft.modes[mode][key];
  if (perMode !== undefined) return { value: perMode, scope: mode };
  return { value: draft.variables[key], scope: "both" };
}

/**
 * A draft holds only what was deliberately set, so "what changed" is just "what is in
 * the draft" — there is no defaults-to-diff step and no way to accidentally emit
 * twenty-eight keys of values the SDK already ships.
 *
 * This is why the editor never seeds the draft with resolved defaults: an unset swatch
 * reads its display colour from the live preview's computed style instead. Seeding
 * would make every field look identical but turn the export into a wall of restated
 * defaults, which is exactly the config that rots the first time the SDK's own tokens
 * move.
 */
export function isDirty(draft: AppearanceDraft): boolean {
  return (
    draft.baseTheme !== DEFAULT_BASE_THEME ||
    Object.keys(draft.variables).length > 0 ||
    Object.keys(draft.modes.light).length > 0 ||
    Object.keys(draft.modes.dark).length > 0
  );
}

/** Keys set in one bucket, in catalogue order for a stable diff. */
export function changedKeys(variables: Partial<Record<VariableKey, string>>): VariableKey[] {
  return ALL_KEYS.filter((key) => variables[key] !== undefined);
}

/**
 * Fills that were set without their pair, so the config's reader can see which values
 * the SDK is filling in — the one thing a bare object literal cannot show on its own.
 */
export function derivedPairs(
  draft: AppearanceDraft,
): Array<{ pair: VariableKey; fill: VariableKey }> {
  // Across buckets: a fill in `variables` derives a pair the `dark` bucket does
  // not override either, so the flattened view is what tells the truth.
  const flattened = { ...draft.variables, ...draft.modes.light, ...draft.modes.dark };

  return ALL_KEYS.flatMap((pair) => {
    const fill = DERIVED_FROM[pair];
    if (!fill) return [];
    if (flattened[pair] !== undefined) return [];
    if (flattened[fill] === undefined) return [];
    return [{ pair, fill }];
  });
}

/** Paste-ready TypeScript for the current draft, and nothing beyond it. */
export function toAppearanceSource(draft: AppearanceDraft): string {
  const keys = changedKeys(draft.variables);
  const lightKeys = changedKeys(draft.modes.light);
  const darkKeys = changedKeys(draft.modes.dark);
  const emitsBaseTheme = draft.baseTheme !== DEFAULT_BASE_THEME;

  if (keys.length === 0 && lightKeys.length === 0 && darkKeys.length === 0 && !emitsBaseTheme) {
    return [
      "// Nothing overridden yet — the SDK's own tokens are in force.",
      "// Change a swatch (or load a preset) and this becomes a paste-ready config.",
      "",
      'import type { KaitenAppearance } from "@kaitencloud/react";',
      "",
      "export const appearance: KaitenAppearance = {};",
      "",
    ].join("\n");
  }

  const lines: string[] = [];
  for (const { pair, fill } of derivedPairs(draft)) {
    lines.push(`// ${pair} is derived from ${fill} — leave it out to keep it in step.`);
  }
  lines.push('import type { KaitenAppearance } from "@kaitencloud/react";', "");
  lines.push("export const appearance: KaitenAppearance = {");
  if (emitsBaseTheme) {
    lines.push(`  baseTheme: ${JSON.stringify(draft.baseTheme)},`);
  }
  if (keys.length > 0) {
    lines.push("  variables: {");
    for (const key of keys) {
      lines.push(`    ${key}: ${JSON.stringify(draft.variables[key])},`);
    }
    lines.push("  },");
  }
  if (lightKeys.length > 0 || darkKeys.length > 0) {
    lines.push("  modes: {");
    for (const [mode, modeKeys] of [
      ["light", lightKeys],
      ["dark", darkKeys],
    ] as const) {
      if (modeKeys.length === 0) continue;
      lines.push(`    ${mode}: {`);
      for (const key of modeKeys) {
        lines.push(`      ${key}: ${JSON.stringify(draft.modes[mode][key])},`);
      }
      lines.push("    },");
    }
    lines.push("  },");
  }
  lines.push("};", "");

  return lines.join("\n");
}
