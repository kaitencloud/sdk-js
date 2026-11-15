// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The "Neo Brutalism" theme of tweakcn.com, as exported (`:root` is `light`, `.dark` is `dark`),
// with the storefront's one adjustment listed under the export and never written into it.

import { applyOverrides, type Override, type ShadcnTheme } from "./shadcn.ts";

/** The theme exactly as tweakcn gives it. */
export const neoBrutalismExport = {
  light: {
    background: "#ffffff",
    foreground: "#000000",
    card: "#ffffff",
    "card-foreground": "#000000",
    popover: "#ffffff",
    "popover-foreground": "#000000",
    primary: "#ff3333", // overridden below, contrast
    "primary-foreground": "#ffffff",
    secondary: "#ffff00",
    "secondary-foreground": "#000000",
    muted: "#f0f0f0",
    "muted-foreground": "#333333",
    accent: "#0066ff",
    "accent-foreground": "#ffffff",
    destructive: "#000000",
    "destructive-foreground": "#ffffff",
    border: "#000000",
    input: "#000000",
    ring: "#ff3333",
    "chart-1": "#ff3333",
    "chart-2": "#ffff00",
    "chart-3": "#0066ff",
    "chart-4": "#00cc00",
    "chart-5": "#cc00cc",
    sidebar: "#f0f0f0",
    "sidebar-foreground": "#000000",
    "sidebar-primary": "#ff3333",
    "sidebar-primary-foreground": "#ffffff",
    "sidebar-accent": "#0066ff",
    "sidebar-accent-foreground": "#ffffff",
    "sidebar-border": "#000000",
    "sidebar-ring": "#ff3333",
    "font-sans": "DM Sans, sans-serif",
    "font-serif": 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    "font-mono": "Space Mono, monospace",
    radius: "0px",
    "shadow-x": "4px",
    "shadow-y": "4px",
    "shadow-blur": "0px",
    "shadow-spread": "0px",
    "shadow-opacity": "1",
    "shadow-color": "hsl(0 0% 0%)",
    "shadow-2xs": "4px 4px 0px 0px hsl(0 0% 0% / 0.50)",
    "shadow-xs": "4px 4px 0px 0px hsl(0 0% 0% / 0.50)",
    "shadow-sm": "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 1px 2px -1px hsl(0 0% 0% / 1.00)",
    shadow: "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 1px 2px -1px hsl(0 0% 0% / 1.00)",
    "shadow-md": "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 2px 4px -1px hsl(0 0% 0% / 1.00)",
    "shadow-lg": "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 4px 6px -1px hsl(0 0% 0% / 1.00)",
    "shadow-xl": "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 8px 10px -1px hsl(0 0% 0% / 1.00)",
    "shadow-2xl": "4px 4px 0px 0px hsl(0 0% 0% / 2.50)",
    "tracking-normal": "0em",
    spacing: "0.25rem",
  },
  dark: {
    background: "#000000",
    foreground: "#ffffff",
    card: "#333333",
    "card-foreground": "#ffffff",
    popover: "#333333",
    "popover-foreground": "#ffffff",
    primary: "#ff6666",
    "primary-foreground": "#000000",
    secondary: "#ffff33",
    "secondary-foreground": "#000000",
    muted: "#1a1a1a",
    "muted-foreground": "#cccccc",
    accent: "#3399ff",
    "accent-foreground": "#000000",
    destructive: "#ffffff",
    "destructive-foreground": "#000000",
    border: "#ffffff",
    input: "#ffffff",
    ring: "#ff6666",
    "chart-1": "#ff6666",
    "chart-2": "#ffff33",
    "chart-3": "#3399ff",
    "chart-4": "#33cc33",
    "chart-5": "#cc33cc",
    sidebar: "#000000",
    "sidebar-foreground": "#ffffff",
    "sidebar-primary": "#ff6666",
    "sidebar-primary-foreground": "#000000",
    "sidebar-accent": "#3399ff",
    "sidebar-accent-foreground": "#000000",
    "sidebar-border": "#ffffff",
    "sidebar-ring": "#ff6666",
    "font-sans": "DM Sans, sans-serif",
    "font-serif": 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    "font-mono": "Space Mono, monospace",
    radius: "0px",
    "shadow-x": "4px",
    "shadow-y": "4px",
    "shadow-blur": "0px",
    "shadow-spread": "0px",
    "shadow-opacity": "1",
    "shadow-color": "hsl(0 0% 0%)",
    "shadow-2xs": "4px 4px 0px 0px hsl(0 0% 0% / 0.50)",
    "shadow-xs": "4px 4px 0px 0px hsl(0 0% 0% / 0.50)",
    "shadow-sm": "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 1px 2px -1px hsl(0 0% 0% / 1.00)",
    shadow: "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 1px 2px -1px hsl(0 0% 0% / 1.00)",
    "shadow-md": "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 2px 4px -1px hsl(0 0% 0% / 1.00)",
    "shadow-lg": "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 4px 6px -1px hsl(0 0% 0% / 1.00)",
    "shadow-xl": "4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 8px 10px -1px hsl(0 0% 0% / 1.00)",
    "shadow-2xl": "4px 4px 0px 0px hsl(0 0% 0% / 2.50)",
  },
} satisfies ShadcnTheme;

/**
 * Where the export fails WCAG AA (4.5:1) for text, and what the storefront uses instead: the smallest
 * darkening of the fill that reaches 4.5:1 under its white label (see `claudeOverrides`). Every other
 * pair of this theme meets it as exported.
 */
export const neoBrutalismOverrides: readonly Override[] = [
  {
    mode: "light",
    token: "primary",
    from: "#ff3333",
    to: "#e22d2d",
    reason: "White on #ff3333 is 3.64:1. #e22d2d gives 4.52:1.",
  },
];

/** The theme the storefront uses: the export with the overrides above. */
export const neoBrutalism: ShadcnTheme = applyOverrides(neoBrutalismExport, neoBrutalismOverrides);

/**
 * The width of the borders of this theme's cards and buttons. Not in tweakcn's export, which has
 * no such token: it is what makes the theme read as Neo Brutalism beside its `--border` of black.
 */
export const NEO_BRUTALISM_BORDER_WIDTH = "2px";
