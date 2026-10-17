// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

// Buildless checks on the published shape: the stylesheet subpath a host
// imports, the side-effect declaration that keeps it from being tree-shaken
// away, and the client-module marker on the entry.
function readFromRoot(rel: string): string {
  // Most-specific base first: from the workspace root, "" would resolve
  // package.json to the ROOT manifest (no types/exports) and fail wrongly.
  for (const base of ["packages/react-ui/", ""]) {
    try {
      return readFileSync(base + rel, "utf8");
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`not found from cwd: ${rel}`);
}

/**
 * The first line of a source that is code: the license header and any other
 * leading `//` comment or blank line come before it. A directive such as
 * "use client" still has to be the first statement, and comments may precede it.
 */
function firstStatement(source: string): string | undefined {
  return source.split("\n").find((line) => line.trim() !== "" && !line.startsWith("//"));
}

const pkg = JSON.parse(readFromRoot("package.json")) as {
  types?: string;
  sideEffects?: boolean | string[];
  dependencies?: Record<string, string>;
  exports: Record<string, string | { types?: string; default?: string }>;
};

describe("published package shape", () => {
  test("declares a top-level types entrypoint into dist", () => {
    expect(pkg.types).toMatch(/^\.\/dist\/.*\.d\.mts$/);
  });

  test("every JS subpath export points at a built .mjs", () => {
    for (const [subpath, value] of Object.entries(pkg.exports)) {
      if (subpath === "./package.json" || subpath.endsWith(".css")) continue;
      const target = typeof value === "string" ? value : value.default;
      expect(target, `${subpath} should resolve to a built module`).toMatch(/\.mjs$/);
    }
  });

  test("publishes the stylesheet, and declares it a side effect", () => {
    // `import "@kaitencloud/react-ui/styles.css"` is the one import a host
    // makes for its effect alone; a `sideEffects: false` would let a bundler
    // drop it.
    expect(pkg.exports["./styles.css"]).toBe("./dist/kaiten.css");
    expect(pkg.sideEffects).toContain("./dist/kaiten.css");
  });

  test("depends on the core with a caret range, so one copy serves both doors", () => {
    expect(pkg.dependencies?.["@kaitencloud/react"]).toBe("workspace:^");
  });

  test("the package entry is a client module ('use client' first, after the license header)", () => {
    expect(firstStatement(readFromRoot("src/index.ts"))).toBe('"use client";');
  });
});
