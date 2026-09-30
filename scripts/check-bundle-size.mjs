// Bundle-size budget for @kaitencloud/client, per import scenario.
//
// Why: what the package costs a host is decided by its bundle graph, and the
// graph is invisible in review. `vp check` and the tests stay green while one
// import drags a dependency into every host's bundle; only a measurement notices.
//
// What: builds each scenario below the way a host's bundler would — esbuild,
// ESM, minified, for the browser — resolved through the node example's
// node_modules so the package `exports` map applies, and holds the gzip size to
// a budget.
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

/** Where imports resolve from: the node example links `@kaitencloud/client`. */
const FROM_HOST = join(repoRoot, "examples/node/src");

/** Each scenario is what a host file would import. `budgetGzip` is in bytes. */
const SCENARIOS = [
  {
    name: "client · KaitenClient alone",
    code: `import { KaitenClient } from "@kaitencloud/client"; console.log(KaitenClient);`,
    budgetGzip: 12_500,
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

async function measure(scenario) {
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
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });

  const output = result.outputFiles[0].contents;
  const byPackage = new Map();
  for (const [file, info] of Object.entries(Object.values(result.metafile.outputs)[0].inputs)) {
    const pkg = packageOf(file);
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + info.bytesInOutput);
  }

  return {
    minified: output.length,
    gzip: gzipSync(output).length,
    packages: [...byPackage.entries()].sort((a, b) => b[1] - a[1]),
  };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

let failed = false;
for (const scenario of SCENARIOS) {
  const { minified, gzip, packages } = await measure(scenario);
  const overBudget = gzip > scenario.budgetGzip;
  const bad = !report && overBudget;
  failed ||= bad;

  const delta = (((gzip - scenario.budgetGzip) / scenario.budgetGzip) * 100).toFixed(0);
  console.log(
    `${bad ? "✗" : "✓"} ${scenario.name}: ${kb(gzip)} gzip (${kb(minified)} minified), ` +
      `budget ${kb(scenario.budgetGzip)} (${delta}%)`,
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
}

if (failed) {
  console.error("\nbundle-size budgets: FAILED");
  process.exit(1);
}
console.log(report ? "\nbundle-size budgets: report only" : "\nbundle-size budgets: ok");
