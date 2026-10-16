// The page's own CSS for a theme: the storefront's tokens (`--bg`, `--surface`, `--brand`, ...)
// taken from the same shadcn tokens the components get, so that the shop and its components change
// together. Pure, so that a theme made at runtime can go through it too; the stylesheet it builds is
// put in the page's <head> by `vite.config.ts`, which is what lets it be there before the first
// paint.
//
// The values are written into CSS as they are. They are the storefront's own constants here; a theme
// that comes from somewhere else has to be validated before it gets this far.

import { hoverFor, legible, mix, parseHex } from "./color.ts";
import type { Palette } from "./palettes.ts";
import type { ShadcnTokens } from "./shadcn.ts";

/** The share of the brand colour in its soft tint: the active nav link, the numbers of the journey. */
const SOFT_SHARE = 0.14;

const isHex = (value: string | undefined): value is string =>
  value !== undefined && parseHex(value) !== undefined;

/**
 * The storefront's tokens for one block of a theme, as `--name: value` pairs. A token the theme does
 * not set is not in the result, and the page keeps its own.
 */
export function pageTokens(tokens: ShadcnTokens, mode: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (name: string, value: string | undefined) => {
    if (value !== undefined) out[name] = value;
  };

  set("--bg", tokens.background);
  set("--surface", tokens.card);
  set("--text", tokens.foreground);
  set("--text-muted", tokens["muted-foreground"]);
  set("--border", tokens.border);
  set("--brand", tokens.primary);
  set("--brand-contrast", tokens["primary-foreground"]);
  set("--notice-bg", tokens.muted);
  set("--focus", tokens.ring);
  set("--radius", tokens.radius);
  set("--font", tokens["font-sans"]);
  set("--shadow-xs", tokens["shadow-xs"]);
  set("--shadow-sm", tokens["shadow-sm"]);

  const { primary, background } = tokens;
  const surface = tokens.card ?? background;
  if (primary !== undefined && tokens["primary-foreground"] !== undefined) {
    set("--brand-hover", hoverFor(primary, tokens["primary-foreground"]));
  }
  if (primary !== undefined && surface !== undefined) {
    if (isHex(primary) && isHex(surface) && isHex(background)) {
      // The brand colour as text has to read on the page, on a card and on its own soft tint, in
      // each mode's direction: darker on a light page, lighter on a dark one.
      const soft = mix(surface, primary, SOFT_SHARE);
      set("--brand-soft", soft);
      set(
        "--brand-text",
        legible(primary, [background, surface, soft], {
          pole: mode === "dark" ? "#ffffff" : "#000000",
        }),
      );
    } else {
      set("--brand-soft", `color-mix(in srgb, ${primary} ${SOFT_SHARE * 100}%, ${surface})`);
      set("--brand-text", primary);
    }
  }
  return out;
}

const block = (selector: string, declarations: Record<string, string>) =>
  `${selector} {\n${Object.entries(declarations)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n")}\n}`;

/**
 * One rule per palette and mode, scoped by the `data-palette` attribute that `index.html` and
 * `palette.ts` put on <html>. Their specificity is above `:root` and `:root.dark` of `styles.css`
 * whatever the order of the two sheets. The storefront's own palette has no theme and no rule.
 */
export function paletteStyleSheet(palettes: readonly Palette[]): string {
  const rules: string[] = [];
  for (const palette of palettes) {
    if (!palette.theme) continue;
    const scope = `:root[data-palette="${palette.id}"]`;
    const light = pageTokens(palette.theme.light, "light");
    if (palette.borderWidth !== undefined) {
      // Cards and buttons read these; a palette that sets none keeps the page's 1px.
      light["--theme-border-width"] = palette.borderWidth;
      light["--btn-border"] = "var(--border)";
      light["--btn-border-hover"] = "var(--border)";
    }
    rules.push(block(scope, light), block(`${scope}.dark`, pageTokens(palette.theme.dark, "dark")));
  }
  return `${rules.join("\n")}\n`;
}
