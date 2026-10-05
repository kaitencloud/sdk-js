/**
 * The built-in locale packs — import from `@kaitencloud/react/locales`.
 *
 * ```tsx
 * import { fr } from "@kaitencloud/react/locales";
 *
 * <KaitenProvider locale={fr} …>
 * ```
 *
 * Each pack is a complete `KaitenLocalization`, strings and formatters. They
 * are separate exports on their own entry, rather than a `locales` map the
 * provider resolved from a string, so that a host bundles the languages it
 * ships and no other: a map reachable from the provider put all three in
 * every bundle, English-only hosts included.
 *
 * No `"use client"` here on purpose — these are plain data, importable from a
 * Server Component as readily as from a client one.
 */

export { defaultLocalization as en } from "./localization/defaults.ts";
export { fr } from "./localization/locales/fr.ts";
export { es } from "./localization/locales/es.ts";
export { de } from "./localization/locales/de.ts";
export type { KaitenLocalization, KaitenLocalizationOverrides } from "./localization/types.ts";
