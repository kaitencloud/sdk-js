#!/usr/bin/env node
// Fails when packages that must move together have drifted apart.
//
// Every rule here encodes a breakage that actually reached CI. A bulk dependency
// update satisfies each package's own semver range and still breaks the build,
// because these constraints live between packages and no tool knows them:
//
//   - `typescript` was bumped 5 -> 7. Both are valid for every declared range, but
//     typescript@7 is the native port and does not expose the compiler's JS API,
//     so `vp run generate` died on `ts.SyntaxKind`.
//   - `vite-plus` moved 0.1.x -> 0.2.x while the `vitest` catalog entry stayed on
//     the 0.1-era `npm:@voidzero-dev/vite-plus-test` shim, which ships no `vitest`
//     bin. `vp test` could not resolve a runner at all.
//   - `@typescript/native-preview` was dropped while six vite configs still set
//     `tsgo: true`, leaving dts generation without the binary it asks for.
//   - vite-plus 0.3 ships tsdown 0.23, which turned `dts.tsgo` into an options
//     object, so the old `tsgo: true` crashed every build.
//   - Dependabot moved `@vitest/browser-playwright`, pinned by hand in react-ui, to
//     5.0.0 while vite-plus still bundled Vitest 4.1.11. Only the test run noticed.
//
// Each check states what it protects, so a future bump gets a diagnosis instead of
// a stack trace. Runs in milliseconds and needs no install, so it is cheap enough
// to sit in `pnpm ready`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(resolve(repoRoot, relativePath), "utf8");

const workspace = read("pnpm-workspace.yaml");
const failures = [];
const passed = [];

const fail = (rule, detail) => failures.push({ rule, detail });
const pass = (rule, detail) => passed.push({ rule, detail });

/** A `  key: value` entry from the workspace catalog. */
const catalogEntry = (key) => {
  const pattern = new RegExp(`^\\s{2}"?${key.replace(/[/@.]/g, "\\$&")}"?:\\s*(.+?)\\s*$`, "m");
  return pattern.exec(workspace)?.[1]?.replace(/^["']|["']$/g, "");
};

/** The lines under a top-level `name:` key of the workspace, up to the next one. */
const topLevelBlock = (name) => {
  const lines = workspace.split("\n");
  const start = lines.indexOf(`${name}:`);
  if (start < 0) return [];
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !/^\s/.test(line)) break;
    block.push(line);
  }
  return block;
};

/** A `    key: value` entry from a named catalog under `catalogs:`. */
const namedCatalogEntry = (catalog, key) => {
  const lines = topLevelBlock("catalogs");
  const start = lines.indexOf(`  ${catalog}:`);
  if (start < 0) return undefined;
  for (const line of lines.slice(start + 1)) {
    if (!/^\s{4}/.test(line)) break;
    const match = new RegExp(`^\\s{4}"?${key.replace(/[/@.]/g, "\\$&")}"?:\\s*(.+?)\\s*$`).exec(
      line,
    );
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return undefined;
};

/** The TypeScript version a package installs, through the catalog it names. */
const typescriptOf = (manifest) => {
  const spec = manifest.devDependencies?.typescript ?? manifest.dependencies?.typescript;
  if (spec === "catalog:" || spec === "catalog:default") return catalogEntry("typescript");
  const named = /^catalog:(.+)$/.exec(spec ?? "")?.[1];
  return named ? namedCatalogEntry(named, "typescript") : spec;
};

const majorOf = (version) => Number(/(\d+)/.exec(version ?? "")?.[1]) || 0;

// ---------------------------------------------------------------------------
// 1. The `vite` alias must name the same release as `vite-plus`.
//    vite-plus resolves its own core through this alias; a mismatch silently runs
//    two different Vite cores against one config.
// ---------------------------------------------------------------------------
{
  const vitePlus = catalogEntry("vite-plus");
  const viteAlias = catalogEntry("vite");
  const aliased = /@voidzero-dev\/vite-plus-core@(.+)$/.exec(viteAlias ?? "")?.[1];

  if (!vitePlus || !aliased) {
    fail(
      "vite alias",
      `could not read both catalog entries (vite-plus=${vitePlus}, vite=${viteAlias})`,
    );
  } else if (aliased !== vitePlus) {
    fail(
      "vite alias",
      `catalog vite -> vite-plus-core@${aliased} but vite-plus is ${vitePlus}; ` +
        `pin both to the same release`,
    );
  } else {
    pass("vite alias", `vite-plus-core@${aliased} matches vite-plus`);
  }
}

// ---------------------------------------------------------------------------
// 2. The `vitest` catalog entry must be the exact version vite-plus bundles.
//    vite-plus re-exports upstream vitest under `vite-plus/test`; the pin also
//    applies to vite-plus's own dependency, so a stale pin splits Vitest's
//    internals (mocks, expect, runner state) across two copies.
// ---------------------------------------------------------------------------
{
  const pinned = catalogEntry("vitest");
  const vitePlusManifest = resolve(repoRoot, "node_modules/vite-plus/package.json");

  if (!existsSync(vitePlusManifest)) {
    pass("vitest pin", "skipped — vite-plus is not installed");
  } else {
    const bundled = JSON.parse(readFileSync(vitePlusManifest, "utf8")).dependencies?.vitest;
    if (pinned?.startsWith("npm:")) {
      fail(
        "vitest pin",
        `catalog vitest is the 0.1-era shim (${pinned}), which ships no vitest bin. ` +
          `vite-plus ${bundled ? `bundles vitest@${bundled}` : "bundles upstream vitest"} — pin that instead`,
      );
    } else if (bundled && pinned !== bundled) {
      fail("vitest pin", `catalog vitest is ${pinned} but vite-plus bundles ${bundled}`);
    } else {
      pass("vitest pin", `vitest@${pinned} matches the version vite-plus bundles`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2b. Every @vitest/* package comes from the catalog, at the Vitest vite-plus bundles.
//     They publish in lockstep with Vitest, and a provider or coverage package from
//     another release breaks `vp test` at startup. Dependabot leaves them to
//     `vp migrate`, so a pin written into a manifest would drift unseen.
//     @vitest/eslint-plugin and @vitest/coverage-c8 follow their own release lines.
// ---------------------------------------------------------------------------
{
  const ownLine = new Set(["@vitest/eslint-plugin", "@vitest/coverage-c8"]);
  const vitePlusManifest = resolve(repoRoot, "node_modules/vite-plus/package.json");
  const bundled = existsSync(vitePlusManifest)
    ? JSON.parse(readFileSync(vitePlusManifest, "utf8")).dependencies?.vitest
    : undefined;
  const problems = [];

  const cataloged = topLevelBlock("catalog").flatMap((line) => {
    const match = /^\s{2}"?(@vitest\/[\w.-]+)"?:\s*(.+?)\s*$/.exec(line);
    return match && !ownLine.has(match[1])
      ? [[match[1], match[2].replace(/^["']|["']$/g, "")]]
      : [];
  });
  if (bundled) {
    for (const [name, version] of cataloged) {
      if (version !== bundled) problems.push(`catalog ${name} is ${version}`);
    }
  }

  const manifests = ["packages", "examples"].flatMap((dir) =>
    readdirSync(resolve(repoRoot, dir)).map((name) => `${dir}/${name}/package.json`),
  );
  for (const path of ["package.json", ...manifests]) {
    if (!existsSync(resolve(repoRoot, path))) continue;
    const manifest = JSON.parse(read(path));
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        if (!name.startsWith("@vitest/") || ownLine.has(name)) continue;
        if (spec !== "catalog:" && spec !== "catalog:default") {
          problems.push(`${path} declares ${name} as ${spec} instead of catalog:`);
        }
      }
    }
  }

  if (problems.length > 0) {
    fail(
      "vitest ecosystem",
      `${problems.join("; ")}. vite-plus bundles vitest@${bundled ?? "?"}: pin every ` +
        `@vitest/* package to it, through the catalog`,
    );
  } else {
    pass(
      "vitest ecosystem",
      bundled
        ? `${cataloged.map(([name]) => name).join(", ") || "no @vitest/* entry"} at vitest@${bundled}`
        : "versions skipped — vite-plus is not installed",
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Each package emits declarations with a generator it can run.
//    tsdown 0.23 rejects `dts.tsgo: true`, so every package names
//    `dts.generator`. `tsgo` comes from the workspace root's typescript@7, which
//    scripts/tsgo-path.mjs resolves whichever vite-plus instance runs the build.
//    `tsc` needs the package's own JS-based typescript, 6 or older.
//    @typescript/native-preview is retired: typescript@7 ships tsgo itself.
// ---------------------------------------------------------------------------
{
  const problems = [];
  const seen = [];
  const rootTypescript = typescriptOf(JSON.parse(read("package.json")));
  for (const pkg of readdirSync(resolve(repoRoot, "packages"))) {
    const config = resolve(repoRoot, "packages", pkg, "vite.config.ts");
    const manifestPath = resolve(repoRoot, "packages", pkg, "package.json");
    if (!existsSync(config) || !existsSync(manifestPath)) continue;
    const source = readFileSync(config, "utf8");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    if ("@typescript/native-preview" in deps) {
      problems.push(`${pkg} depends on @typescript/native-preview; typescript@7 ships tsgo`);
    }
    if (/\btsgo:\s*true/.test(source)) {
      problems.push(`${pkg} sets dts.tsgo: true, which tsdown 0.23 rejects; set dts.generator`);
    }
    const generator = /\bgenerator:\s*["'](\w+)["']/.exec(source)?.[1];
    if (!generator) continue;
    const typescript = typescriptOf(manifest);
    const major = majorOf(typescript);
    if (generator === "tsgo" && majorOf(rootTypescript) < 7) {
      problems.push(
        `${pkg} emits declarations with tsgo, taken from the workspace root, which ` +
          `installs typescript ${rootTypescript ?? "none"}; install typescript@7 there`,
      );
    } else if (generator === "tsc" && (major === 0 || major >= 7)) {
      problems.push(
        `${pkg} emits declarations with tsc but installs typescript ${typescript ?? "none"}; ` +
          `tsc needs typescript 6 or older`,
      );
    }
    seen.push(`${pkg} ${generator} on ${generator === "tsgo" ? rootTypescript : typescript}`);
  }
  if (catalogEntry("@typescript/native-preview")) {
    problems.push("the catalog still lists @typescript/native-preview");
  }

  if (problems.length > 0) {
    fail("declaration generator", problems.join("; "));
  } else {
    pass("declaration generator", seen.join(", ") || "no package names a generator");
  }
}

// ---------------------------------------------------------------------------
// 4. Packages that run openapi-ts take TypeScript 6 from the `codegen` catalog.
//    openapi-ts drives the TypeScript JS compiler API (ts.SyntaxKind …).
//    typescript@7 satisfies its declared peer range and still crashes it at
//    runtime — semver cannot express this, so it is asserted here. A workspace
//    `typescript` override would pull these packages back onto 7.
// ---------------------------------------------------------------------------
{
  const generators = readdirSync(resolve(repoRoot, "packages")).filter((pkg) =>
    existsSync(resolve(repoRoot, "packages", pkg, "openapi-ts.config.js")),
  );
  const codegen = namedCatalogEntry("codegen", "typescript");
  const offCatalog = generators.filter((pkg) => {
    const manifest = JSON.parse(read(`packages/${pkg}/package.json`));
    const spec = manifest.devDependencies?.typescript ?? manifest.dependencies?.typescript;
    return spec !== "catalog:codegen";
  });
  const overridden = topLevelBlock("overrides").some((line) => /^\s{2}"?typescript"?:/.test(line));

  if (generators.length === 0) {
    pass("openapi-ts typescript", "no package runs openapi-ts");
  } else if (!codegen) {
    fail(
      "openapi-ts typescript",
      `${generators.join(", ")} run openapi-ts, but no codegen catalog pins typescript`,
    );
  } else if (majorOf(codegen) >= 7) {
    fail(
      "openapi-ts typescript",
      `the codegen catalog pins typescript ${codegen}, the native port, which has no JS ` +
        `compiler API. Keep it on 6.x`,
    );
  } else if (offCatalog.length > 0) {
    fail(
      "openapi-ts typescript",
      `${offCatalog.join(", ")} run openapi-ts without typescript from catalog:codegen`,
    );
  } else if (overridden) {
    fail(
      "openapi-ts typescript",
      "a workspace typescript override forces one version onto every package, codegen included",
    );
  } else {
    pass(
      "openapi-ts typescript",
      `${generators.join(", ")} run openapi-ts on typescript ${codegen}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. The Playwright container image must match the pinned @playwright/test.
//    Visual baselines are rendered inside that image. If the tag drifts from the
//    pin, every snapshot silently re-renders against a different browser build and
//    the diff is blamed on the change under review.
// ---------------------------------------------------------------------------
{
  const pinned = catalogEntry("@playwright/test");
  const workflowsDir = resolve(repoRoot, ".github/workflows");
  const mismatched = [];
  let found = 0;

  for (const file of readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))) {
    const contents = readFileSync(join(workflowsDir, file), "utf8");
    for (const [, tag] of contents.matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)-/g)) {
      found += 1;
      if (tag !== pinned) mismatched.push(`${file} uses v${tag}`);
    }
  }

  if (found === 0) {
    pass("playwright image", "no workflow pins a Playwright container");
  } else if (mismatched.length > 0) {
    fail(
      "playwright image",
      `@playwright/test is pinned to ${pinned} but ${mismatched.join(", ")}. ` +
        `Visual baselines are rendered in that image — bump the tag with the package`,
    );
  } else {
    pass("playwright image", `${found} container tag(s) match @playwright/test ${pinned}`);
  }
}

// ---------------------------------------------------------------------------
// 5b. Any `playwright@x.y.z` hardcoded in a package script must match the pin.
//     `test:browsers:install` downloads browsers by explicit version; when it lags
//     the pin it installs a build the test run will not use, so the install looks
//     to have succeeded and the run still downloads (or fails).
// ---------------------------------------------------------------------------
{
  const pinned = catalogEntry("@playwright/test");
  const mismatched = [];
  let found = 0;

  for (const pkg of [
    "",
    ...readdirSync(resolve(repoRoot, "packages")).map((p) => `packages/${p}`),
  ]) {
    const manifest = resolve(repoRoot, pkg, "package.json");
    if (!existsSync(manifest)) continue;
    const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};
    for (const [name, body] of Object.entries(scripts)) {
      for (const [, version] of String(body).matchAll(/\bplaywright@([\d.]+)/g)) {
        found += 1;
        if (version !== pinned) mismatched.push(`${pkg || "."}#${name} pins ${version}`);
      }
    }
  }

  if (found === 0) {
    pass("playwright script pin", "no script hardcodes a Playwright version");
  } else if (mismatched.length > 0) {
    fail("playwright script pin", `@playwright/test is ${pinned} but ${mismatched.join(", ")}`);
  } else {
    pass("playwright script pin", `${found} script pin(s) match @playwright/test ${pinned}`);
  }
}

// ---------------------------------------------------------------------------
// 6. No workflow pins the global `vp`.
//    Without a `version:`, setup-vp installs the vite-plus version the catalog
//    names, so every job runs the project's Vite+. A pin drifts: the workflows sat
//    on vp 0.1.24 while the project moved to 0.3.
// ---------------------------------------------------------------------------
{
  const workflowsDir = resolve(repoRoot, ".github/workflows");
  const pinned = [];
  let steps = 0;

  for (const file of readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))) {
    const contents = readFileSync(join(workflowsDir, file), "utf8");
    // The lines of a setup-vp step, up to the next step.
    for (const [, body] of contents.matchAll(
      /voidzero-dev\/setup-vp@[^\n]*\n((?:(?![ \t]*- )[^\n]*\n)*)/g,
    )) {
      steps += 1;
      const version = /^\s+version:\s*(\S+)/m.exec(body)?.[1];
      if (version) pinned.push(`${file} pins ${version}`);
    }
  }

  const vitePlus = catalogEntry("vite-plus");
  if (pinned.length > 0) {
    fail(
      "setup-vp pin",
      `${pinned.join(", ")}. Drop \`version:\` so setup-vp installs vite-plus ${vitePlus} from ` +
        `the catalog`,
    );
  } else {
    pass(
      "setup-vp pin",
      steps
        ? `${steps} setup-vp step(s) install vite-plus ${vitePlus} from the catalog`
        : "no setup-vp steps",
    );
  }
}

// ---------------------------------------------------------------------------

if (process.env.VERBOSE) {
  for (const { rule, detail } of passed) console.log(`  ok   ${rule}: ${detail}`);
}

if (failures.length > 0) {
  console.error(
    `✗ ${failures.length} version invariant(s) violated\n\n` +
      failures.map(({ rule, detail }) => `  ${rule}\n      ${detail}`).join("\n\n"),
  );
  process.exit(1);
}

console.log(`✓ ${passed.length} version invariant(s) hold`);
