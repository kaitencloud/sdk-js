// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "vite-plus/test";

import { TONES } from "../src/components/shared/feedback.tsx";

// A box of the billing screens that paints a fill says the text colour that goes with it. Left to
// inherit, the text takes the page's foreground, which two of the storefront's dark themes make as
// light as their secondary surface (1.00:1 and 1.07:1). scripts/check-token-contrast.mjs and the
// storefront's themes test hold each pair to AA, but only for a className that names both halves.

test.each(Object.entries(TONES))(
  "the %s tone names its text colour when it names a fill",
  (_tone, classes) => {
    const names = classes.split(/\s+/);
    const fill = names.find((name) => name.startsWith("bg-"));
    if (fill === undefined) return;
    const text = names.filter((name) => /^text-(?!xs$|sm$|base$|lg$)/.test(name));
    expect(text.length, `${classes}`).toBeGreaterThan(0);
    // The pair is one the contrast check can follow: the fill's own foreground token.
    const token = fill.replace(/^bg-/, "");
    expect(text.some((name) => name === `text-${token}-foreground`)).toBe(true);
  },
);
