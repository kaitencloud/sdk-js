// The "Claude" theme of tweakcn.com, as exported (`:root` is `light`, `.dark` is `dark`), with the
// storefront's few adjustments listed under the export and never written into it.

import { applyOverrides, type Override, type ShadcnTheme } from "./shadcn.ts";

/** The theme exactly as tweakcn gives it. */
export const claudeExport = {
  light: {
    background: "#faf9f5",
    foreground: "#3d3929",
    card: "#faf9f5",
    "card-foreground": "#141413",
    popover: "#ffffff",
    "popover-foreground": "#28261b",
    primary: "#c96442", // overridden below, contrast
    "primary-foreground": "#ffffff",
    secondary: "#e9e6dc",
    "secondary-foreground": "#535146",
    muted: "#ede9de",
    "muted-foreground": "#83827d", // overridden below, contrast
    accent: "#e9e6dc",
    "accent-foreground": "#28261b",
    destructive: "#141413",
    "destructive-foreground": "#ffffff",
    border: "#dad9d4",
    input: "#b4b2a7",
    ring: "#c96442",
    "chart-1": "#b05730",
    "chart-2": "#9c87f5",
    "chart-3": "#ded8c4",
    "chart-4": "#dbd3f0",
    "chart-5": "#b4552d",
    sidebar: "#f5f4ee",
    "sidebar-foreground": "#3d3d3a",
    "sidebar-primary": "#c96442",
    "sidebar-primary-foreground": "#fbfbfb",
    "sidebar-accent": "#e9e6dc",
    "sidebar-accent-foreground": "#343434",
    "sidebar-border": "#ebebeb",
    "sidebar-ring": "#b5b5b5",
    "font-sans":
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
    "font-serif": 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    "font-mono":
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    radius: "0.5rem",
    "shadow-x": "0",
    "shadow-y": "1px",
    "shadow-blur": "3px",
    "shadow-spread": "0px",
    "shadow-opacity": "0.1",
    "shadow-color": "oklch(0 0 0)",
    "shadow-2xs": "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
    "shadow-xs": "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
    "shadow-sm": "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
    shadow: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
    "shadow-md": "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10)",
    "shadow-lg": "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10)",
    "shadow-xl": "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10)",
    "shadow-2xl": "0 1px 3px 0px hsl(0 0% 0% / 0.25)",
    "tracking-normal": "0em",
    spacing: "0.25rem",
  },
  dark: {
    background: "#262624",
    foreground: "#c3c0b6",
    card: "#262624",
    "card-foreground": "#faf9f5",
    popover: "#30302e",
    "popover-foreground": "#e5e5e2",
    primary: "#d97757", // overridden below, contrast
    "primary-foreground": "#ffffff",
    secondary: "#faf9f5",
    "secondary-foreground": "#30302e",
    muted: "#1b1b19",
    "muted-foreground": "#b7b5a9",
    accent: "#1a1915",
    "accent-foreground": "#f5f4ee",
    destructive: "#ef4444", // overridden below, contrast
    "destructive-foreground": "#ffffff",
    border: "#3e3e38",
    input: "#52514a",
    ring: "#d97757",
    "chart-1": "#b05730",
    "chart-2": "#9c87f5",
    "chart-3": "#1a1915",
    "chart-4": "#2f2b48",
    "chart-5": "#b4552d",
    sidebar: "#1f1e1d",
    "sidebar-foreground": "#c3c0b6",
    "sidebar-primary": "#343434",
    "sidebar-primary-foreground": "#fbfbfb",
    "sidebar-accent": "#0f0f0e",
    "sidebar-accent-foreground": "#c3c0b6",
    "sidebar-border": "#ebebeb",
    "sidebar-ring": "#b5b5b5",
    "font-sans":
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
    "font-serif": 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    "font-mono":
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    radius: "0.5rem",
    "shadow-x": "0",
    "shadow-y": "1px",
    "shadow-blur": "3px",
    "shadow-spread": "0px",
    "shadow-opacity": "0.1",
    "shadow-color": "oklch(0 0 0)",
    "shadow-2xs": "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
    "shadow-xs": "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
    "shadow-sm": "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
    shadow: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
    "shadow-md": "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10)",
    "shadow-lg": "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10)",
    "shadow-xl": "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10)",
    "shadow-2xl": "0 1px 3px 0px hsl(0 0% 0% / 0.25)",
  },
} satisfies ShadcnTheme;

/**
 * Where the export fails WCAG AA (4.5:1) for text, and what the storefront uses instead. A label
 * stays white on a brand fill, so it is the fill that gives way: the smallest darkening that
 * reaches 4.5:1, found with `legible()` of `color.ts` (the channels move toward black in steps of
 * 0.5%, so hue and saturation are kept). Ratios are under each `reason`'s numbers, held by
 * `tests/themes.test.ts`.
 */
export const claudeOverrides: readonly Override[] = [
  {
    mode: "light",
    token: "primary",
    from: "#c96442",
    to: "#b95c3d",
    reason: "White on #c96442 is 3.90:1. #b95c3d gives 4.51:1.",
  },
  {
    mode: "light",
    token: "muted-foreground",
    from: "#83827d",
    to: "#6a6965",
    reason:
      "Muted text on the background and the card (#faf9f5) is 3.65:1, and on the muted fill (#ede9de) 3.17:1. #6a6965 gives 4.53:1 on the muted fill, the lowest of the three.",
  },
  {
    mode: "dark",
    token: "primary",
    from: "#d97757",
    to: "#b06046",
    reason: "White on #d97757 is 3.12:1. #b06046 gives 4.56:1.",
  },
  {
    mode: "dark",
    token: "destructive",
    from: "#ef4444",
    to: "#d73d3d",
    reason: "White on #ef4444 is 3.76:1. #d73d3d gives 4.54:1.",
  },
];

/** The theme the storefront uses: the export with the overrides above. */
export const claude: ShadcnTheme = applyOverrides(claudeExport, claudeOverrides);
