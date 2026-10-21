// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Slugs for the customers and instances a visitor's sign-up creates. Kaiten generates one when
// none is sent; the storefront sends its own so that a name collision is retried here, in the
// open, and so that the slug the cookie holds is known before Kaiten answers.

import { randomBytes } from "node:crypto";

/** The longest a name contributes: the suffix and its dash are added to it, and a slug is 100 at most. */
const BASE_LENGTH = 40;

/**
 * A name as the base of a slug: accents removed, lower case, anything that is not a letter or a
 * digit turned into one dash, no dash at either end. `customer` when fewer than two characters
 * are left, since a slug is two at least.
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BASE_LENGTH)
    .replace(/-+$/, "");
  return base.length >= 2 ? base : "customer";
}

/**
 * A unique slug for a name, in Kaiten's own shape: the name's slug, a dash and six random
 * hexadecimal characters. It matches `^[a-z0-9][a-z0-9-]*[a-z0-9]$`, the contract's pattern.
 */
export function generateSlug(name: string, suffix: () => string = randomSuffix): string {
  return `${slugify(name)}-${suffix()}`;
}

function randomSuffix(): string {
  return randomBytes(3).toString("hex");
}
