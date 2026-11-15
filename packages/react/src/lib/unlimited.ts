// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/**
 * The Kaiten API encodes "no cap" as the exact `-1` sentinel — the usage
 * reporter enforces any other value, negative or not. Callers should prefer
 * the server-computed `unlimited` flag when present; this check is the
 * fallback for rows that don't carry it.
 *
 * Lives under `lib/` rather than beside the `∞` glyph that renders it so the
 * headless entry can export the predicate without the component behind it.
 */
export function isUnlimited(value: number): boolean {
  return value === -1;
}
