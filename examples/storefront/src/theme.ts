// The storefront's colour theme: Light, Dark or System, remembered between visits.
//
// The theme is one preference with two readers. The page reads it from the `dark` class and the
// `data-theme` attribute this module puts on <html>, and `index.html` runs the same few lines
// before the first paint so that a dark page never starts light. The Kaiten components read it
// from `<KaitenStyleRoot appearance={{ baseTheme }}>`: react-ui resolves "system" itself, and
// follows the visitor's `prefers-color-scheme` live.

import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

/** Where the choice is remembered. `index.html` reads the same key, before React runs. */
export const THEME_STORAGE_KEY = "storefront-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isPreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** What the visitor chose before, or "system". Storage can be absent or blocked: never throws. */
function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function prefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

let preference: ThemePreference = readStoredPreference();
const listeners = new Set<() => void>();

/** Puts the theme on <html>: the class the page's tokens and react-ui's `dark:` rules read. */
function applyTheme(): void {
  const dark = preference === "dark" || (preference === "system" && prefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.theme = preference;
  root.style.colorScheme = dark ? "dark" : "light";
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Chooses a theme, applies it and remembers it. */
export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private window or blocked storage: the theme holds for this visit only.
  }
  applyTheme();
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    // "System" has to follow the operating system while the page is open.
    window.matchMedia(DARK_QUERY).addEventListener("change", onSystemChange);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.matchMedia(DARK_QUERY).removeEventListener("change", onSystemChange);
    }
  };
}

function onSystemChange(): void {
  if (preference === "system") applyTheme();
}

const getSnapshot = (): ThemePreference => preference;
const getServerSnapshot = (): ThemePreference => "system";

/** The visitor's choice, and the way to change it. */
export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  return [useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot), setThemePreference];
}

// Agree with what index.html already did, and with a storage that changed since.
applyTheme();
