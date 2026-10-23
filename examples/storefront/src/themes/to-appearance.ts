// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The one place a shadcn theme becomes the components' `KaitenAppearance`. Small, pure and
// unit-tested (`tests/themes.test.ts`) because it is the piece the Kaiten console would feed with a
// vendor's tweakcn theme.
//
// What it maps, and what it leaves:
//
// - Every shadcn colour that has a `KaitenVariables` key goes to `modes.light` / `modes.dark`, and
//   every foreground is passed on explicitly: the SDK derives a missing one only from a hex fill,
//   and a theme made in a console may well be in oklch.
// - Hover fills have no shadcn token. They are derived here (`hoverFor` of `color.ts`), so that they do not
//   fall back to the SDK's purple, which is what an unparseable fill would get.
// - The radius and the sans font are what holds in both modes, so they go to `variables`.
// - Shadows, the mono and serif fonts, tracking, spacing, charts and the sidebar have no key in
//   `KaitenVariables`, so they are not mapped. The page's CSS (`page-css.ts`) and the classes of
//   `elements` below carry what the storefront needs of them.
// - The colour a refusal is written in has no shadcn token either. The components set it on the
//   background of the page and of a card, which a theme chooses, so it is checked against both here
//   (`refusalText`) and moved only when the components' own colour does not read on them.

import type { KaitenAppearance, KaitenVariables } from "@kaitencloud/react-ui";

import { hoverFor, legible, parseHex } from "./color.ts";
import type { ShadcnToken, ShadcnTheme, ShadcnTokens } from "./shadcn.ts";

/** What the mapper hands to `<KaitenStyleRoot appearance>`, next to `baseTheme`. */
export interface ThemedAppearance {
  variables: KaitenVariables;
  modes: { light: KaitenVariables; dark: KaitenVariables };
  elements: NonNullable<KaitenAppearance["elements"]>;
}

type ColourKey = Exclude<keyof KaitenVariables, "borderRadius" | "fontFamily">;

/** shadcn colour token, and the `KaitenVariables` key that takes it. */
const COLOURS: ReadonlyArray<readonly [ShadcnToken, ColourKey]> = [
  ["background", "colorBackground"],
  ["foreground", "colorForeground"],
  ["card", "colorCard"],
  ["card-foreground", "colorCardForeground"],
  ["popover", "colorPopover"],
  ["popover-foreground", "colorPopoverForeground"],
  ["primary", "colorPrimary"],
  ["primary-foreground", "colorPrimaryForeground"],
  ["secondary", "colorSecondary"],
  ["secondary-foreground", "colorSecondaryForeground"],
  ["muted", "colorMuted"],
  ["muted-foreground", "colorMutedForeground"],
  ["accent", "colorAccent"],
  ["accent-foreground", "colorAccentForeground"],
  ["destructive", "colorDestructive"],
  ["destructive-foreground", "colorDestructiveForeground"],
  ["border", "colorBorder"],
  ["input", "colorInput"],
  ["ring", "colorRing"],
];

/** The fills that have a hover, with the label that sits on each. */
const HOVERS: ReadonlyArray<readonly [ShadcnToken, ShadcnToken, ColourKey]> = [
  ["primary", "primary-foreground", "colorPrimaryHover"],
  ["secondary", "secondary-foreground", "colorSecondaryHover"],
  ["accent", "accent-foreground", "colorAccentHover"],
  ["destructive", "destructive-foreground", "colorDestructiveHover"],
];

/**
 * The colour the components write a refusal in when the theme says nothing, per mode: the value of
 * `--ktn-destructive-subtle-foreground` in the components' own stylesheet (the theme package's
 * token). It is repeated here to be measured against the theme's surfaces, and it is not set unless
 * it has to move.
 */
const REFUSAL_TEXT = { light: "#c91d21", dark: "#ea7073" } as const;

/**
 * The colour for a refusal's text when the components' own does not read at 4.5:1 on the theme's
 * card and background (it is 4.25:1 on Neo Brutalism's dark card), the least change that does;
 * `undefined` when it reads as it is, or when the surfaces are not hex and cannot be measured.
 */
function refusalText(tokens: ShadcnTokens, mode: "light" | "dark"): string | undefined {
  const surfaces = [tokens.card, tokens.background].filter(
    (value): value is string => value !== undefined && parseHex(value) !== undefined,
  );
  if (surfaces.length === 0) return undefined;
  const own = REFUSAL_TEXT[mode];
  const moved = legible(own, surfaces, { pole: mode === "dark" ? "#ffffff" : "#000000" });
  return moved === own ? undefined : moved;
}

function colours(tokens: ShadcnTokens, mode: "light" | "dark"): KaitenVariables {
  const variables: KaitenVariables = {};
  for (const [token, key] of COLOURS) {
    const value = tokens[token];
    if (value !== undefined) variables[key] = value;
  }
  for (const [fillToken, labelToken, key] of HOVERS) {
    const fill = tokens[fillToken];
    const label = tokens[labelToken];
    if (fill !== undefined && label !== undefined) variables[key] = hoverFor(fill, label);
  }
  const refusal = refusalText(tokens, mode);
  if (refusal !== undefined) variables.colorDestructiveSubtleForeground = refusal;
  return variables;
}

/** The two keys that hold in both modes, when the blocks agree; the ones that differ, per mode. */
function shared(light: ShadcnTokens, dark: ShadcnTokens) {
  const both: KaitenVariables = {};
  const perMode: Record<"light" | "dark", KaitenVariables> = { light: {}, dark: {} };
  const pairs = [
    ["radius", "borderRadius"],
    ["font-sans", "fontFamily"],
  ] as const;
  for (const [token, key] of pairs) {
    const [inLight, inDark] = [light[token], dark[token]];
    if (inLight !== undefined && inLight === inDark) both[key] = inLight;
    else {
      if (inLight !== undefined) perMode.light[key] = inLight;
      if (inDark !== undefined) perMode.dark[key] = inDark;
    }
  }
  return { both, perMode };
}

/**
 * The class names of `appearance.elements` for the parts of the components the storefront dresses
 * beyond what `variables` reach (the shadow and the border of a card, the corners of a pricing card).
 * They are defined in `styles.css`, under `.themed-*`.
 */
export const THEMED_ELEMENTS = {
  card: "themed-card",
  pricingCard: "themed-card themed-pricing-card",
  pricingCardHighlight: "themed-card-highlight",
} as const satisfies ThemedAppearance["elements"];

export function toAppearance(theme: ShadcnTheme): ThemedAppearance {
  const { both, perMode } = shared(theme.light, theme.dark);
  return {
    variables: both,
    modes: {
      light: { ...colours(theme.light, "light"), ...perMode.light },
      dark: { ...colours(theme.dark, "dark"), ...perMode.dark },
    },
    elements: { ...THEMED_ELEMENTS },
  };
}
