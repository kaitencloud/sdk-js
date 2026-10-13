// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The release check (scripts/check-release-dependencies.mjs), tried on small trees
// built for the occasion: the floor of the client, with a client that has or lacks
// the name a React package imports, and the shape of the release, with one rule
// broken at a time. Nothing here reaches npm: the client at its floor and npm's dry
// run are replaced, and the packages are packed the way the release packs them.
//
// The last tests run the shape rules on this repository, so they need the build:
// `vp run -r build`.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import {
  checkClientFloor,
  checkReleaseShape,
  clientImports,
  floorOf,
  publishedPackages,
} from "../check-release-dependencies.mjs";
import { packWorkspacePackage, repoRoot } from "../lib/npm-package.mjs";

const LONG = 240_000;
const LEGAL = [
  "LICENSE",
  "NOTICE",
  "DCO.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
];

let work;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "kaiten-release-test-"));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof text === "string" ? text : `${JSON.stringify(text, null, 2)}\n`);
};

/** The result of one rule, by its name. */
const byRule = (results, rule) => results.find((result) => result.rule === rule);

describe("floorOf", () => {
  test.each([
    ["^1.1.0", "1.0.0", "1.1.0"],
    ["~1.2.3", "1.0.0", "1.2.3"],
    [">=1.4.0", "1.0.0", "1.4.0"],
    ["1.0.0", "1.9.0", "1.0.0"],
    ["^1", "1.0.0", "1.0.0"],
    ["^1.2", "1.0.0", "1.2.0"],
    ["workspace:^", "1.3.0", "1.3.0"],
    ["workspace:*", "1.3.0", "1.3.0"],
    ["workspace:~", "1.3.0", "1.3.0"],
    ["workspace:^1.2.0", "1.3.0", "1.2.0"],
    ["*", "1.3.0", null],
    ["latest", "1.3.0", null],
    ["catalog:", "1.3.0", null],
  ])("%s in a tree at %s is %s", (range, tree, floor) => {
    expect(floorOf(range, tree)).toBe(floor);
  });
});

describe("the imports a package makes from the client", () => {
  test("are the statements, once each, whatever their layout", () => {
    const src = join(work, "imports", "src");
    write(
      join(src, "a.tsx"),
      [
        'import { KaitenClient, type Plan } from "@kaitencloud/client";',
        'import type { KaitenCatalog } from "@kaitencloud/client";',
        "import {",
        "  createMockKaitenClient,",
        "  demoCatalog,",
        '} from "@kaitencloud/client/testing";',
        'import { useState } from "react";',
        'export { type Addon } from "@kaitencloud/client";',
      ].join("\n"),
    );
    write(
      join(src, "nested", "b.ts"),
      'import { KaitenClient, type Plan } from "@kaitencloud/client";\n',
    );
    write(join(src, "c.d.ts"), 'import { Declared } from "@kaitencloud/client";\n');
    write(join(src, "notes.md"), 'import { Docs } from "@kaitencloud/client";\n');
    write(
      join(src, "card", "card.stories.tsx"),
      'import { demoCatalog } from "@kaitencloud/client/testing";\n',
    );
    write(join(src, "card", "card.test.tsx"), 'import { Tested } from "@kaitencloud/client";\n');
    write(join(src, "card", "card.spec.ts"), 'import { Specified } from "@kaitencloud/client";\n');

    expect(clientImports(src)).toEqual([
      'export { type Addon } from "@kaitencloud/client";',
      'import type { KaitenCatalog } from "@kaitencloud/client";',
      'import { KaitenClient, type Plan } from "@kaitencloud/client";',
      'import { createMockKaitenClient, demoCatalog, } from "@kaitencloud/client/testing";',
    ]);
  });
});

/** A client tarball as npm would serve one: a manifest and declarations that export `names`. */
function clientTarball(into, names) {
  const staging = mkdtempSync(join(work, "client-"));
  write(join(staging, "package", "package.json"), {
    name: "@kaitencloud/client",
    version: "1.0.0",
    type: "module",
    types: "./dist/index.d.mts",
    exports: { ".": "./dist/index.mjs", "./testing": "./dist/testing.mjs" },
  });
  write(
    join(staging, "package", "dist", "index.d.mts"),
    `${names.map((name) => `export declare const ${name}: unknown;`).join("\n")}\nexport type Plan = { slug: string };\n`,
  );
  write(
    join(staging, "package", "dist", "testing.d.mts"),
    "export declare const demoCatalog: unknown;\n",
  );
  mkdirSync(into, { recursive: true });
  const tarball = join(into, "kaitencloud-client.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", staging, "package"]);
  return tarball;
}

/** A tree with a client and a React package whose range and imports are given. */
function treeWithReact({ range = "workspace:^", clientVersion = "1.0.0", source }) {
  const root = mkdtempSync(join(work, "tree-"));
  write(join(root, "packages/client/package.json"), {
    name: "@kaitencloud/client",
    version: clientVersion,
  });
  write(join(root, "packages/react/package.json"), {
    name: "@kaitencloud/react",
    version: "1.0.0",
    private: true,
    ...(range === null ? {} : { dependencies: { "@kaitencloud/client": range } }),
  });
  write(join(root, "packages/react/src/index.ts"), source);
  return root;
}

describe("the floor of the client", () => {
  test("is skipped, and says why, when the tree has no React package", async () => {
    const root = mkdtempSync(join(work, "tree-"));
    write(join(root, "packages/client/package.json"), {
      name: "@kaitencloud/client",
      version: "1.0.0",
    });

    const [result] = await checkClientFloor(root, {
      fetchTarball: () => {
        throw new Error("nothing should be fetched");
      },
    });

    expect(result.status).toBe("skip");
    expect(result.detail).toContain("packages/react");
  });

  test(
    "passes when every import exists in the client at the floor, and asks npm for that version",
    async () => {
      const root = treeWithReact({
        clientVersion: "1.2.0",
        source:
          'import { KaitenClient, type Plan } from "@kaitencloud/client";\nimport { demoCatalog } from "@kaitencloud/client/testing";\n',
      });
      const asked = [];

      const [result] = await checkClientFloor(root, {
        fetchTarball: (spec, into) => {
          asked.push(spec);
          return clientTarball(into, ["KaitenClient"]);
        },
      });

      expect(asked).toEqual(["@kaitencloud/client@1.2.0"]);
      expect(result).toMatchObject({ status: "ok" });
    },
    LONG,
  );

  test(
    "passes when several source files import the same name from the client",
    async () => {
      // Two statements that bind `KaitenClient`: compiled together in one file they would
      // be duplicate declarations, whatever the client exports.
      const root = treeWithReact({
        source: 'import { KaitenClient } from "@kaitencloud/client";\nexport { KaitenClient };\n',
      });
      write(
        join(root, "packages/react/src/other.ts"),
        'import { KaitenClient, type Plan } from "@kaitencloud/client";\nexport { KaitenClient };\nexport type { Plan };\n',
      );

      const [result] = await checkClientFloor(root, {
        fetchTarball: (_spec, into) => clientTarball(into, ["KaitenClient"]),
      });

      expect(result).toMatchObject({ status: "ok" });
    },
    LONG,
  );

  test(
    "fails when a package imports what the floor does not export, and names it",
    async () => {
      const root = treeWithReact({
        source:
          'import { KaitenClient, KaitenSessionClient } from "@kaitencloud/client";\nexport { KaitenClient, KaitenSessionClient };\n',
      });

      const [result] = await checkClientFloor(root, {
        fetchTarball: (_spec, into) => clientTarball(into, ["KaitenClient"]),
      });

      expect(result.status).toBe("fail");
      expect(result.detail).toContain("KaitenSessionClient");
      expect(result.detail).toContain("1.0.0");
    },
    LONG,
  );

  test("fails, telling the client to go first, when the floor is not on npm", async () => {
    const root = treeWithReact({
      clientVersion: "1.1.0",
      source: 'import { KaitenClient } from "@kaitencloud/client";\n',
    });

    const [result] = await checkClientFloor(root, {
      fetchTarball: () => {
        throw Object.assign(new Error("npm pack failed"), { stderr: "npm error code E404" });
      },
    });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("@kaitencloud/client@1.1.0");
    expect(result.detail).toContain("publish the client before");
  });

  test("does not call an unreachable registry a missing version", async () => {
    const root = treeWithReact({ source: 'import { KaitenClient } from "@kaitencloud/client";\n' });

    const [result] = await checkClientFloor(root, {
      fetchTarball: () => {
        throw Object.assign(new Error("npm pack failed"), { stderr: "npm error code ENOTFOUND" });
      },
    });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("could not be fetched");
    expect(result.detail).not.toContain("publish the client before");
  });

  test("fails when a package imports the client without declaring it", async () => {
    const root = treeWithReact({
      range: null,
      source: 'import { KaitenClient } from "@kaitencloud/client";\n',
    });

    const [result] = await checkClientFloor(root, { fetchTarball: () => "unused" });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("declares no dependency");
  });

  test("has no floor for a range that names no version", async () => {
    const root = treeWithReact({
      range: "*",
      source: 'import { KaitenClient } from "@kaitencloud/client";\n',
    });

    const [result] = await checkClientFloor(root, { fetchTarball: () => "unused" });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("no lowest version");
  });
});

// -- The shape of the release ---------------------------------------------------

/** A release tree of one published package: valid until a test breaks one thing. */
function releaseTree(adjust = {}) {
  const root = mkdtempSync(join(work, "release-"));
  for (const name of LEGAL) copyFileSync(join(repoRoot, name), join(root, name));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  copyFileSync(
    join(repoRoot, ".github/workflows/dco.yml"),
    join(root, ".github/workflows/dco.yml"),
  );
  write(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  write(join(root, "packages/lib/package.json"), {
    name: "@kaitencloud/lib",
    version: "1.2.0",
    license: "Apache-2.0",
    publishConfig: { access: "public", registry: "https://registry.npmjs.org/" },
    ...adjust.manifest,
  });
  for (const name of ["LICENSE", "NOTICE"])
    copyFileSync(join(repoRoot, name), join(root, "packages/lib", name));
  return root;
}

/** Packs a package as the release does, leaving out the files listed in `without`. */
const packer =
  ({ without = [], manifest = {}, readme } = {}) =>
  (dir, into) => {
    const staging = mkdtempSync(join(work, "pack-"));
    const base = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    write(join(staging, "package", "package.json"), { ...base, ...manifest });
    if (readme !== undefined) write(join(staging, "package", "README.md"), readme);
    for (const name of ["LICENSE", "NOTICE"].filter((file) => !without.includes(file))) {
      copyFileSync(join(dir, name), join(staging, "package", name));
    }
    const tarball = join(into, "pkg.tgz");
    execFileSync("tar", ["-czf", tarball, "-C", staging, "package"]);
    return tarball;
  };

const accepted = () => ({ status: "accepted" });

describe("the shape of the release", () => {
  test("passes for a tree where everything holds", () => {
    const root = releaseTree();

    const results = checkReleaseShape(root, { pack: packer(), dryRun: accepted });

    expect(results.filter((result) => result.status !== "ok")).toEqual([]);
    expect(byRule(results, "@kaitencloud/lib dry run").detail).toContain("@kaitencloud/lib@1.2.0");
  });

  test.each([
    [
      "a license that is not Apache-2.0",
      { manifest: { license: "MIT" } },
      "@kaitencloud/lib manifest",
      'license is "MIT"',
    ],
    [
      "a publishConfig that points at GitHub Packages",
      { manifest: { publishConfig: { access: "public", registry: "https://npm.pkg.github.com" } } },
      "@kaitencloud/lib manifest",
      "publishConfig",
    ],
    [
      "a publishConfig without public access",
      { manifest: { publishConfig: { registry: "https://registry.npmjs.org/" } } },
      "@kaitencloud/lib manifest",
      "publishConfig",
    ],
    [
      "a dependency on @kaitencloud/core",
      { manifest: { dependencies: { "@kaitencloud/core": "^0.13.0" } } },
      "@kaitencloud/lib manifest",
      "@kaitencloud/core",
    ],
    [
      "a dependency on a Kaiten package below 1.0.0",
      { manifest: { peerDependencies: { "@kaitencloud/client": "^0.13.0" } } },
      "@kaitencloud/lib manifest",
      "below 1.0.0",
    ],
  ])("fails on %s", (_name, adjust, rule, detail) => {
    const root = releaseTree(adjust);

    const results = checkReleaseShape(root, { pack: packer(), dryRun: accepted });

    expect(byRule(results, rule)).toMatchObject({ status: "fail" });
    expect(byRule(results, rule).detail).toContain(detail);
  });

  test("fails on a dependency on a private package of the tree", () => {
    const root = releaseTree({
      manifest: { dependencies: { "@kaitencloud/internal": "workspace:^" } },
    });
    write(join(root, "packages/internal/package.json"), {
      name: "@kaitencloud/internal",
      private: true,
    });

    const results = checkReleaseShape(root, { pack: packer(), dryRun: accepted });

    expect(byRule(results, "@kaitencloud/lib manifest").detail).toContain("is private");
  });

  test("fails when GitHub Packages is named in a workflow", () => {
    const root = releaseTree();
    write(
      join(root, ".github/workflows/publish.yml"),
      "registry-url: https://npm.pkg.github.com\n",
    );

    const results = checkReleaseShape(root, { pack: packer(), dryRun: accepted });

    expect(byRule(results, "registry")).toMatchObject({ status: "fail" });
    expect(byRule(results, "registry").detail).toContain("publish.yml");
  });

  test("fails when the lockfile resolves a 0.x line of a Kaiten package", () => {
    const root = releaseTree();
    write(
      join(root, "pnpm-lock.yaml"),
      "packages:\n  '@kaitencloud/client@0.13.0':\n    resolution: {integrity: sha512-x}\n",
    );

    const results = checkReleaseShape(root, { pack: packer(), dryRun: accepted });

    expect(byRule(results, "lockfile")).toMatchObject({ status: "fail" });
    expect(byRule(results, "lockfile").detail).toContain("@kaitencloud/client@0.13.0");
  });

  test("fails when a legal file is missing at the root", () => {
    const root = releaseTree();
    rmSync(join(root, "SECURITY.md"));

    const results = checkReleaseShape(root, { pack: packer(), dryRun: accepted });

    expect(byRule(results, "legal files")).toMatchObject({ status: "fail" });
    expect(byRule(results, "legal files").detail).toContain("SECURITY.md");
  });

  test("fails when the root LICENSE is not Apache-2.0", () => {
    const root = releaseTree();
    write(
      join(root, "LICENSE"),
      "MIT License\n\nPermission is hereby granted, free of charge...\n",
    );

    const results = checkReleaseShape(root, { pack: packer(), dryRun: accepted });

    expect(byRule(results, "legal files").detail).toContain("Apache License");
  });

  test("fails without the DCO workflow, and with one that does not run on pull requests", () => {
    const missing = releaseTree();
    rmSync(join(missing, ".github/workflows/dco.yml"));
    const weak = releaseTree();
    write(join(weak, ".github/workflows/dco.yml"), "name: DCO\non: push\njobs: {}\n");

    expect(
      byRule(checkReleaseShape(missing, { pack: packer(), dryRun: accepted }), "DCO workflow"),
    ).toMatchObject({
      status: "fail",
    });
    expect(
      byRule(checkReleaseShape(weak, { pack: packer(), dryRun: accepted }), "DCO workflow"),
    ).toMatchObject({
      status: "fail",
    });
  });

  test("fails when a tarball lacks NOTICE, or keeps a workspace range", () => {
    const root = releaseTree();

    const lacking = checkReleaseShape(root, {
      pack: packer({ without: ["NOTICE"] }),
      dryRun: accepted,
    });
    const unresolved = checkReleaseShape(root, {
      pack: packer({ manifest: { dependencies: { "@kaitencloud/client": "workspace:^" } } }),
      dryRun: accepted,
    });

    expect(byRule(lacking, "@kaitencloud/lib tarball").detail).toContain("lacks NOTICE");
    expect(byRule(unresolved, "@kaitencloud/lib tarball").detail).toContain('"workspace:^"');
  });

  test("fails when the README in a tarball says the package is not on npm yet", () => {
    const root = releaseTree();

    const held = checkReleaseShape(root, {
      pack: packer({ readme: "# lib\n\n> **Not on npm yet.** It is published with billing.\n" }),
      dryRun: accepted,
    });
    const released = checkReleaseShape(root, {
      pack: packer({ readme: "# lib\n\nnpm install @kaitencloud/lib\n" }),
      dryRun: accepted,
    });

    expect(byRule(held, "@kaitencloud/lib tarball")).toMatchObject({ status: "fail" });
    expect(byRule(held, "@kaitencloud/lib tarball").detail).toContain("not on npm yet");
    expect(byRule(released, "@kaitencloud/lib tarball")).toMatchObject({ status: "ok" });
  });

  test("fails when what a tarball says it depends on is below 1.0.0, and passes a floor of 1.x", () => {
    const root = releaseTree();

    const old = checkReleaseShape(root, {
      pack: packer({ manifest: { dependencies: { "@kaitencloud/client": "^0.13.0" } } }),
      dryRun: accepted,
    });
    const current = checkReleaseShape(root, {
      pack: packer({ manifest: { dependencies: { "@kaitencloud/client": "^1.1.0" } } }),
      dryRun: accepted,
    });

    expect(byRule(old, "@kaitencloud/lib tarball").detail).toContain("below 1.0.0");
    expect(byRule(current, "@kaitencloud/lib tarball")).toMatchObject({ status: "ok" });
  });

  test("reports a version npm already has as skipped, and a refusal as a failure", () => {
    const root = releaseTree();

    const published = checkReleaseShape(root, {
      pack: packer(),
      dryRun: () => ({ status: "published" }),
    });
    const refused = checkReleaseShape(root, {
      pack: packer(),
      dryRun: () => ({ status: "refused", message: "npm error 403 Forbidden" }),
    });

    expect(byRule(published, "@kaitencloud/lib dry run")).toMatchObject({ status: "skip" });
    expect(published.some((result) => result.status === "fail")).toBe(false);
    expect(byRule(refused, "@kaitencloud/lib dry run")).toMatchObject({ status: "fail" });
    expect(byRule(refused, "@kaitencloud/lib dry run").detail).toContain("403");
  });

  test("a tree with no published package is a failure, not a pass", () => {
    const root = mkdtempSync(join(work, "empty-"));

    expect(checkReleaseShape(root, { pack: packer(), dryRun: accepted })).toMatchObject([
      { status: "fail", rule: "published packages" },
    ]);
  });
});

describe("this repository", () => {
  test(
    "holds every rule of the shape of the release, with npm's dry run as it would be answered",
    () => {
      const results = checkReleaseShape(repoRoot, { dryRun: accepted });

      expect(results.filter((result) => result.status === "fail")).toEqual([]);
      // The two React packages join these the day they stop being private, and this
      // test must not be what stands in the way: it holds for whichever are public.
      const published = publishedPackages(repoRoot).map(({ name }) => name);
      expect(published).toEqual(
        expect.arrayContaining(["@kaitencloud/client", "@kaitencloud/server"]),
      );
      expect(results.filter((result) => result.rule.endsWith("tarball"))).toHaveLength(
        published.length,
      );
    },
    LONG,
  );

  test(
    "compiles what react imports against the client this tree packs",
    async () => {
      // The floor is the version of the client in this tree, so the tarball the tree packs
      // for the client is the floor. Whatever react imports has to be in it.
      const results = await checkClientFloor(repoRoot, {
        fetchTarball: (_spec, into) =>
          packWorkspacePackage(join(repoRoot, "packages", "client"), into),
      });

      const react = results.find(({ rule }) => rule === "@kaitencloud/react client floor");
      expect(react).toMatchObject({ status: "ok" });
    },
    LONG,
  );

  test(
    "reads the floor of the client for both React packages, and only react imports the client",
    async () => {
      // A client at the floor that exports nothing: whatever `react` imports is missing.
      const results = await checkClientFloor(repoRoot, {
        fetchTarball: (_spec, into) => clientTarball(into, []),
      });

      expect(results.map(({ rule }) => rule).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "@kaitencloud/react client floor",
        "@kaitencloud/react-ui client floor",
      ]);
      const react = results.find(({ rule }) => rule === "@kaitencloud/react client floor");
      const reactUi = results.find(({ rule }) => rule === "@kaitencloud/react-ui client floor");
      expect(react?.status).toBe("fail");
      expect(react?.detail).toContain("KaitenSessionClientLike");
      expect(reactUi).toMatchObject({ status: "skip" });
    },
    LONG,
  );
});

describe("the command line of the release check", () => {
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [join(repoRoot, "scripts/check-release-dependencies.mjs"), ...args],
      {
        encoding: "utf8",
      },
    );

  test.each([
    [["--step", "3"], "--step takes 1 or 2"],
    [["--step"], "--step takes a value"],
    [["--root"], "--root takes a value"],
    [["--steps", "1"], 'Unknown argument "--steps"'],
  ])("refuses %j", (args, message) => {
    const result = run(...args);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  test("runs the floor alone on another tree with --step 1 and --root", () => {
    const root = mkdtempSync(join(work, "tree-"));
    write(join(root, "packages/client/package.json"), {
      name: "@kaitencloud/client",
      version: "1.0.0",
    });

    const result = run("--step", "1", "--root", root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Step 1: the floor of the client");
    expect(result.stdout).toContain("skipped");
    expect(result.stdout).not.toContain("Step 2");
  });
});
