// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the scripts that look at a package the way a consumer receives it share:
// fetching a published version from npm, packing the one in this tree, unpacking
// a tarball, and running the TypeScript compiler on a project.
//
// Nothing here installs: a tarball is fetched or packed and unpacked, so no
// lifecycle script of any package runs.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The registry, named for the `@kaitencloud` scope as well as for the default.
 * A user-level mapping of the scope to another registry, such as GitHub Packages,
 * outranks `--registry` for a scoped package and would send the fetch there, to a
 * 0.x line that is not the one published.
 */
export const REGISTRY_ARGS = [
  "--registry",
  "https://registry.npmjs.org/",
  "--@kaitencloud:registry=https://registry.npmjs.org/",
];

/** The module resolutions a consumer is likely to compile with. */
export const PROFILES = [
  { name: "nodenext", module: "nodenext", moduleResolution: "nodenext" },
  { name: "bundler", module: "esnext", moduleResolution: "bundler" },
];

/** The subresource-integrity string of a file, as npm prints it: `sha512-` and base64. */
export function integrityOf(file) {
  return `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`;
}

/**
 * Fetches the tarball of a published package (`name@version`) into `into`,
 * which must exist, and returns its path. Nothing is installed.
 */
export function fetchPublishedTarball(spec, into) {
  execFileSync(
    "npm",
    ["pack", spec, ...REGISTRY_ARGS, "--ignore-scripts", "--pack-destination", into],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const tarball = readdirSync(into).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error(`npm pack ${spec} produced no tarball`);
  return join(into, tarball);
}

/** Packs the package in `packageDir` the way the release does, into `into`, and returns the tarball's path. */
export function packWorkspacePackage(packageDir, into) {
  execFileSync("pnpm", ["pack", "--pack-destination", into], {
    cwd: packageDir,
    stdio: ["ignore", "ignore", "pipe"],
  });
  const tarball = readdirSync(into).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error(`pnpm pack in ${packageDir} produced no tarball`);
  return join(into, tarball);
}

/** The paths a tarball holds, `package/` included. */
export function tarballEntries(tarball) {
  return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean);
}

/** One file of a tarball, as text. */
export function tarballFile(tarball, path) {
  return execFileSync("tar", ["-xzOf", tarball, `package/${path}`], { encoding: "utf8" });
}

/** The manifest a consumer of the tarball would read. */
export function tarballManifest(tarball) {
  return JSON.parse(tarballFile(tarball, "package.json"));
}

/**
 * Unpacks a tarball so that it reads as the installed package `name`, below
 * `projectDir/node_modules`, and returns that directory.
 */
export function unpackAsDependency(tarball, projectDir, name) {
  const target = join(projectDir, "node_modules", ...name.split("/"));
  mkdirSync(target, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", target, "--strip-components=1"]);
  return target;
}

/**
 * The TypeScript compilers this repository installs, as `{ name, bin }` where
 * `bin` is a script `node` runs: the workspace's own, which is the native 7, and
 * the 6 the client installs for its code generation. A consumer is more likely on
 * the second today; the declarations have to read for both.
 */
export function typescriptCompilers() {
  const found = [];
  for (const manifest of ["package.json", "packages/client/package.json"]) {
    try {
      const require = createRequire(join(repoRoot, manifest));
      const typescript = dirname(require.resolve("typescript/package.json"));
      const { version } = JSON.parse(readFileSync(join(typescript, "package.json"), "utf8"));
      if (!found.some((compiler) => compiler.version === version)) {
        found.push({ name: `TypeScript ${version}`, version, bin: join(typescript, "bin", "tsc") });
      }
    } catch {
      // That workspace package does not install TypeScript; the others still do.
    }
  }
  return found;
}

/**
 * Runs a compiler on a project and says whether it compiled, with what it
 * printed. `noEmit` is the project's own setting.
 */
export function compile(compiler, project) {
  try {
    // From the project's own directory, so that the paths in the output are short.
    const output = execFileSync(process.execPath, [compiler.bin, "-p", basename(project)], {
      cwd: dirname(project),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() };
  }
}

/**
 * Several compilers and module resolutions often say the same thing about the same
 * file. Groups the failed `results` by what they printed, as `{ output, labels }`,
 * so that it is printed once.
 */
export function distinctOutputs(results, describe) {
  const groups = new Map();
  for (const result of results.filter(({ ok }) => !ok)) {
    const labels = groups.get(result.output) ?? [];
    labels.push(describe(result));
    groups.set(result.output, labels);
  }
  return [...groups].map(([output, labels]) => ({ output, labels }));
}
