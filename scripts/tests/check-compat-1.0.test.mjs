// The compile check of 1.0 consumers (scripts/check-compat-1.0.mjs), tried on the
// package built from this tree: it passes on the real consumer, and it fails, with
// the compiler's own message, on the two breaks it exists to catch. The tarball of
// 1.0.0 itself is not fetched here; the script does that, in CI.
//
// Needs the build: `vp run -r build`.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { REMOVED_SINCE_1_0, compileConsumers, withoutRemoved } from "../check-compat-1.0.mjs";
import { declaredExports, lostExports } from "../lib/declared-exports.mjs";
import {
  PROFILES,
  packWorkspacePackage,
  repoRoot,
  typescriptCompilers,
  unpackAsDependency,
} from "../lib/npm-package.mjs";

const LONG = 240_000;
let work;
let current;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "kaiten-compat-test-"));
  mkdirSync(join(work, "tarball"));
  current = packWorkspacePackage(join(repoRoot, "packages/client"), join(work, "tarball"));
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/** A directory holding one consumer, written for the occasion. */
function consumerNamed(name, source) {
  const dir = mkdtempSync(join(work, "consumers-"));
  writeFileSync(join(dir, name), source);
  return dir;
}

/** A copy of the current tarball whose declarations `change` has rewritten. */
function changedTarball(label, change) {
  const staging = join(work, `staging-${label}`);
  mkdirSync(staging);
  execFileSync("tar", ["-xzf", current, "-C", staging]);
  const dist = join(staging, "package", "dist");
  for (const file of readdirSync(dist).filter((name) => name.endsWith(".d.mts"))) {
    const path = join(dist, file);
    writeFileSync(path, change(readFileSync(path, "utf8")));
  }
  const out = join(work, `${label}.tgz`);
  execFileSync("tar", ["-czf", out, "-C", staging, "package"]);
  return out;
}

describe("the compile check of 1.0 consumers", () => {
  test(
    "compiles the real consumer against the tree, under every compiler and resolution",
    () => {
      const results = compileConsumers({ workDir: work, label: "tree", tarball: current });

      expect(results).toHaveLength(typescriptCompilers().length * PROFILES.length);
      expect(results.filter((result) => !result.ok).map((result) => result.output)).toEqual([]);
    },
    LONG,
  );

  test(
    "fails on a consumer that uses an export the package does not have",
    () => {
      const consumers = consumerNamed(
        "gone.ts",
        'import { KaitenClient, KaitenNoSuchThing } from "@kaitencloud/client";\nexport { KaitenClient, KaitenNoSuchThing };\n',
      );

      const results = compileConsumers({
        workDir: work,
        label: "missing-export",
        tarball: current,
        consumersDir: consumers,
      });

      expect(results.every((result) => !result.ok)).toBe(true);
      expect(results[0].output).toContain("KaitenNoSuchThing");
    },
    LONG,
  );

  test(
    "fails when the interface a host implements gains a required member",
    () => {
      const grown = changedTarball("grown", (declarations) =>
        declarations.replace(
          /(interface KaitenClientLike \{\n)/,
          "$1  somethingNewAndRequired: () => void;\n",
        ),
      );

      const results = compileConsumers({
        workDir: work,
        label: "grown-interface",
        tarball: grown,
      });

      expect(results.every((result) => !result.ok)).toBe(true);
      expect(results[0].output).toContain("somethingNewAndRequired");
    },
    LONG,
  );

  test(
    "fails when a closed union of 1.0 gains a member",
    () => {
      const grown = changedTarball("widened", (declarations) =>
        declarations.replace(
          'type BillingInterval = "month" | "year" | "one_time";',
          'type BillingInterval = "month" | "year" | "one_time" | "quarter";',
        ),
      );

      const results = compileConsumers({ workDir: work, label: "widened", tarball: grown });

      expect(results.every((result) => !result.ok)).toBe(true);
      expect(results[0].output).toContain("quarter");
    },
    LONG,
  );
});

describe("the list of exports the compile check holds", () => {
  const exportsOf = (tarball, label) =>
    declaredExports(
      unpackAsDependency(tarball, join(work, `unpacked-${label}`), "@kaitencloud/client"),
    );

  test("finds nothing lost in the tree it was read from", () => {
    const names = exportsOf(current, "same");

    expect(names.get(".").size).toBeGreaterThan(100);
    expect(names.get("./testing").size).toBeGreaterThan(10);
    expect(lostExports(names, names)).toEqual([]);
  });

  test("names an export that no fixture uses once it is removed or stops being a value", () => {
    const whole = exportsOf(current, "whole");
    const thinner = changedTarball("thinner", (declarations) =>
      declarations
        .replace(/index_d_exports as KaitenApi,\s/, "")
        .replace(/type Customer,\s/, "")
        .replace(
          "export declare function isPublishableKey(key?: string): boolean;",
          "export type isPublishableKey = (key?: string) => boolean;",
        ),
    );

    const lost = lostExports(whole, exportsOf(thinner, "thinner"));

    expect(lost).toEqual([
      ".: isPublishableKey was a value and is now only a type",
      ".: type Customer is no longer exported",
      ".: value KaitenApi is no longer exported",
    ]);
  });

  test("lets go of MeterType, which 1.1.0 removed on purpose, and of nothing else", () => {
    const published = new Map([
      [
        ".",
        new Map([
          ["MeterType", "type"],
          ["Customer", "type"],
        ]),
      ],
      ["./testing", new Map([["demoCatalog", "value"]])],
    ]);
    const tree = new Map([
      [".", new Map()],
      ["./testing", new Map([["demoCatalog", "value"]])],
    ]);

    expect([...REMOVED_SINCE_1_0.get(".").keys()]).toEqual(["MeterType"]);
    expect(lostExports(withoutRemoved(published), tree)).toEqual([
      ".: type Customer is no longer exported",
    ]);
    expect(published.get(".").has("MeterType")).toBe(true);
  });
});

describe("the command line of the compile check", () => {
  const run = (...args) =>
    spawnSync(process.execPath, [join(repoRoot, "scripts/check-compat-1.0.mjs"), ...args], {
      encoding: "utf8",
    });

  test("refuses an option left without its value, and an argument it does not know", () => {
    const missing = run("--published");
    const unknown = run("--publish", "kaitencloud-client-1.0.0.tgz");

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("--published takes a value");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown argument "--publish"');
  });

  test("refuses a tarball that is not the one npm published, without reaching the registry", () => {
    const notTheTarball = join(work, "not-the-tarball.tgz");
    writeFileSync(notTheTarball, "this is not what npm published");

    const result = run("--published", notTheTarball);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not the one npm published");
    expect(result.stderr).toContain("expected sha512-f4hWzqyh");
  });
});
