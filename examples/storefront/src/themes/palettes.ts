// The themes a visitor can pick. "Kaiten" is the storefront's own look and has no theme object:
// nothing is overridden, on the page or on the components.

import { claude } from "./claude.ts";
import { NEO_BRUTALISM_BORDER_WIDTH, neoBrutalism } from "./neo-brutalism.ts";
import type { ShadcnTheme } from "./shadcn.ts";

export type PaletteId = "kaiten" | "claude" | "neo-brutalism";

export interface Palette {
  id: PaletteId;
  /** What the picker says. */
  label: string;
  /** The tokens of the theme, in the shadcn shape. Absent for the storefront's own look. */
  theme?: ShadcnTheme;
  /** The width of the borders of cards and buttons, for a theme that wants more than 1px. */
  borderWidth?: string;
}

export const DEFAULT_PALETTE: PaletteId = "kaiten";

/** Where the visitor's choice is remembered. `index.html` reads the same key, before React runs. */
export const PALETTE_STORAGE_KEY = "storefront-palette";

export const PALETTES: readonly Palette[] = [
  { id: "kaiten", label: "Kaiten" },
  { id: "claude", label: "Claude", theme: claude },
  {
    id: "neo-brutalism",
    label: "Neo Brutalism",
    theme: neoBrutalism,
    borderWidth: NEO_BRUTALISM_BORDER_WIDTH,
  },
];

export function paletteById(id: string | null | undefined): Palette | undefined {
  return PALETTES.find((palette) => palette.id === id);
}
