#!/usr/bin/env node
// Checks that what this tree would publish can be published, and installed.
//
// Two steps, in the order a release needs them.
//
// 1. The floor of the client. A package that depends on `@kaitencloud/client` is
//    packed with the lowest version of it that satisfies its range, and a
//    workspace range packs as the version the client has in this tree. A host that
//    installs the package gets any client from that floor up, so every name the
//    package imports from the client must exist in the floor itself. This step
//    fetches `@kaitencloud/client` at that floor from npm, unpacks it in a
//    throwaway folder, and compiles the imports the React packages make from it. A
//    floor that is not on npm yet fails too: the client is published first.
//    It has nothing to check until `packages/react` or `packages/react-ui` exist in
//    the tree, and says so.
//
// 2. The shape of the release. For every package that is not private: the license,
//    `publishConfig`, the legal files at the root and in each tarball, the DCO
//    workflow, and no dependency on a package that must not be a dependency (the
//    old 0.x lines, `@kaitencloud/core`), no GitHub Packages anywhere. Each package
//    is packed as the release packs it and handed to `npm publish --dry-run`.
//    A dry run refuses a version npm already has: that is expected until the
//    version pull request has bumped it, and is reported as such, not as a failure.
//
//   node scripts/check-release-dependencies.mjs              # both steps, after `vp run -r build`
//   node scripts/check-release-dependencies.mjs --step 1     # the floor only
//   node scripts/check-release-dependencies.mjs --step 2     # the shape only
//   node scripts/check-release-dependencies.mjs --root <dir> # another tree
//
// Advisory in CI. Blocking in the release procedure, before anything is published.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readArguments } from "./lib/arguments.mjs";
import {
  PROFILES,
  compile,
  distinctOutputs,
  fetchPublishedTarball,
  packWorkspacePackage,
  repoRoot,
  tarballEntries,
  tarballManifest,
  typescriptCompilers,
  unpackAsDependency,
} from "./lib/npm-package.mjs";

const CLIENT = "@kaitencloud/client";
const REGISTRY = "https://registry.npmjs.org";
const LICENSE = "Apache-2.0";
const REACT_PACKAGES = ["react", "react-ui"];
const LEGAL_AT_ROOT = [
  "LICENSE",
  "NOTICE",
  "DCO.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
];
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/** @typedef {{ status: "ok" | "fail" | "skip", rule: string, detail: string }} Result */

const ok = (rule, detail) => ({ status: "ok", rule, detail });
const fail = (rule, detail) => ({ status: "fail", rule, detail });
const skip = (rule, detail) => ({ status: "skip", rule, detail });

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const rootOf = (root, ...parts) => join(root, ...parts);

/** The packages of `packages/*` with a manifest, as `{ dir, name, manifest }`. */
export function workspacePackages(root) {
  const packages = rootOf(root, "packages");
  if (!existsSync(packages)) return [];
  return readdirSync(packages)
    .map((entry) => join(packages, entry))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .map((dir) => {
      const manifest = readJson(join(dir, "package.json"));
      return { dir, name: manifest.name, manifest };
    });
}

/** The ones that are published: not `private`. */
export const publishedPackages = (root) =>
  workspacePackages(root).filter(({ manifest }) => manifest.private !== true);

/**
 * The lowest version a dependency range allows, as `1.2.0`, or `null` when the
 * range names none (`*`, a tag, `catalog:`). A `workspace:` range packs as the
 * version the package has in the tree (`treeVersion`), unless it spells one out.
 */
export function floorOf(range, treeVersion) {
  const workspace = /^workspace:(.*)$/.exec(range);
  if (workspace) {
    const rest = workspace[1];
    if (rest === "" || /^[\^~*]$/.test(rest)) return treeVersion ?? null;
    return floorOf(rest, treeVersion);
  }
  const bare = range.trim().replace(/^(?:[\^~]|>=?|=)\s*v?/, "");
  const match = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(bare);
  if (!match) return null;
  const number = (part) => (part === undefined || !/^\d+$/.test(part) ? "0" : part);
  return `${match[1]}.${number(match[2])}.${number(match[3])}`;
}

const isPublishConfigOk = (config) =>
  config?.access === "public" && String(config?.registry ?? "").replace(/\/$/, "") === REGISTRY;

/** Every file below `dir`, skipping what is not source. */
function filesBelow(dir, skipNames = ["node_modules", "dist", ".git"]) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skipNames.includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(path, skipNames));
    else found.push(path);
  }
  return found;
}

// -- Step 2: the shape of the release ------------------------------------------

/** The files of the repository that may name a registry. */
function registryFiles(root) {
  const files = [];
  for (const name of [".npmrc", "pnpm-workspace.yaml", "pnpm-lock.yaml", "package.json"]) {
    if (existsSync(rootOf(root, name))) files.push(rootOf(root, name));
  }
  const workflows = rootOf(root, ".github/workflows");
  if (existsSync(workflows)) {
    for (const name of readdirSync(workflows)) files.push(join(workflows, name));
  }
  for (const { dir } of workspacePackages(root)) {
    for (const name of ["package.json", ".npmrc"]) {
      if (existsSync(join(dir, name))) files.push(join(dir, name));
    }
  }
  return files;
}

/** Asks npm whether it would accept the tarball. A version npm has is not a failure. */
function npmDryRun(tarball) {
  try {
    execFileSync(
      "npm",
      [
        "publish",
        tarball,
        "--dry-run",
        "--ignore-scripts",
        "--access",
        "public",
        "--tag",
        "dry-run",
        "--registry",
        `${REGISTRY}/`,
        `--@kaitencloud:registry=${REGISTRY}/`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { status: "accepted" };
  } catch (error) {
    const message = `${error.stderr ?? ""}${error.stdout ?? ""}`;
    if (/cannot publish over the previously published versions/i.test(message)) {
      return { status: "published" };
    }
    return { status: "refused", message: message.trim().split("\n").slice(-6).join("\n") };
  }
}

/**
 * The rules of a release that need no network, then each package's tarball and
 * dry run. `pack` and `dryRun` are what the checks use to reach a tarball and npm;
 * the tests replace them.
 *
 * @returns {Result[]}
 */
export function checkReleaseShape(root, { pack = packWorkspacePackage, dryRun = npmDryRun } = {}) {
  /** @type {Result[]} */
  const results = [];
  const packages = publishedPackages(root);
  const privateNames = new Set(
    workspacePackages(root)
      .filter(({ manifest }) => manifest.private === true)
      .map(({ name }) => name),
  );

  if (packages.length === 0) {
    return [fail("published packages", "packages/* holds no package that is not private")];
  }

  // Legal files at the root.
  const missing = LEGAL_AT_ROOT.filter(
    (name) => !existsSync(rootOf(root, name)) || statSync(rootOf(root, name)).size === 0,
  );
  if (missing.length > 0) {
    results.push(fail("legal files", `missing or empty at the root: ${missing.join(", ")}`));
  } else {
    const text = (name) => readFileSync(rootOf(root, name), "utf8");
    const wrong = [];
    if (!/Apache License/.test(text("LICENSE")) || !/Version 2\.0/.test(text("LICENSE"))) {
      wrong.push("LICENSE is not the Apache License, Version 2.0");
    }
    if (!/Developer Certificate of Origin/.test(text("DCO.md"))) {
      wrong.push("DCO.md is not the Developer Certificate of Origin");
    }
    if (!/Signed-off-by/.test(text("CONTRIBUTING.md"))) {
      wrong.push("CONTRIBUTING.md does not ask for a Signed-off-by");
    }
    results.push(
      wrong.length > 0
        ? fail("legal files", wrong.join("; "))
        : ok("legal files", `${LEGAL_AT_ROOT.join(", ")} are at the root`),
    );
  }

  // The DCO workflow.
  const dco = rootOf(root, ".github/workflows/dco.yml");
  if (!existsSync(dco)) {
    results.push(fail("DCO workflow", ".github/workflows/dco.yml does not exist"));
  } else {
    const text = readFileSync(dco, "utf8");
    results.push(
      /^name:\s*DCO\s*$/m.test(text) && /pull_request_target/.test(text)
        ? ok("DCO workflow", "dco.yml runs a check named DCO on pull requests")
        : fail(
            "DCO workflow",
            "dco.yml must be a workflow named DCO that runs on pull_request_target",
          ),
    );
  }

  // No GitHub Packages, anywhere a registry can be named.
  const github = registryFiles(root)
    .filter((file) => readFileSync(file, "utf8").includes("npm.pkg.github.com"))
    .map((file) => relative(root, file));
  results.push(
    github.length > 0
      ? fail("registry", `GitHub Packages is named in ${github.join(", ")}`)
      : ok("registry", "no file names GitHub Packages; the packages publish to registry.npmjs.org"),
  );

  // No resolution of the private 0.x lines in the lockfile.
  const lock = rootOf(root, "pnpm-lock.yaml");
  if (existsSync(lock)) {
    const old = [
      ...new Set(
        [
          ...readFileSync(lock, "utf8").matchAll(/@kaitencloud\/([a-z-]+)@(0\.[0-9][^\s:'"()]*)/g),
        ].map((match) => `@kaitencloud/${match[1]}@${match[2]}`),
      ),
    ];
    results.push(
      old.length > 0
        ? fail("lockfile", `resolves a 0.x line of the Kaiten packages: ${old.join(", ")}`)
        : ok("lockfile", "no 0.x line of a Kaiten package is resolved"),
    );
  }

  for (const { dir, name, manifest } of packages) {
    const label = name;
    const wrong = [];
    if (manifest.license !== LICENSE) wrong.push(`license is ${JSON.stringify(manifest.license)}`);
    if (!isPublishConfigOk(manifest.publishConfig)) {
      wrong.push(`publishConfig must be { access: "public", registry: "${REGISTRY}/" }`);
    }
    for (const field of DEPENDENCY_FIELDS) {
      for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
        if (dependency === "@kaitencloud/core") wrong.push(`${field} names @kaitencloud/core`);
        if (privateNames.has(dependency))
          wrong.push(`${field} names ${dependency}, which is private`);
        if (dependency.startsWith("@kaitencloud/") && !range.startsWith("workspace:")) {
          const floor = floorOf(range);
          if (floor === null || Number(floor.split(".")[0]) < 1) {
            wrong.push(`${field}.${dependency} is ${JSON.stringify(range)}, below 1.0.0`);
          }
        }
      }
    }
    const licenseFile = join(dir, "LICENSE");
    if (existsSync(licenseFile) && /^\s*MIT License/i.test(readFileSync(licenseFile, "utf8"))) {
      wrong.push("its LICENSE is the MIT license");
    }
    results.push(
      wrong.length > 0
        ? fail(`${label} manifest`, wrong.join("; "))
        : ok(
            `${label} manifest`,
            `${LICENSE}, publishConfig to ${REGISTRY}, no dependency it must not have`,
          ),
    );

    // The tarball, as the release packs it.
    const into = mkdtempSync(join(tmpdir(), "kaiten-release-"));
    try {
      let tarball;
      try {
        tarball = pack(dir, into);
      } catch (error) {
        results.push(
          fail(
            `${label} tarball`,
            `could not be packed: ${String(error.stderr ?? error.message).trim()}`,
          ),
        );
        continue;
      }
      const entries = tarballEntries(tarball);
      const absent = ["LICENSE", "NOTICE"].filter((file) => !entries.includes(`package/${file}`));
      const packed = tarballManifest(tarball);
      const problems = [];
      if (absent.length > 0) problems.push(`lacks ${absent.join(" and ")}`);
      for (const field of [...DEPENDENCY_FIELDS, "devDependencies"]) {
        for (const [dependency, range] of Object.entries(packed[field] ?? {})) {
          if (/^(workspace|catalog):/.test(range)) {
            problems.push(`${field}.${dependency} is still "${range}"`);
          } else if (dependency.startsWith("@kaitencloud/") && field !== "devDependencies") {
            // What a host installs: a Kaiten package below 1.0.0 is the private line.
            const floor = floorOf(range);
            if (floor === null || Number(floor.split(".")[0]) < 1) {
              problems.push(`${field}.${dependency} is ${JSON.stringify(range)}, below 1.0.0`);
            }
          }
        }
      }
      if (packed.license !== LICENSE)
        problems.push(`its manifest says license ${JSON.stringify(packed.license)}`);
      results.push(
        problems.length > 0
          ? fail(`${label} tarball`, problems.join("; "))
          : ok(
              `${label} tarball`,
              `holds LICENSE and NOTICE; its manifest has no workspace or catalog range`,
            ),
      );

      const dry = dryRun(tarball);
      if (dry.status === "accepted") {
        results.push(
          ok(`${label} dry run`, `npm publish --dry-run accepts ${packed.name}@${packed.version}`),
        );
      } else if (dry.status === "published") {
        results.push(
          skip(
            `${label} dry run`,
            `npm already has ${packed.name}@${packed.version}; the dry run is meaningful once the version pull request has bumped it`,
          ),
        );
      } else {
        results.push(fail(`${label} dry run`, dry.message));
      }
    } finally {
      rmSync(into, { recursive: true, force: true });
    }
  }

  return results;
}

// -- Step 1: the floor of the client ---------------------------------------------

/** The `import ... from "@kaitencloud/client"` statements of the `.ts` and `.tsx` files of a source directory. */
export function clientImports(srcDir) {
  const statements = new Set();
  const pattern =
    /\b(?:import|export)\s+(?:type\s+)?[^;'"]*?\bfrom\s+["'](@kaitencloud\/client(?:\/[A-Za-z0-9_-]+)?)["']/g;
  for (const file of filesBelow(srcDir)) {
    if (!/\.(ts|tsx)$/.test(file) || file.endsWith(".d.ts")) continue;
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
      statements.add(`${match[0].replace(/\s+/g, " ").trim()};`);
    }
  }
  // By code point, so that the order does not depend on the machine's locale.
  return [...statements].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** What `npm pack` said when the version is not there, as opposed to the registry not answering. */
const notOnNpm = (error) =>
  /E404|404 Not Found|No match found for version/i.test(String(error.stderr ?? error.message));

/**
 * Compiles the imports the React packages make from the client against the client
 * at the floor of their range, fetched from npm. `fetchTarball` is how a version
 * reaches the check; the tests replace it.
 *
 * @returns {Promise<Result[]>}
 */
export async function checkClientFloor(root, { fetchTarball = fetchPublishedTarball } = {}) {
  const present = workspacePackages(root).filter(({ manifest }) =>
    REACT_PACKAGES.some((name) => manifest.name === `@kaitencloud/${name}`),
  );
  if (present.length === 0) {
    return [
      skip(
        "client floor",
        "skipped: packages/react and packages/react-ui are not in this tree, so nothing imports the client yet",
      ),
    ];
  }

  const clientManifest = existsSync(rootOf(root, "packages/client/package.json"))
    ? readJson(rootOf(root, "packages/client/package.json"))
    : undefined;
  const treeVersion = clientManifest?.version;

  /** @type {Result[]} */
  const results = [];
  const work = mkdtempSync(join(tmpdir(), "kaiten-floor-"));
  try {
    for (const { dir, name, manifest } of present) {
      const rule = `${name} client floor`;
      const imports = clientImports(join(dir, "src"));
      const range =
        manifest.peerDependencies?.[CLIENT] ??
        manifest.dependencies?.[CLIENT] ??
        manifest.optionalDependencies?.[CLIENT];

      if (range === undefined) {
        results.push(
          imports.length > 0
            ? fail(rule, `imports ${CLIENT} but declares no dependency or peer dependency on it`)
            : skip(rule, `${name} does not import ${CLIENT}`),
        );
        continue;
      }
      const floor = floorOf(range, treeVersion);
      if (floor === null) {
        results.push(
          fail(rule, `${CLIENT} is ${JSON.stringify(range)}, which has no lowest version to check`),
        );
        continue;
      }
      if (imports.length === 0) {
        results.push(skip(rule, `${name} does not import ${CLIENT}`));
        continue;
      }

      const project = join(work, name.replace(/[^a-z0-9]+/gi, "-"));
      mkdirSync(join(project, "probe"), { recursive: true });
      writeFileSync(join(project, "package.json"), '{ "type": "module" }\n');
      const into = join(project, "tarball");
      mkdirSync(into);
      let tarball;
      try {
        tarball = fetchTarball(`${CLIENT}@${floor}`, into);
      } catch (error) {
        results.push(
          fail(
            rule,
            notOnNpm(error)
              ? `${CLIENT}@${floor}, the floor of ${name}, is not on npm: publish the client before ${name}`
              : `${CLIENT}@${floor} could not be fetched from npm: ${String(error.stderr ?? error.message).trim()}`,
          ),
        );
        continue;
      }
      unpackAsDependency(tarball, project, CLIENT);
      writeFileSync(join(project, "probe", "imports.ts"), `${imports.join("\n")}\n`);

      const attempts = [];
      for (const profile of PROFILES) {
        const config = join(project, `tsconfig.${profile.name}.json`);
        writeFileSync(
          config,
          JSON.stringify({
            compilerOptions: {
              target: "es2023",
              lib: ["es2023", "dom"],
              module: profile.module,
              moduleResolution: profile.moduleResolution,
              strict: true,
              noEmit: true,
              types: [],
              skipLibCheck: true,
            },
            include: ["probe/*.ts"],
          }),
        );
        for (const compiler of typescriptCompilers()) {
          attempts.push({
            ...compile(compiler, config),
            compiler: compiler.name,
            profile: profile.name,
          });
        }
      }
      const problems = distinctOutputs(
        attempts,
        ({ compiler, profile }) => `${compiler}, ${profile} resolution`,
      ).map(({ output, labels }) => `${labels.join("; ")}:\n${output.replace(/^/gm, "    ")}`);
      results.push(
        problems.length > 0
          ? fail(
              rule,
              `${name} imports from ${CLIENT} what ${CLIENT}@${floor}, its floor, does not export:\n${problems.join("\n")}`,
            )
          : ok(
              rule,
              `the ${imports.length} import(s) of ${name} compile against ${CLIENT}@${floor}, its floor`,
            ),
      );
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return results;
}

// -- The command -------------------------------------------------------------------

function print(results) {
  let failed = false;
  for (const { status, rule, detail } of results) {
    if (status === "fail") failed = true;
    const mark = status === "ok" ? "✔" : status === "skip" ? "○" : "✘";
    const out = status === "fail" ? console.error : console.log;
    out(`${mark} ${rule}: ${detail}`);
  }
  return failed;
}

async function main() {
  let root = repoRoot;
  let step;
  try {
    const { values } = readArguments(process.argv.slice(2), { options: ["--root", "--step"] });
    if (values["--root"][0] !== undefined) root = resolve(values["--root"][0]);
    step = values["--step"][0];
    if (step !== undefined && step !== "1" && step !== "2") throw new Error("--step takes 1 or 2.");
  } catch (error) {
    console.error(`✘ ${error.message}`);
    process.exit(1);
  }

  let failed = false;
  if (step !== "2") {
    console.log("Step 1: the floor of the client");
    failed = print(await checkClientFloor(root)) || failed;
  }
  if (step !== "1") {
    if (!existsSync(rootOf(root, "packages/client/dist"))) {
      console.error("✘ packages/client/dist is missing: run `vp run -r build` first.");
      process.exit(1);
    }
    console.log("Step 2: the shape of the release");
    failed = print(checkReleaseShape(root)) || failed;
  }
  if (failed) {
    console.error("\nThe release is not ready: the findings above say why.");
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
