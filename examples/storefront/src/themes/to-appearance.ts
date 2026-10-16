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

import type { KaitenAppearance, KaitenVariables } from "@kaitencloud/react-ui";

import { hoverFor } from "./color.ts";
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

function colours(tokens: ShadcnTokens): KaitenVariables {
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
      light: { ...colours(theme.light), ...perMode.light },
      dark: { ...colours(theme.dark), ...perMode.dark },
    },
    elements: { ...THEMED_ELEMENTS },
  };
}
