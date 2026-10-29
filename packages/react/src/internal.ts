// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

"use client";

/**
 * `@kaitencloud/react/internal` — what `@kaitencloud/react-ui` needs from the
 * core and a host does not.
 *
 * Not a public API: no stability promise, no changelog entry, may change in any
 * release. It exists so the two packages share one telemetry context and one
 * provider without the UI package reaching into `dist/` paths.
 */

export { useTrackComponent } from "./telemetry/context.tsx";
export { isHttpUrl } from "./hooks/billing/setup-return.ts";
export { useKaitenDataContext, useKaitenScopeKey } from "./providers/kaiten-provider.tsx";
export { isHeadlinePrice, kaitenPriceParts, type KaitenPriceParts } from "./lib/license-price.ts";
