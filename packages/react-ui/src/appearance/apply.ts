// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { KaitenAppearance, KaitenVariables } from "./types.ts";

type VariableKey = keyof KaitenVariables;

const variableMap: Record<VariableKey, string> = {
  colorPrimary: "--ktn-primary",
  colorPrimaryForeground: "--ktn-primary-foreground",
  colorPrimaryHover: "--ktn-primary-hover",
  colorBackground: "--ktn-background",
  colorForeground: "--ktn-foreground",
  colorCard: "--ktn-card",
  colorCardForeground: "--ktn-card-foreground",
  colorDestructive: "--ktn-destructive",
  colorDestructiveForeground: "--ktn-destructive-foreground",
  colorDestructiveHover: "--ktn-destructive-hover",
  colorDestructiveSubtle: "--ktn-destructive-subtle",
  colorDestructiveSubtleForeground: "--ktn-destructive-subtle-foreground",
  colorSuccess: "--ktn-success",
  colorSuccessForeground: "--ktn-success-foreground",
  colorSuccessHover: "--ktn-success-hover",
  colorMuted: "--ktn-muted",
  colorMutedForeground: "--ktn-muted-foreground",
  colorSecondary: "--ktn-secondary",
  colorSecondaryForeground: "--ktn-secondary-foreground",
  colorSecondaryHover: "--ktn-secondary-hover",
  colorAccent: "--ktn-accent",
  colorAccentForeground: "--ktn-accent-foreground",
  colorAccentHover: "--ktn-accent-hover",
  colorPopover: "--ktn-popover",
  colorPopoverForeground: "--ktn-popover-foreground",
  colorInput: "--ktn-input",
  colorBorder: "--ktn-border",
  colorRing: "--ktn-ring",
  borderRadius: "--ktn-radius",
  fontFamily: "--ktn-font-sans",
};

/**
 * Each fill and the text colour that sits on it.
 *
 * Overriding one without the other is the common way theming breaks contrast: the
 * fill moves, the text stays, and the pair silently stops meeting WCAG AA. Two of
 * this package's own presets shipped that way — `emerald` put white on #059669
 * (3.77:1) and `ocean` white on #0ea5e9 (2.77:1), both under the 4.5:1 floor — and
 * a customer applying their brand colour hits exactly the same edge.
 */
const FOREGROUND_OF: Partial<Record<VariableKey, VariableKey>> = {
  colorPrimary: "colorPrimaryForeground",
  colorDestructive: "colorDestructiveForeground",
  colorSuccess: "colorSuccessForeground",
  colorSecondary: "colorSecondaryForeground",
  colorAccent: "colorAccentForeground",
  colorMuted: "colorMutedForeground",
  colorCard: "colorCardForeground",
  colorPopover: "colorPopoverForeground",
  colorBackground: "colorForeground",
};

/**
 * Each fill and its hover shade.
 *
 * Hover fills used to be alpha composites of the fill itself, so overriding a brand
 * colour moved the hover with it for free. They are authored tokens now — which is
 * what let them meet contrast — and an overridden fill would otherwise keep hovering
 * to the default purple. Deriving keeps the old ergonomics with the new correctness.
 */
const HOVER_OF: Partial<Record<VariableKey, VariableKey>> = {
  colorPrimary: "colorPrimaryHover",
  colorSecondary: "colorSecondaryHover",
  colorDestructive: "colorDestructiveHover",
  colorSuccess: "colorSuccessHover",
  colorAccent: "colorAccentHover",
};

/** `#abc` / `#aabbcc` to channels. Any other notation returns undefined. */
function parseHex(color: string): [number, number, number] | undefined {
  const value = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) {
    return [short[1]!, short[2]!, short[3]!].map((c) => Number.parseInt(c + c, 16)) as [
      number,
      number,
      number,
    ];
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (long) {
    return [long[1]!, long[2]!, long[3]!].map((c) => Number.parseInt(c, 16)) as [
      number,
      number,
      number,
    ];
  }
  return undefined;
}

/** WCAG 2.1 relative luminance. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * Black or white, whichever reads better on `fill`.
 *
 * A deliberate fallback, not a colour system: it only applies when a fill was
 * overridden and its text colour was not, and picking the extreme maximises the
 * contrast available. Callers who want a specific pairing pass it explicitly, and
 * an unparseable colour (`oklch(…)`, `var(…)`, a named colour) yields nothing
 * rather than a guess.
 */
function readableForegroundFor(fill: string): string | undefined {
  const rgb = parseHex(fill);
  if (!rgb) return undefined;
  const luminance = relativeLuminance(rgb);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? "#ffffff" : "#000000";
}

/**
 * The colour with its HSL lightness moved by `delta` (signed), hue and
 * saturation kept. The bounds are the caller's: hovers keep a hair of headroom
 * so the shift stays visible, surface elevation is allowed to reach pure white.
 */
function shiftLightness(
  color: string,
  shift: number,
  floor = 0.02,
  ceiling = 0.98,
): string | undefined {
  const rgb = parseHex(color);
  if (!rgb) return undefined;

  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation =
    delta === 0 ? 0 : delta / (lightness > 0.5 ? 2 - max - min : Math.max(max + min, 1e-6));
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }

  const next = Math.min(ceiling, Math.max(floor, lightness + shift));

  const c = (1 - Math.abs(2 * next - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = next - c / 2;
  const sextant = Math.floor(hue * 6) % 6;
  const [rp, gp, bp] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sextant]!;

  return `#${[rp + m, gp + m, bp + m]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel * 255)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * Move a colour away from `awayFrom` in lightness, so the pair that sits on it keeps
 * its contrast while the shift stays visible.
 *
 * Same rule the theme tokens follow, and for the same reason: shifting by theme
 * (darker in light mode, lighter in dark) is what makes hovers fail — white on a
 * lightened purple drops to 3.42:1. Direction has to come from the text, not the page.
 */
function shiftAway(fill: string, awayFrom: string, amount = 0.09): string | undefined {
  const rgb = parseHex(fill);
  const reference = parseHex(awayFrom);
  if (!rgb || !reference) return undefined;

  const direction = relativeLuminance(rgb) < relativeLuminance(reference) ? -1 : 1;
  return shiftLightness(fill, direction * amount);
}

/**
 * The neutral surfaces that sit on `colorBackground`, and how each is rebuilt
 * from it when the host moves the background alone.
 *
 * Before this table existed, that override was half-applied and unrepairable: a
 * dark background arrived while `colorCard`/`colorPopover` stayed on the light
 * theme's white, so the SDK's own `midnight` preset rendered as a dark page
 * carrying white cards with black text. Fills already brought their companions
 * (foreground, hover) — the background now does too.
 *
 * Two families:
 * - `elevated` surfaces step LIGHTER in both modes — elevation reads as light
 *   whether the page is dark (#070708 → #111019 card) or tinted light (a card
 *   near white on a blush background), so the ceiling is 1, not 0.98.
 * - `textward` neutrals step toward the foreground, the direction the shipped
 *   tokens follow in both modes (muted #f7f7f7 on white/black text, #242239 on
 *   #070708/white text). Borders step further than fills, as they do in the theme.
 *
 * The amounts were calibrated against the 0.3.3 tokens and have NOT been re-tuned,
 * because re-tuning changes what every host sees. Measured against 0.4.0 (HSL L, the
 * quantity `shiftLightness` moves), the dark theme now steps further than the table
 * does — background → card +0.051 against 0.03, background → muted +0.149 against
 * 0.05 — and the light theme no longer steps at all, its card being the same #ffffff
 * as its background. So the shipped light tokens can no longer be read as evidence
 * for the `elevated` direction; the case it actually serves is a tinted light
 * background, which is the only case this table fires in — it runs solely when a host
 * overrides `colorBackground` and leaves its companions alone.
 */
const SURFACES_FROM_BACKGROUND: Array<{
  key: VariableKey;
  kind: "elevated" | "textward";
  amount: number;
}> = [
  { key: "colorCard", kind: "elevated", amount: 0.03 },
  { key: "colorPopover", kind: "elevated", amount: 0.03 },
  { key: "colorMuted", kind: "textward", amount: 0.05 },
  { key: "colorSecondary", kind: "textward", amount: 0.05 },
  { key: "colorBorder", kind: "textward", amount: 0.1 },
  { key: "colorInput", kind: "textward", amount: 0.1 },
];

/** How far `colorMutedForeground` relaxes from the foreground toward the page. */
const MUTED_FOREGROUND_RELAXATION = 0.35;

/**
 * The `--ktn-*` custom properties one palette resolves to, derivations included.
 *
 * Names are unprefixed here: this is a palette, not a mode. `buildAppearanceStyle`
 * is what decides whether they land as `--ktn-light-x` or `--ktn-dark-x`, and it
 * calls this once per mode so each derives its own surfaces.
 */
export function resolveVariables(variables?: KaitenVariables): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [key, cssVar] of Object.entries(variableMap)) {
    const value = variables?.[key as VariableKey];
    if (value) {
      style[cssVar] = value;
    }
  }

  // Explicit values plus everything derived below. The companion passes read
  // from here rather than from `variables`, so a derived surface gets its own
  // companions in turn — a derived card still receives a readable card text.
  const effective: Partial<Record<VariableKey, string>> = { ...variables };

  // An overridden background rebuilds the neutral surfaces that sit on it —
  // explicit choices always win, and an unparseable background derives nothing
  // rather than guessing (same contract as the foreground fallback below).
  const background = variables?.colorBackground;
  if (background && parseHex(background)) {
    const foreground =
      (variables?.colorForeground && parseHex(variables.colorForeground)
        ? variables.colorForeground
        : undefined) ?? readableForegroundFor(background);
    const towardText =
      foreground &&
      relativeLuminance(parseHex(foreground)!) > relativeLuminance(parseHex(background)!)
        ? 1
        : -1;

    for (const surface of SURFACES_FROM_BACKGROUND) {
      if (effective[surface.key]) continue;
      const derived =
        surface.kind === "elevated"
          ? shiftLightness(background, surface.amount, 0, 1)
          : foreground
            ? shiftLightness(background, towardText * surface.amount, 0, 1)
            : undefined;
      if (derived) {
        style[variableMap[surface.key]] = derived;
        effective[surface.key] = derived;
      }
    }

    // Muted text is the one companion the black-or-white fallback would get
    // wrong: it must read as SECONDARY. Relax the page's own text toward the
    // page instead — #000000 on white relaxes to the mid-grey the shipped
    // tokens use, and a tinted explicit foreground keeps its tint.
    if (!effective.colorMutedForeground && foreground) {
      const relaxed = shiftLightness(
        foreground,
        -towardText * MUTED_FOREGROUND_RELAXATION,
        0.02,
        0.98,
      );
      if (relaxed) {
        style[variableMap.colorMutedForeground] = relaxed;
        effective.colorMutedForeground = relaxed;
      }
    }
  }

  // Keep every fill legible — the overridden ones and the surfaces derived
  // above alike. Explicit choices always win; this only fills the gap left
  // when a fill arrives without its text colour.
  for (const [fillKey, foregroundKey] of Object.entries(FOREGROUND_OF) as [
    VariableKey,
    VariableKey,
  ][]) {
    const fill = effective[fillKey];
    if (!fill || effective[foregroundKey]) continue;
    const derived = readableForegroundFor(fill);
    if (derived) {
      style[variableMap[foregroundKey]] = derived;
      effective[foregroundKey] = derived;
    }
  }

  // Keep an overridden fill's hover on the same colour, shifted away from whatever
  // text ends up on it — including a foreground derived just above.
  for (const [fillKey, hoverKey] of Object.entries(HOVER_OF) as [VariableKey, VariableKey][]) {
    const fill = effective[fillKey];
    if (!fill || effective[hoverKey]) continue;
    const foreground = effective[FOREGROUND_OF[fillKey]!];
    const derived = foreground ? shiftAway(fill, foreground) : undefined;
    if (derived) {
      style[variableMap[hoverKey]] = derived;
      effective[hoverKey] = derived;
    }
  }

  return style;
}

/** `--ktn-background` → `--ktn-light-background`, the namespace the generated
 * stylesheet reads through for that mode (see `generate-css.ts` in the theme's source, `packages/theme` in kaitencloud/kaiten). */
function namespaced(cssVar: string, mode: "light" | "dark"): string {
  return `--ktn-${mode}-${cssVar.slice("--ktn-".length)}`;
}

/**
 * Every custom property an appearance resolves to, ready to be applied inline.
 *
 * Mode-independent `variables` are written into BOTH namespaces, so they hold
 * whichever mode the cascade selects; `modes.light` / `modes.dark` are layered
 * over them and land in one. Each mode is derived on its own — a dark palette's
 * background rebuilds dark surfaces, the light one's rebuilds light — which is
 * why this cannot be a single flat object: an inline style has no selector, so
 * one set of values would override the light and dark rules alike.
 */
export function buildAppearanceStyle(
  appearance?: Pick<KaitenAppearance, "variables" | "modes" | "zIndex">,
): React.CSSProperties | undefined {
  const style: Record<string, string> = {};

  for (const mode of ["light", "dark"] as const) {
    const merged = { ...appearance?.variables, ...appearance?.modes?.[mode] };
    for (const [cssVar, value] of Object.entries(resolveVariables(merged))) {
      style[namespaced(cssVar, mode)] = value;
    }
  }

  if (appearance?.zIndex !== undefined) {
    style["--ktn-z-portal"] = String(appearance.zIndex);
  }

  return Object.keys(style).length > 0 ? (style as unknown as React.CSSProperties) : undefined;
}
