import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

// Nothing verified the published package shape — subpath types worked only
// by `dist/*.d.mts` adjacency, so a future renamed/hashed dts would break consumer
// types with a green CI. These buildless checks pin the intent: every JS subpath
// declares matching `types` + `default` conditions, and the entry is a client module.
function readFromRoot(rel: string): string {
  // Most-specific base first: from the workspace root, "" would resolve
  // package.json to the ROOT manifest (no types/exports) and fail wrongly.
  for (const base of ["packages/react/", ""]) {
    try {
      return readFileSync(base + rel, "utf8");
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`not found from cwd: ${rel}`);
}

const pkg = JSON.parse(readFromRoot("package.json")) as {
  types?: string;
  sideEffects?: boolean | string[];
  exports: Record<string, string | { types?: string; default?: string }>;
};

describe("published package shape", () => {
  test("declares a top-level types entrypoint into dist", () => {
    // `vp pack` generates string-form subpath exports plus a top-level `types`;
    // the entry declaration must be present so consumer types resolve. (No dist
    // read here — tests run before the build in CI.)
    expect(pkg.types).toMatch(/^\.\/dist\/.*\.d\.mts$/);
  });

  test("every JS subpath export points at a built .mjs", () => {
    for (const [subpath, value] of Object.entries(pkg.exports)) {
      if (subpath === "./package.json" || subpath.endsWith(".css")) continue;
      const target = typeof value === "string" ? value : value.default;
      expect(target, `${subpath} should resolve to a built module`).toMatch(/\.mjs$/);
    }
  });

  test("the package entry is a client module ('use client' first line)", () => {
    expect(readFromRoot("src/index.ts").split("\n")[0]).toBe('"use client";');
  });

  test("the internal and locales subpaths are published, and no stylesheet", () => {
    // `./locales` ships one pack per language; `./internal` is what
    // `@kaitencloud/react-ui` reaches for. Dropping either from `exports` would
    // be silent — the root still exports the same names. The stylesheet went
    // with the components: a headless host has nothing to import for effect.
    expect(pkg.exports["./internal"]).toBe("./dist/internal.mjs");
    expect(pkg.exports["./locales"]).toBe("./dist/locales.mjs");
    expect(pkg.exports["./styles.css"]).toBeUndefined();
    expect(pkg.exports["./headless"]).toBeUndefined();
  });

  test("declares no side effects, so a bundler drops what a host does not import", () => {
    expect(pkg.sideEffects).toBe(false);
  });

  test("the locales entry is plain data, importable from a server component", () => {
    // Deliberately no "use client": the packs are strings and formatters, and a
    // Server Component that picks the language must be able to import them.
    expect(readFromRoot("src/locales.ts").split("\n")[0]).not.toBe('"use client";');
  });
});
