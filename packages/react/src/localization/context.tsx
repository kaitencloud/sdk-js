import * as React from "react";

import { defaultLocalization } from "./defaults.ts";
import type { DeepPartial, KaitenLocalization, KaitenLocalizationOverrides } from "./types.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `NoInfer`: without it TypeScript infers `T` from the overrides too, and the
// merged value comes out typed as the partial rather than the whole.
function mergeLocalization<T extends object>(base: T, overrides?: NoInfer<DeepPartial<T>>): T {
  if (!overrides) return base;

  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (value === undefined) continue;

    if (isObject(value) && isObject(merged[key])) {
      merged[key] = mergeLocalization(
        merged[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      merged[key] = value;
    }
  }

  return merged as T;
}

const LocalizationContext =
  /* @__PURE__ */ React.createContext<KaitenLocalization>(defaultLocalization);

export interface LocalizationProviderProps {
  /**
   * The language: a pack from `@kaitencloud/react/locales` (`fr`, `es`, `de`),
   * merged over the English defaults and under `localization`. A pack rather
   * than a name so the provider carries no language it was not handed.
   */
  locale?: KaitenLocalizationOverrides;
  /** The host's own strings, on top of the language — one string of one section is enough. */
  localization?: KaitenLocalizationOverrides;
  children: React.ReactNode;
}

export function LocalizationProvider({
  locale,
  localization,
  children,
}: LocalizationProviderProps) {
  // Resolution order: defaults → locale pack (if any) → explicit `localization`
  // override. So `locale={fr}` gives a French SDK, and a host can still override
  // individual strings on top of it.
  const value = React.useMemo(() => {
    const base = locale ? mergeLocalization(defaultLocalization, locale) : defaultLocalization;
    return mergeLocalization(base, localization);
  }, [locale, localization]);

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): KaitenLocalization {
  return React.useContext(LocalizationContext);
}
