// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Bundle-size budget for @kaitencloud/client, per import scenario.
//
// Why: what the package costs a host is decided by its bundle graph, and the
// graph is invisible in review. `vp check` and the tests stay green while one
// import drags a dependency into every host's bundle; only a measurement notices.
//
// What: builds each scenario below the way a host's bundler would — esbuild,
// ESM, minified, for the browser, React external — resolved through the node
// example's node_modules so the package `exports` map applies, and holds the gzip
// size to a budget. Headless scenarios also assert that nothing that draws made
// it into the output: no UI-only dependency, and no import of React. The budget
// catches a regression by size, the module list catches it by name, and the
// second one does not drift with unrelated code.
//
//   node scripts/check-bundle-size.mjs            # after `vp run -r build`
//   node scripts/check-bundle-size.mjs --report   # print, never fail
//
// When a scenario legitimately grows, raise its budget here in the same PR,
// and say why in the changeset. The budgets carry ~15% headroom over the
// measured value so that unrelated edits do not trip them.

import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = process.argv.includes("--report");

/**
 * Modules that draw. A headless bundle must not contain any of them. The prefix
 * `react` covers `react`, `react-dom` and every `react-*` helper, and
 * `@kaitencloud/react` covers the React packages of this repository.
 */
const UI_ONLY = [
  "react",
  "@kaitencloud/react",
  "tailwind-merge",
  "class-variance-authority",
  "@radix-ui/",
  "aria-hidden",
];

/**
 * What the build leaves as an import instead of bundling, so that a headless
 * scenario reaching React shows up in the output's imports rather than failing
 * the build.
 */
const EXTERNAL = ["react", "react-dom", "react/jsx-runtime", "react-dom/client"];

/**
 * What a headless scenario also leaves as an import: every UI-only package, by
 * name, installed or not. A bundler that cannot resolve one stops with a stack
 * trace; left external it is reported by name, as the leak it is.
 */
const UI_ONLY_EXTERNAL = UI_ONLY.flatMap((name) =>
  name.endsWith("/") ? [`${name}*`] : [name, `${name}/*`, `${name}-*`],
);

/** Where imports resolve from: the node example links `@kaitencloud/client`. */
const FROM_HOST = join(repoRoot, "examples/node/src");

/**
 * Each scenario is what a host file would import. `budgetGzip` is in bytes;
 * `headless` scenarios must also be free of everything in UI_ONLY.
 */
const SCENARIOS = [
  {
    name: "client · KaitenClient alone",
    code: `import { KaitenClient } from "@kaitencloud/client"; console.log(KaitenClient);`,
    budgetGzip: 13_500,
    headless: true,
  },
  {
    // What a customer portal or a checkout ships: the customer-session client.
    name: "client · KaitenSessionClient alone",
    code: `import { KaitenSessionClient } from "@kaitencloud/client"; console.log(KaitenSessionClient);`,
    budgetGzip: 9_500,
    headless: true,
  },
];

/** The package a bundled input file belongs to, from its path. */
function packageOf(file) {
  const marker = "node_modules/";
  const at = file.lastIndexOf(marker);
  if (at === -1) {
    const workspace = file.match(/^packages\/([^/]+)\//);
    return workspace ? `@kaitencloud/${workspace[1]}` : file;
  }
  const [first, second] = file.slice(at + marker.length).split("/");
  return first.startsWith("@") ? `${first}/${second}` : first;
}

export async function measure(scenario) {
  const result = await esbuild.build({
    stdin: {
      contents: scenario.code,
      resolveDir: FROM_HOST,
      loader: "js",
      sourcefile: "host-entry.js",
    },
    absWorkingDir: repoRoot,
    bundle: true,
    format: "esm",
    platform: "browser",
    minify: true,
    write: false,
    metafile: true,
    external: scenario.headless ? [...EXTERNAL, ...UI_ONLY_EXTERNAL] : EXTERNAL,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });

  const output = result.outputFiles[0].contents;
  const [{ inputs, imports }] = Object.values(result.metafile.outputs);
  const byPackage = new Map();
  for (const [file, info] of Object.entries(inputs)) {
    const pkg = packageOf(file);
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + info.bytesInOutput);
  }

  return {
    minified: output.length,
    gzip: gzipSync(output).length,
    packages: [...byPackage.entries()].sort((a, b) => b[1] - a[1]),
    imported: imports.filter((entry) => entry.external).map((entry) => entry.path),
  };
}

/**
 * What a headless scenario's bundle holds that draws: a UI-only package that made
 * it into the output, and anything the output imports instead of bundling.
 * Nothing for a scenario that is not headless.
 */
export function leaksOf(scenario, { packages, imported }) {
  if (!scenario.headless) return [];
  return [
    ...packages
      .map(([pkg]) => pkg)
      .filter((pkg) => UI_ONLY.some((forbidden) => pkg.startsWith(forbidden))),
    ...imported,
  ];
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

async function main() {
  let failed = false;
  for (const scenario of SCENARIOS) {
    const { minified, gzip, packages, imported } = await measure(scenario);
    const overBudget = gzip > scenario.budgetGzip;
    const leaked = leaksOf(scenario, { packages, imported });
    const bad = !report && (overBudget || leaked.length > 0);
    failed ||= bad;

    const margin = scenario.budgetGzip - gzip;
    const delta = (((gzip - scenario.budgetGzip) / scenario.budgetGzip) * 100).toFixed(0);
    console.log(
      `${bad ? "✗" : "✓"} ${scenario.name}: ${kb(gzip)} gzip (${kb(minified)} minified), ` +
        `budget ${kb(scenario.budgetGzip)} (${delta}%); ` +
        `${gzip} of ${scenario.budgetGzip} bytes, margin ${margin} bytes`,
    );
    for (const [pkg, bytes] of packages.slice(0, 5)) {
      // MINIFIED bytes, not gzip: esbuild's metafile reports each input's
      // contribution to the output, and gzip is a property of the whole file, not
      // of a slice of it. Said out loud because the headline on the line above IS
      // gzip, and these are easy to misread as gzip.
      console.log(`    ${kb(bytes).padStart(9)}  ${pkg} (min)`);
    }
    if (overBudget) {
      console.log(
        `    over budget by ${kb(gzip - scenario.budgetGzip)} — raise it in scripts/check-bundle-size.mjs if the growth is intended, and say so in the changeset`,
      );
    }
    if (leaked.length > 0) {
      console.log(
        `    UI-only code in a headless bundle: ${leaked.join(", ")} — a module reachable from this entry imports React, a styled component or a primitive that draws`,
      );
    }
  }

  if (failed) {
    console.error("\nbundle-size budgets: FAILED");
    process.exit(1);
  }
  console.log(report ? "\nbundle-size budgets: report only" : "\nbundle-size budgets: ok");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
