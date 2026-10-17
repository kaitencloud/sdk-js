// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The README of each package, and the root one, say which Kaiten release the billing
// features need, in a section of their own. The sentence is the same everywhere, so
// that the day a Kaiten release carries billing, the version is written once and
// every README says it. A README that is edited alone fails here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

import { repoRoot } from "../lib/npm-package.mjs";

const READMES = [
  "README.md",
  "packages/client/README.md",
  "packages/server/README.md",
  "packages/react/README.md",
  "packages/react-ui/README.md",
];

/** The paragraph that opens the "Kaiten version" section of a README, on one line. */
function minimumVersionSentence(path) {
  const text = readFileSync(join(repoRoot, path), "utf8");
  const headings = [...text.matchAll(/^## Kaiten version$/gm)];
  expect(headings, `${path} has one "Kaiten version" section`).toHaveLength(1);
  const body = text.slice(headings[0].index + headings[0][0].length).trimStart();
  return body.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, " ");
}

describe("the minimum Kaiten version in the READMEs", () => {
  const sentences = READMES.map((path) => [path, minimumVersionSentence(path)]);

  test("is stated by every README", () => {
    for (const [path, sentence] of sentences) {
      expect(sentence, path).toMatch(/Kaiten release/);
    }
  });

  test("is the same sentence in all of them", () => {
    const [[firstPath, first], ...rest] = sentences;
    for (const [path, sentence] of rest) {
      expect(sentence, `${path} against ${firstPath}`).toBe(first);
    }
  });
});
