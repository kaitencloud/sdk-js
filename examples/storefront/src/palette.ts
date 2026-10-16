// The storefront's theme (Kaiten, Claude, Neo Brutalism), the second choice beside the colour mode of
// `theme.ts`: every theme has a Light and a Dark, and the two are picked apart. It is remembered
// between visits.
//
// Like the colour mode it has two readers. The page reads it from the `data-palette` attribute this
// module puts on <html> (the generated rules of `themes/page-css.ts` are scoped by it), and
// `index.html` runs the same few lines before the first paint so that a themed page never starts in
// the Kaiten look. The components read it through `themes/to-appearance.ts` (see `app.tsx`).

import { useSyncExternalStore } from "react";

import {
  DEFAULT_PALETTE,
  PALETTE_STORAGE_KEY,
  paletteById,
  type PaletteId,
} from "./themes/palettes.ts";

/** What the visitor chose before, or the Kaiten look. Storage can be absent or blocked: never throws. */
function readStoredPalette(): PaletteId {
  try {
    return paletteById(window.localStorage.getItem(PALETTE_STORAGE_KEY))?.id ?? DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

let palette: PaletteId = readStoredPalette();
const listeners = new Set<() => void>();

function applyPalette(): void {
  document.documentElement.dataset.palette = palette;
}

/** Chooses a theme, applies it and remembers it. */
export function setPalette(next: PaletteId): void {
  palette = next;
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
  } catch {
    // Private window or blocked storage: the theme holds for this visit only.
  }
  applyPalette();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): PaletteId => palette;
const getServerSnapshot = (): PaletteId => DEFAULT_PALETTE;

/** The visitor's theme, and the way to change it. */
export function usePalette(): [PaletteId, (next: PaletteId) => void] {
  return [useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot), setPalette];
}

// Agree with what index.html already did, and with a storage that changed since.
applyPalette();
