// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { KaitenAppearance } from "./types.ts";

// Theme presets are `KaitenAppearance` objects — `KaitenTheme` was collapsed
// into the single `appearance` model. Apply with `<KaitenStyleRoot appearance={themes.midnight}>`,
// and override per-token by spreading `variables`.
//
// Presets never carry a `baseTheme`. They used to, and it coupled two
// independent axes: a host with its own light/dark toggle picked `midnight` and
// got a dark island in a light page — the preset had kidnapped the mode.
//
// What they DO carry is a surface palette per mode, under `modes`. `midnight`
// was designed around slate surfaces; it keeps them, and they now apply only
// where they make sense. Picking it in a light page gives the brand colour on
// the default light surfaces; the same page switched to dark brings the slate
// out. Nothing is invented for the mode a preset was not designed for — the
// theme defaults hold there, and the surfaces each palette does set derive
// their own neutral family (see apply.ts).
export const themes = {
  /**
   * The built-in look, expressed as the absence of overrides.
   *
   * This preset used to restate the default token values, which made it a third
   * copy of colours that already live in `@kaitencloud/theme` — and it drifted:
   * its primary stayed on the raw brand `#8c5cff` after the token was darkened for
   * contrast, so applying the "default" theme visibly shifted the UI and broke AA.
   * Overriding nothing cannot drift.
   */
  default: {
    variables: {},
  },
  midnight: {
    modes: {
      dark: {
        colorBackground: "#0f172a",
        colorForeground: "#f8fafc",
      },
    },
    variables: {
      colorPrimary: "#7c3aed",
      borderRadius: "0.875rem",
      fontFamily: "DM Sans, ui-sans-serif, sans-serif, system-ui",
    },
  },
  emerald: {
    modes: {
      light: {
        colorBackground: "#f6fdf9",
        colorForeground: "#052e16",
      },
    },
    variables: {
      colorPrimary: "#059669",
      borderRadius: "0.75rem",
      fontFamily: "DM Sans, ui-sans-serif, sans-serif, system-ui",
    },
  },
  rose: {
    modes: {
      light: {
        colorBackground: "#fff8fb",
        colorForeground: "#4c0519",
      },
    },
    variables: {
      colorPrimary: "#e11d48",
      borderRadius: "0.75rem",
      fontFamily: "DM Sans, ui-sans-serif, sans-serif, system-ui",
    },
  },
  ocean: {
    modes: {
      dark: {
        colorBackground: "#082f49",
        colorForeground: "#e0f2fe",
      },
    },
    variables: {
      colorPrimary: "#0ea5e9",
      borderRadius: "0.75rem",
      fontFamily: "DM Sans, ui-sans-serif, sans-serif, system-ui",
    },
  },
  slate: {
    modes: {
      light: {
        colorBackground: "#f8fafc",
        colorForeground: "#0f172a",
      },
    },
    variables: {
      colorPrimary: "#334155",
      borderRadius: "0.625rem",
      fontFamily: "DM Sans, ui-sans-serif, sans-serif, system-ui",
    },
  },
} satisfies Record<string, KaitenAppearance>;
