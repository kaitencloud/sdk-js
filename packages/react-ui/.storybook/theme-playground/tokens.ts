// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { resolveVariables } from "../../src/appearance/apply.ts";
import type { KaitenAppearance } from "../../src/appearance/types.ts";

export type VariableKey = keyof NonNullable<KaitenAppearance["variables"]>;

export type VariableKind = "color" | "length" | "font";

export interface VariableEntry {
  key: VariableKey;
  label: string;
  kind: VariableKind;
}

export interface VariableGroup {
  title: string;
  blurb: string;
  entries: VariableEntry[];
}

/**
 * Every key in `appearance.variables`, grouped the way someone theming thinks about
 * them rather than the order the interface declares them.
 *
 * `elements` is deliberately absent, and that is the scoping decision this editor is
 * built on. Those slots take *class names* that have to exist in the host's own CSS
 * build; a generator has no way to know what that build contains, so anything it
 * emitted there would be a string that silently does nothing at runtime. tweakcn draws
 * the same line for the same reason — CSS variables are portable, class names are not.
 * `icons` is out for the same reason one step further: it takes React components.
 */
export const VARIABLE_GROUPS: VariableGroup[] = [
  {
    title: "Brand",
    blurb: "The primary fill and the text that sits on it. Most themes only need this one.",
    entries: [
      { key: "colorPrimary", label: "Primary", kind: "color" },
      { key: "colorPrimaryForeground", label: "Primary foreground", kind: "color" },
      { key: "colorPrimaryHover", label: "Primary hover", kind: "color" },
    ],
  },
  {
    title: "Surfaces",
    blurb: "Page, card and popover backgrounds with their text colours.",
    entries: [
      { key: "colorBackground", label: "Background", kind: "color" },
      { key: "colorForeground", label: "Foreground", kind: "color" },
      { key: "colorCard", label: "Card", kind: "color" },
      { key: "colorCardForeground", label: "Card foreground", kind: "color" },
      { key: "colorPopover", label: "Popover", kind: "color" },
      { key: "colorPopoverForeground", label: "Popover foreground", kind: "color" },
    ],
  },
  {
    title: "Secondary and accent",
    blurb: "Quieter fills: secondary buttons, hovers, muted captions.",
    entries: [
      { key: "colorSecondary", label: "Secondary", kind: "color" },
      { key: "colorSecondaryForeground", label: "Secondary foreground", kind: "color" },
      { key: "colorSecondaryHover", label: "Secondary hover", kind: "color" },
      { key: "colorAccent", label: "Accent", kind: "color" },
      { key: "colorAccentForeground", label: "Accent foreground", kind: "color" },
      { key: "colorAccentHover", label: "Accent hover", kind: "color" },
      { key: "colorMuted", label: "Muted", kind: "color" },
      { key: "colorMutedForeground", label: "Muted foreground", kind: "color" },
    ],
  },
  {
    title: "Feedback",
    blurb: "Destructive and success states, including the tinted inline error panel.",
    entries: [
      { key: "colorDestructive", label: "Destructive", kind: "color" },
      { key: "colorDestructiveForeground", label: "Destructive foreground", kind: "color" },
      { key: "colorDestructiveHover", label: "Destructive hover", kind: "color" },
      { key: "colorDestructiveSubtle", label: "Destructive subtle", kind: "color" },
      {
        key: "colorDestructiveSubtleForeground",
        label: "Destructive subtle foreground",
        kind: "color",
      },
      { key: "colorSuccess", label: "Success", kind: "color" },
      { key: "colorSuccessForeground", label: "Success foreground", kind: "color" },
      { key: "colorSuccessHover", label: "Success hover", kind: "color" },
    ],
  },
  {
    title: "Borders and focus",
    blurb: "Field borders, dividers and the focus ring.",
    entries: [
      { key: "colorBorder", label: "Border", kind: "color" },
      { key: "colorInput", label: "Input", kind: "color" },
      { key: "colorRing", label: "Ring", kind: "color" },
    ],
  },
  {
    title: "Shape and type",
    blurb: "Corner radius and the font stack. Any CSS length / font-family value.",
    entries: [
      { key: "borderRadius", label: "Border radius", kind: "length" },
      { key: "fontFamily", label: "Font family", kind: "font" },
    ],
  },
];

export const ALL_KEYS: VariableKey[] = VARIABLE_GROUPS.flatMap((group) =>
  group.entries.map((entry) => entry.key),
);

export const ENTRY_OF: Record<VariableKey, VariableEntry> = Object.fromEntries(
  VARIABLE_GROUPS.flatMap((group) => group.entries).map((entry) => [entry.key, entry]),
) as Record<VariableKey, VariableEntry>;

type StyleOverrides = Record<string, string>;

function overridesFor(variables: Partial<Record<VariableKey, string>>): StyleOverrides {
  return resolveVariables(variables) as StyleOverrides;
}

/**
 * A value that is not a colour, so `apply.ts` cannot parse it and derives nothing from
 * it — leaving exactly one custom property set: the one belonging to the key.
 */
const NAME_PROBE = "kaiten-playground-probe";

/** A parseable fill, so the derivation path *does* run and reveals the pairs. */
const FILL_PROBE = "#3b5bdb";

/**
 * `colorPrimary` → `--ktn-primary`, learned by asking `resolveVariables` rather
 * than restating its table here.
 *
 * The mapping already exists in `apply.ts` and is not exported. Copying it would make
 * this the second place a token name lives, and `themes.ts` documents what happens when
 * a value gets a second home: its `default` preset drifted from the real tokens and
 * shipped a broken contrast ratio. A probe cannot drift.
 */
export const CSS_VAR_OF: Record<VariableKey, string> = Object.fromEntries(
  ALL_KEYS.map((key) => {
    const entries = Object.entries(overridesFor({ [key]: NAME_PROBE }));
    const found = entries.find(([, value]) => value === NAME_PROBE)?.[0];
    if (!found) throw new Error(`no --ktn-* custom property is bound to "${key}"`);
    return [key, found];
  }),
) as Record<VariableKey, string>;

const KEY_OF_CSS_VAR: Record<string, VariableKey> = Object.fromEntries(
  ALL_KEYS.map((key) => [CSS_VAR_OF[key], key]),
);

/**
 * The pair keys `apply.ts` fills in for you, mapped back to the fill they come from —
 * `colorPrimaryForeground` → `colorPrimary`.
 *
 * Setting a fill and leaving its foreground and hover alone is the *supported* way to
 * theme: the foreground is chosen for contrast against the fill, and the hover is
 * shifted away from that foreground so the pair keeps its ratio. So the editor shows
 * these as filled-in-for-you rather than empty, and — the part that matters — keeps
 * them out of the generated config. Emitting a derived value would freeze today's
 * derivation into the host's source and silently stop tracking the fill.
 */
export const DERIVED_FROM: Partial<Record<VariableKey, VariableKey>> = Object.fromEntries(
  ALL_KEYS.flatMap((fill) => {
    const own = CSS_VAR_OF[fill];
    return Object.keys(overridesFor({ [fill]: FILL_PROBE }))
      .filter((cssVar) => cssVar !== own)
      .map((cssVar) => [KEY_OF_CSS_VAR[cssVar]!, fill]);
  }),
);

/**
 * The value `apply.ts` would derive for `key` given the current draft, if any.
 *
 * Read from the produced overrides rather than through `DERIVED_FROM`: chains
 * exist now — `colorCardForeground` derives from a `colorCard` that is itself
 * derived from `colorBackground` — and the one-hop table can't see them, which
 * showed a black card-foreground swatch over a card rendered with white text.
 */
export function derivedValueFor(
  variables: Partial<Record<VariableKey, string>>,
  key: VariableKey,
): string | undefined {
  if (variables[key] !== undefined) return undefined;
  return overridesFor(variables)[CSS_VAR_OF[key]];
}
