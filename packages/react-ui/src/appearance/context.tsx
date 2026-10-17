// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import type { KaitenAppearance } from "./types.ts";

const AppearanceContext = /* @__PURE__ */ React.createContext<KaitenAppearance>({});

export function AppearanceProvider({
  appearance,
  children,
}: {
  appearance?: KaitenAppearance;
  children: React.ReactNode;
}) {
  return (
    <AppearanceContext.Provider value={appearance ?? {}}>{children}</AppearanceContext.Provider>
  );
}

export function useAppearance(): KaitenAppearance {
  return React.useContext(AppearanceContext);
}

export function useMergedAppearance(local?: KaitenAppearance): KaitenAppearance {
  const global = useAppearance();
  return React.useMemo(() => mergeAppearance(global, local), [global, local]);
}

/** Exported for `tests/appearance-per-mode.test.ts`; not on the package barrel. */
export function mergeAppearance(
  global: KaitenAppearance,
  local?: KaitenAppearance,
): KaitenAppearance {
  if (!local) return global;
  return {
    baseTheme: local.baseTheme ?? global.baseTheme,
    zIndex: local.zIndex ?? global.zIndex,
    variables: { ...global.variables, ...local.variables },
    // Per mode, like `variables` — and merged at all, which it was not: a
    // nested root dropped every `modes` palette above and below it, so an
    // appearance whose surfaces live there (the documented shape) resolved to
    // the defaults. Invisible while the provider applied its own appearance
    // directly; the only path now that `KaitenStyleRoot` renders the scope.
    modes: {
      light: { ...global.modes?.light, ...local.modes?.light },
      dark: { ...global.modes?.dark, ...local.modes?.dark },
    },
    elements: { ...global.elements, ...local.elements },
    icons: { ...global.icons, ...local.icons },
  };
}
