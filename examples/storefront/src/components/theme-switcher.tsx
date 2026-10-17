// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";

import { THEME_PREFERENCES, useThemePreference, type ThemePreference } from "../theme.ts";

const LABELS: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const ICONS: Record<ThemePreference, ReactNode> = {
  light: icon(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>,
  ),
  dark: icon(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />),
  system: icon(
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>,
  ),
};

/**
 * Light, Dark or System, as three native radio buttons: the arrow keys, the group and the
 * checked state are the browser's. Each radio fills its label, so a click lands on the input.
 */
export function ThemeSwitcher() {
  const [preference, setPreference] = useThemePreference();
  return (
    <fieldset className="theme-switcher">
      <legend className="visually-hidden">Colour mode</legend>
      {THEME_PREFERENCES.map((value) => (
        <label key={value} title={LABELS[value]}>
          <input
            type="radio"
            name="colour-mode"
            value={value}
            checked={preference === value}
            onChange={() => setPreference(value)}
          />
          {ICONS[value]}
          <span className="theme-switcher-label">{LABELS[value]}</span>
        </label>
      ))}
    </fieldset>
  );
}
