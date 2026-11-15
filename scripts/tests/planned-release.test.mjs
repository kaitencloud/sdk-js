// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Real Changesets versioning and pnpm tarballs; registry reads are replaced.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { checkDependencyFloors, projectRelease } from "../check-release-dependencies.mjs";
import { packWorkspacePackage, repoRoot } from "../lib/npm-package.mjs";

let work;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "kaiten-projection-test-"));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const manifest = (root, pkg) =>
  JSON.parse(readFileSync(join(root, "packages", pkg, "package.json"), "utf8"));
const missing = () => {
  throw Object.assign(new Error("unpublished"), { stderr: "npm error code E404" });
};
const rule = (results, name) => results.find((result) => result.rule === name);

function packageAt(root, name, version, declarations, dependencies = {}) {
  const dir = join(root, "packages", name);
  write(join(dir, "package.json"), {
    name: `@kaitencloud/${name}`,
    version,
    type: "module",
    files: ["dist"],
    exports: Object.fromEntries(
      Object.keys(declarations).map((entry) => [
        entry === "index" ? "." : `./${entry}`,
        `./dist/${entry}.mjs`,
      ]),
    ),
    dependencies,
  });
  for (const [entry, text] of Object.entries(declarations)) {
    write(join(dir, "dist", `${entry}.d.mts`), text);
    write(join(dir, "dist", `${entry}.mjs`), "export {};\n");
  }
  return dir;
}

function workspace({ clientBump = true, reactBump = false } = {}) {
  const root = mkdtempSync(join(work, "workspace-"));
  write(join(root, "package.json"), { name: "fixture", version: "0.0.0", private: true });
  write(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  write(
    join(root, ".changeset", "config.json"),
    JSON.parse(readFileSync(join(repoRoot, ".changeset/config.json"), "utf8")),
  );
  packageAt(root, "client", "1.1.0", { index: "export type Billing = { amount: number };\n" });
  packageAt(
    root,
    "react",
    "1.0.0",
    {
      index: 'export type { Billing } from "@kaitencloud/client";\n',
      internal: "export declare function useTrack(): void;\n",
    },
    { "@kaitencloud/client": "workspace:^" },
  );
  packageAt(
    root,
    "react-ui",
    "1.0.0",
    { index: "export {};\n" },
    { "@kaitencloud/react": "workspace:^" },
  );
  write(
    join(root, "packages/react/src/index.ts"),
    'export type { Billing } from "@kaitencloud/client";\n',
  );
  write(
    join(root, "packages/react-ui/src/index.ts"),
    'import { useTrack } from "@kaitencloud/react/internal";\nexport type { Billing } from "@kaitencloud/react";\n',
  );
  if (clientBump)
    write(
      join(root, ".changeset/client.md"),
      '---\n"@kaitencloud/client": minor\n---\nAdd billing.\n',
    );
  if (reactBump)
    write(
      join(root, ".changeset/react.md"),
      '---\n"@kaitencloud/react": minor\n---\nAdd billing hooks.\n',
    );
  return root;
}

function publishedClient(into) {
  const root = mkdtempSync(join(work, "published-"));
  const dir = packageAt(root, "client", "1.1.0", { index: "export type Existing = string;\n" });
  return packWorkspacePackage(dir, into);
}

describe("the release projected by Changesets", () => {
  test("checks unpublished planned versions and leaves the source tree intact", async () => {
    const root = workspace();
    const before = readFileSync(join(root, "packages/client/package.json"), "utf8");
    const config = readFileSync(join(root, ".changeset/config.json"), "utf8");
    write(join(root, "packages/client/node_modules/sentinel"), "excluded");
    const projected = projectRelease(root, mkdtempSync(join(work, "projected-")));
    const asked = [];
    const results = await checkDependencyFloors(projected, {
      allowUnpublishedWorkspace: true,
      fetchTarball: (spec) => {
        asked.push(spec);
        return missing();
      },
    });

    expect(manifest(projected, "client").version).toBe("1.2.0");
    expect(results.filter((result) => result.status === "fail")).toEqual([]);
    expect(rule(results, "@kaitencloud/react-ui react floor").status).toBe("ok");
    expect(asked).toContain("@kaitencloud/client@1.2.0");
    expect(asked).not.toContain("@kaitencloud/client@1.1.0");
    expect(readFileSync(join(root, "packages/client/package.json"), "utf8")).toBe(before);
    expect(readFileSync(join(root, ".changeset/config.json"), "utf8")).toBe(config);
    expect(existsSync(join(root, ".changeset/client.md"))).toBe(true);
    expect(existsSync(join(projected, ".changeset/client.md"))).toBe(false);
    expect(existsSync(join(projected, "packages/client/node_modules/sentinel"))).toBe(false);
  });

  test("a missing client changeset fails against the published client, despite newer local exports", async () => {
    const root = workspace({ clientBump: false, reactBump: true });
    const projected = projectRelease(root, mkdtempSync(join(work, "projected-")));
    const asked = [];
    const results = await checkDependencyFloors(projected, {
      allowUnpublishedWorkspace: true,
      fetchTarball: (spec, into) => {
        asked.push(spec);
        return spec === "@kaitencloud/client@1.1.0" ? publishedClient(into) : missing();
      },
    });
    expect(manifest(projected, "client").version).toBe("1.1.0");
    expect(rule(results, "@kaitencloud/react client floor").status).toBe("fail");
    expect(rule(results, "@kaitencloud/react client floor").detail).toContain("Billing");
    expect(asked).toContain("@kaitencloud/client@1.1.0");
  });

  test("a version PR with consumed changesets keeps its versions and accepts its unpublished tarballs", async () => {
    const versioned = projectRelease(workspace(), mkdtempSync(join(work, "versioned-")));
    const projected = projectRelease(versioned, mkdtempSync(join(work, "projected-")));
    const results = await checkDependencyFloors(projected, {
      allowUnpublishedWorkspace: true,
      fetchTarball: missing,
    });
    expect(manifest(projected, "client").version).toBe("1.2.0");
    expect(manifest(projected, "react").version).toBe(manifest(versioned, "react").version);
    expect(results.filter((result) => result.status === "fail")).toEqual([]);
  });

  test("an empty changeset does not hide a missing dependency bump", async () => {
    const root = workspace({ clientBump: false });
    write(join(root, ".changeset/empty.md"), "---\n---\nTooling only.\n");
    const projected = projectRelease(root, mkdtempSync(join(work, "projected-")));
    const results = await checkDependencyFloors(projected, {
      allowUnpublishedWorkspace: true,
      fetchTarball: (_spec, into) => publishedClient(into),
    });
    expect(manifest(projected, "client").version).toBe("1.1.0");
    expect(rule(results, "@kaitencloud/react client floor").status).toBe("fail");
  });

  test("invalid changesets fail projection", () => {
    const root = workspace();
    write(
      join(root, ".changeset/client.md"),
      '---\n"@kaitencloud/client": invalid\n---\nBroken.\n',
    );
    expect(() => projectRelease(root, mkdtempSync(join(work, "projected-")))).toThrow();
    expect(manifest(root, "client").version).toBe("1.1.0");
  });
});

describe("React UI's dependency floor", () => {
  test("rejects a missing internal export in published React instead of using newer local React", async () => {
    const root = workspace({ clientBump: false });
    const published = mkdtempSync(join(work, "published-"));
    const dir = packageAt(published, "react", "1.0.0", {
      index: "export type Billing = string;\n",
      internal: "export declare function olderHook(): void;\n",
    });
    const results = await checkDependencyFloors(root, {
      allowUnpublishedWorkspace: true,
      fetchTarball: (spec, into) =>
        spec.startsWith("@kaitencloud/react@")
          ? packWorkspacePackage(dir, into)
          : publishedClient(into),
    });
    expect(rule(results, "@kaitencloud/react-ui react floor").status).toBe("fail");
    expect(rule(results, "@kaitencloud/react-ui react floor").detail).toContain("useTrack");
  });

  test("resolves published React's own client floor, without substituting a newer local client", async () => {
    const root = workspace();
    const published = mkdtempSync(join(work, "published-"));
    const dir = packageAt(
      published,
      "react",
      "1.0.0",
      {
        index: "export type Billing = string;\n",
        internal: "export declare function useTrack(): void;\n",
      },
      { "@kaitencloud/client": "^1.0.0" },
    );
    const asked = [];
    const results = await checkDependencyFloors(root, {
      allowUnpublishedWorkspace: true,
      fetchTarball: (spec, into) => {
        asked.push(spec);
        if (spec === "@kaitencloud/react@1.0.0") return packWorkspacePackage(dir, into);
        if (spec === "@kaitencloud/client@1.1.0") return publishedClient(into);
        return missing();
      },
    });
    expect(asked).toContain("@kaitencloud/client@1.0.0");
    expect(rule(results, "@kaitencloud/react-ui react floor").status).toBe("fail");
    expect(rule(results, "@kaitencloud/react-ui react floor").detail).toContain(
      "@kaitencloud/client@1.0.0",
    );
  });

  test("rejects a private same-release React package", async () => {
    const root = workspace();
    write(join(root, "packages/react/package.json"), { ...manifest(root, "react"), private: true });
    const results = await checkDependencyFloors(root, {
      allowUnpublishedWorkspace: true,
      fetchTarball: missing,
    });
    expect(rule(results, "@kaitencloud/react-ui react floor").status).toBe("fail");
    expect(rule(results, "@kaitencloud/react-ui react floor").detail).toContain(
      "must be public @kaitencloud/react@1.0.0",
    );
  });
});
