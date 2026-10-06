#!/usr/bin/env node
// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Checks the published shape of the packages, against the real tarballs.
//
// publint and attw: @kaitencloud/react-ui cannot run them inside `vp pack`, because
// its CSS subpath (`./styles.css`) is emitted by a `build:done` hook that fires
// AFTER pack validation — both validators would inspect a dist without the file
// and fail. So the check runs after the build instead: `pnpm pack` produces
// exactly the tarball that would be published, CSS included, and both validators
// run against it. @kaitencloud/react is held to the same bar; the other packages
// keep their in-pack validation, and duplicating it here would only make a
// failure appear twice.
//
// Legal files: every published package must ship its LICENSE, its NOTICE and
// its THIRD_PARTY_NOTICES.md, each identical to the repository root's. pnpm
// copies a workspace-root LICENSE into a tarball and npm does not, and neither
// copies the other two, so each package keeps its own copies and this proves
// they ship and have not drifted from the root.
//
// Manifest: the packed package.json is what npm serves to every consumer. Its
// license must be Apache-2.0, and no dependency range may be left as a
// `catalog:` or `workspace:` protocol: only pnpm resolves those, and only inside
// this workspace, so anyone else would get a manifest they cannot install from.
//
// For @kaitencloud/client and @kaitencloud/server, publint and attw run inside
// `vp pack` (see each vite.config.ts), so they are not repeated here.
//
// Private packages: @kaitencloud/react and @kaitencloud/react-ui are
// `"private": true` until Kaiten billing ships, so nothing publishes them. They
// are checked all the same, as the tarball they will ship, so that making them
// public is a one-line change and not the first time their shape is looked at.
// While private, each must keep the `publishConfig` a public package carries
// (public access, the npm registry), and its packed manifest must still say
// `private`, which makes `npm publish` refuse the tarball.
//
//   node scripts/check-published-shape.mjs          # build must have run first

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPackage, createPackageFromTarballData } from "@arethetypeswrong/core";
import { publint } from "publint";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ESM-only by design, like @kaitencloud/client: supporting `require` would mean
 * dual-building the whole chain. Only @kaitencloud/server, which runs on a
 * backend, is dual-built. Same rule client/vite.config.ts ignores.
 */
const ATTW_IGNORED_KINDS = new Set(["CJSResolvesToESM"]);

/**
 * The two `NoResolution` cases that are the declared shape rather than a defect:
 *
 * - a `.css` subpath carries no types at all, so attw reporting it under every
 *   resolution mode is the tool describing CSS;
 * - a JS subpath under **node10**, whose resolver predates `exports` and cannot
 *   see subpaths. `@kaitencloud/client` already declares that trade-off.
 *
 * Deliberately narrower than the blanket `no-resolution` ignore the in-pack
 * validators have to use, since those cannot filter by entrypoint or mode: the
 * same problem on a JS subpath under node16 or bundler — a genuinely broken
 * entrypoint — still fails here.
 */
function isExpectedProblem(problem) {
  if (ATTW_IGNORED_KINDS.has(problem.kind)) return true;
  if (problem.kind !== "NoResolution") return false;
  if (String(problem.entrypoint ?? "").endsWith(".css")) return true;
  return problem.resolutionKind === "node10";
}

/** The packages whose `vp pack` cannot validate them, checked here instead. */
const VALIDATED_HERE = ["react", "react-ui"];

/** Every package this repository ships, or will once it stops being private. */
const PUBLISHED = ["client", "server", "react", "react-ui"];
const NPM_REGISTRY = "https://registry.npmjs.org/";
const LICENSE = "Apache-2.0";
const LEGAL_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/** What is wrong with a packed manifest, as a list of short findings. */
function manifestProblems(manifest) {
  const problems = [];
  if (manifest.license !== LICENSE) {
    problems.push(`license is ${JSON.stringify(manifest.license)}, not "${LICENSE}"`);
  }
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (/^(catalog|workspace):/.test(range)) {
        problems.push(`${field}.${name} is still "${range}"`);
      }
    }
  }
  return problems;
}

let failed = false;

for (const dir of PUBLISHED) {
  const pkgDir = resolve(repoRoot, "packages", dir);
  const name = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).name;
  const tmp = mkdtempSync(join(tmpdir(), "kaiten-pack-"));

  try {
    execFileSync("pnpm", ["pack", "--pack-destination", tmp], {
      cwd: pkgDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const tarball = readdirSync(tmp).find((file) => file.endsWith(".tgz"));
    if (!tarball) throw new Error("pnpm pack produced no tarball");
    const tarballPath = join(tmp, tarball);

    const entries = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" }).split("\n");
    const problems = [];
    for (const file of LEGAL_FILES) {
      if (!entries.includes(`package/${file}`)) {
        problems.push(`the tarball lacks ${file}`);
        continue;
      }
      const shipped = execFileSync("tar", ["-xzOf", tarballPath, `package/${file}`], {
        encoding: "utf8",
      });
      if (shipped !== readFileSync(join(repoRoot, file), "utf8")) {
        problems.push(`its ${file} differs from the repository root's`);
      }
    }

    const manifest = JSON.parse(
      execFileSync("tar", ["-xzOf", tarballPath, "package/package.json"], { encoding: "utf8" }),
    );
    problems.push(...manifestProblems(manifest));
    const held = manifest.private === true;
    if (held) {
      const { publishConfig = {} } = manifest;
      if (publishConfig.access !== "public" || publishConfig.registry !== NPM_REGISTRY) {
        problems.push(
          `it is private, and its publishConfig must still be { access: "public", registry: "${NPM_REGISTRY}" } for the day it is not`,
        );
      }
    }

    if (VALIDATED_HERE.includes(dir)) {
      // publint reads the package directory, attw the tarball bytes.
      const { messages } = await publint({ pkgDir, level: "warning" });
      if (messages.length > 0) {
        const { formatMessage } = await import("publint/utils");
        const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
        for (const message of messages) {
          problems.push(`publint: ${formatMessage(message, pkgJson) ?? message.code}`);
        }
      }

      const attwPackage = createPackageFromTarballData(new Uint8Array(readFileSync(tarballPath)));
      const result = await checkPackage(attwPackage);
      for (const problem of (result.problems ?? []).filter((p) => !isExpectedProblem(p))) {
        problems.push(
          `attw: ${problem.kind}${problem.entrypoint ? ` at ${problem.entrypoint}` : ""}`,
        );
      }
    }

    if (problems.length > 0) {
      failed = true;
      console.error(`✘ ${name} — ${problems.join("; ")}`);
    } else {
      const validated = VALIDATED_HERE.includes(dir) ? ", publint and attw clean" : "";
      const status = held ? " (private: not published until it is made public)" : "";
      console.log(
        `✔ ${name}${status} — ${LEGAL_FILES.join(", ")} ship as the root's copies, the manifest is ${LICENSE} with no pnpm-only range${validated}`,
      );
    }
  } catch (error) {
    failed = true;
    console.error(`✘ ${name} — could not be packed or validated: ${error.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
