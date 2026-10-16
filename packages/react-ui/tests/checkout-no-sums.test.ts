import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { expect, test } from "vite-plus/test";

// The amount due is the server's. Nothing that draws or drives a checkout adds a price up, rounds
// one, or takes a share of one: a screen that did could show a total the checkout does not bill.
// The portal's add-ons panel says what a change does to a subscription by the same rule: the
// add-on's own fee beside the change, never what the renewal will come to.
// The behaviour is held by the suites of the components, with a total that disagrees with its
// lines; this holds the sources to it, so that a sum cannot be added back unseen.

const here = path.resolve(import.meta.dirname, "..");
const SOURCES = [
  path.join(here, "src/components/checkout-flow"),
  path.resolve(here, "../react/src/hooks/billing"),
  path.join(here, "src/components/customer-portal/sections/manage-addons.tsx"),
  path.join(here, "src/components/customer-portal/sections/session-addons.tsx"),
  path.join(here, "src/components/customer-portal/sections/session-addon-rows.ts"),
];

function* files(dir: string): Generator<string> {
  if (/\.tsx?$/.test(dir)) {
    yield dir;
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(full) && !full.includes(".stories.")) yield full;
  }
}

/** The arithmetic that makes a total of prices: sums over lines, shares, roundings. */
const ARITHMETIC = [
  /\.reduce\(/,
  /Math\.(round|floor|ceil|trunc)\(/,
  /\.(amount|total|subtotal|discountTotal|unitAmount\w*)\s*[-+*/]/,
  /[-+*/]\s*\w+\.(amount|total|subtotal|discountTotal)\b/,
];

test("no source of a checkout, nor of the portal's add-ons, sums, rounds or shares an amount", () => {
  const found: string[] = [];
  for (const dir of SOURCES) {
    for (const file of files(dir)) {
      // Comments are prose, and quote the rule they keep.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const pattern of ARITHMETIC) {
        if (pattern.test(code)) found.push(`${path.basename(file)}: ${pattern}`);
      }
    }
  }
  expect(found).toEqual([]);
});
