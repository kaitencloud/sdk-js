#!/usr/bin/env node
// Checks the published shape of the packages, against the real tarballs.
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
// publint and attw run inside each package's `vp pack` (see its vite.config.ts),
// so they are not repeated here.
//
//   node scripts/check-published-shape.mjs          # build must have run first

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PUBLISHED = ["client", "server"];
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

    if (problems.length > 0) {
      failed = true;
      console.error(`✘ ${name} — ${problems.join("; ")}`);
    } else {
      console.log(
        `✔ ${name} — ${LEGAL_FILES.join(", ")} ship as the root's copies, the manifest is ${LICENSE} with no pnpm-only range`,
      );
    }
  } catch (error) {
    failed = true;
    console.error(`✘ ${name} — could not be packed: ${error.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
