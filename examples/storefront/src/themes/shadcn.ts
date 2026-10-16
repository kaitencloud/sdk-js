// The shape a theme has in shadcn/ui, and so on tweakcn.com: one block of CSS custom properties for
// light and one for dark, keyed here by the property's name without its leading `--`. It is what the
// Kaiten console would one day hand over for a vendor's theme, and what `to-appearance.ts` and
// `page-css.ts` read; nothing else in the storefront knows about a particular theme.

export type ShadcnToken =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "destructive-foreground"
  | "border"
  | "input"
  | "ring"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "sidebar"
  | "sidebar-foreground"
  | "sidebar-primary"
  | "sidebar-primary-foreground"
  | "sidebar-accent"
  | "sidebar-accent-foreground"
  | "sidebar-border"
  | "sidebar-ring"
  | "font-sans"
  | "font-serif"
  | "font-mono"
  | "radius"
  | "shadow-x"
  | "shadow-y"
  | "shadow-blur"
  | "shadow-spread"
  | "shadow-opacity"
  | "shadow-color"
  | "shadow-2xs"
  | "shadow-xs"
  | "shadow-sm"
  | "shadow"
  | "shadow-md"
  | "shadow-lg"
  | "shadow-xl"
  | "shadow-2xl"
  | "tracking-normal"
  | "spacing";

/** One block: whichever tokens the theme sets, as CSS values. A token it leaves out is not set. */
export type ShadcnTokens = Partial<Record<ShadcnToken, string>>;

export interface ShadcnTheme {
  light: ShadcnTokens;
  dark: ShadcnTokens;
}

/** A change to one exported value, with the reason for it. */
export interface Override {
  mode: "light" | "dark";
  token: ShadcnToken;
  /** The value as exported. Checked against the export, so that a stale override fails loudly. */
  from: string;
  to: string;
  reason: string;
}

/**
 * The exported theme with its overrides applied, as a new theme: the export is never edited. An
 * override whose `from` is not what the export holds throws, so that re-exporting a theme from
 * tweakcn cannot leave an old adjustment silently standing on a new value.
 */
export function applyOverrides(exported: ShadcnTheme, overrides: readonly Override[]): ShadcnTheme {
  const theme: ShadcnTheme = { light: { ...exported.light }, dark: { ...exported.dark } };
  for (const { mode, token, from, to } of overrides) {
    if (exported[mode][token] !== from) {
      throw new Error(
        `Override of ${mode} --${token} expects ${from}, but the export holds ${exported[mode][token]}`,
      );
    }
    theme[mode][token] = to;
  }
  return theme;
}
