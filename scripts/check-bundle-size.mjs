// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Bundle-size budgets for @kaitencloud/client, @kaitencloud/react and
// @kaitencloud/react-ui, per import scenario. The two React packages are
// measured while they are still private, so they reach npm within the budgets
// they were held to all along.
//
// Why: what a package costs a host is decided by its bundle graph, and the graph
// is invisible in review. Before this gate, importing `Gate` from the root cost
// 26.6 KB gzip, twenty of them the customer portal and tailwind-merge, retained
// because `Gate` shared a chunk with them and their top-level `memo()`/`cva()`
// calls read as side effects to every bundler. `vp check` and the tests stayed
// green throughout; only a measurement notices.
//
// What: builds each scenario below the way a host's bundler would, with esbuild,
// ESM, minified, for the browser, React external, resolved through an example's
// node_modules so the package `exports` map applies, and holds the gzip size to a
// budget. Two kinds of scenario also assert what did not make it into the output.
// A headless one (the client) holds nothing that draws: no UI-only dependency and
// no import of React. An unstyled one (the React core) may import React but holds
// none of the dependencies the styled components bring. The budget catches a
// regression by size, the module list catches it by name, and the second one does
// not drift with unrelated code.
//
//   node scripts/check-bundle-size.mjs            # after `vp run -r build`
//   node scripts/check-bundle-size.mjs --report   # print, never fail
//
// When a scenario legitimately grows, raise its budget here in the same PR,
// and say why in the changeset. The budgets carry some headroom over the
// measured value so that unrelated edits do not trip them.

import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = process.argv.includes("--report");

/**
 * What the styled components bring and the headless core must not: the primitives
 * of Radix and Base UI, the class helpers, the scroll lock.
 */
const STYLED_ONLY = [
  "tailwind-merge",
  "class-variance-authority",
  "@radix-ui/",
  "@base-ui/",
  "react-remove-scroll",
  "aria-hidden",
];

/**
 * Modules that draw. A headless bundle must not contain any of them. The prefix
 * `react` covers `react`, `react-dom` and every `react-*` helper, and
 * `@kaitencloud/react` covers the React packages of this repository.
 */
const UI_ONLY = ["react", "@kaitencloud/react", ...STYLED_ONLY];

/**
 * What the build leaves as an import instead of bundling, so that a headless
 * scenario reaching React shows up in the output's imports rather than failing
 * the build.
 */
const EXTERNAL = ["react", "react-dom", "react/jsx-runtime", "react-dom/client"];

/**
 * What a scenario that holds something back also leaves as an import: every
 * forbidden package, by name, installed or not. A bundler that cannot resolve one
 * stops with a stack trace; left external it is reported by name, as the leak it
 * is.
 */
const externalOf = (names) =>
  names.flatMap((name) => (name.endsWith("/") ? [`${name}*`] : [name, `${name}/*`, `${name}-*`]));

/**
 * Where imports resolve from: the react-vite example links `@kaitencloud/react` and
 * `@kaitencloud/react-ui`; the node example links `@kaitencloud/client`.
 */
const FROM_REACT = join(repoRoot, "examples/react-vite/src");
const FROM_NODE = join(repoRoot, "examples/node/src");

/**
 * Each scenario is what a host file would import. `budgetGzip` is in bytes. A
 * `headless` scenario must also be free of everything in UI_ONLY, and an
 * `unstyled` one of everything in STYLED_ONLY.
 *
 * The core (`@kaitencloud/react`) scenarios are unstyled by construction, since
 * the package has no styled dependency to leak, and pinned here so that a
 * dependency added to it is a measured decision. The `react-ui` re-export scenario
 * is the one that can regress silently: `@kaitencloud/react-ui` re-exports the
 * whole core, so a host importing `Gate` through it must pay the core's price and
 * nothing of the components'.
 */
const SCENARIOS = [
  {
    name: "core · Gate + KaitenProvider",
    code: `import { Gate, KaitenProvider } from "@kaitencloud/react"; console.log(Gate, KaitenProvider);`,
    budgetGzip: 26_100,
    unstyled: true,
  },
  {
    name: "core · useEntitlementCheck + KaitenProvider",
    code: `import { useEntitlementCheck, KaitenProvider } from "@kaitencloud/react"; console.log(useEntitlementCheck, KaitenProvider);`,
    budgetGzip: 25_200,
    unstyled: true,
  },
  {
    name: "core · Show + KaitenProvider",
    code: `import { Show, KaitenProvider } from "@kaitencloud/react"; console.log(Show, KaitenProvider);`,
    budgetGzip: 25_400,
    unstyled: true,
  },
  {
    name: "core · formatKaitenMoney alone",
    code: `import { formatKaitenMoney } from "@kaitencloud/react"; console.log(formatKaitenMoney);`,
    budgetGzip: 1_000,
    unstyled: true,
  },
  {
    name: "core · everything",
    code: `import * as all from "@kaitencloud/react"; console.log(all);`,
    budgetGzip: 30_000,
    unstyled: true,
  },
  {
    // What a host that draws its own checkout ships: the hooks of the `billing` entry and the
    // provider they read from. Nothing styled is in it, and nothing of it is in the scenarios
    // above, which is the point of the entry.
    // Measured at 28 817 bytes, up from 28 518: the add-ons a refused checkout names, held or
    // ordered, and why the price cannot bill them.
    name: "billing · useCheckout + KaitenProvider",
    code: `import { KaitenProvider } from "@kaitencloud/react"; import { useCheckout } from "@kaitencloud/react/billing"; console.log(KaitenProvider, useCheckout);`,
    budgetGzip: 28_950,
    unstyled: true,
  },
  {
    // Measured at 18 001 bytes, up from 17 854: the kinds a refused change to an add-on's
    // quantity is named with.
    // Measured at 18 335 bytes, up from 18 035: the add-ons a refused checkout names, as above.
    name: "billing · everything",
    code: `import * as all from "@kaitencloud/react/billing"; console.log(all);`,
    budgetGzip: 18_450,
    unstyled: true,
  },
  {
    // Measured at 4 600 bytes, up from 4 463: the five sentences a refused change to an add-on is
    // said with, less the label of the checkout's trial choice, which every language pack
    // carries. (At 4 449 before that, up from under 4 400, for the words of a quota's usage state.)
    // Measured at 4 930 bytes, up from 4 648: the words of the add-ons panel, which say when each
    // change is billed, less the four of the question the portal asked before removing an add-on.
    // Measured at 5 077 bytes, up from 4 930: the five sentences of a checkout about the add-ons
    // the instance holds, and the add-ons it refuses.
    name: "locales · fr alone",
    code: `import { fr } from "@kaitencloud/react/locales"; console.log(fr);`,
    budgetGzip: 5_200,
    unstyled: true,
  },
  {
    name: "react-ui · Gate + KaitenProvider through the re-export",
    code: `import { Gate, KaitenProvider } from "@kaitencloud/react-ui"; console.log(Gate, KaitenProvider);`,
    budgetGzip: 26_100,
    unstyled: true,
  },
  {
    name: "react-ui · PlanBadge + KaitenProvider + KaitenStyleRoot",
    code: `import { PlanBadge, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(PlanBadge, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 37_500,
  },
  {
    name: "react-ui · PricingTable + KaitenProvider + KaitenStyleRoot",
    code: `import { PricingTable, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(PricingTable, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 48_000,
  },
  {
    name: "react-ui · Paywall + KaitenProvider + KaitenStyleRoot",
    code: `import { Paywall, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(Paywall, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 48_000,
  },
  {
    // What a host that offers a checkout ships: the flow, the hooks it is made of, and the words
    // of its English. A host that offers none does not: the four scenarios above are not in it.
    // Measured at 64 634 bytes, up from 52 434: 12.2 KB of it is Base UI's radio group, which
    // draws the billing periods.
    // Measured at 64 832 bytes, up from 64 624: the rule an add-on is offered by beside the price
    // chosen, the portal's, and the quantities a billing period keeps.
    // Measured at 65 763 bytes, up from 64 830: the add-ons the instance holds, listed and kept out
    // of the order, the billing periods that cannot bill them, the add-ons a refusal names, with
    // the hook's side of it, and the words of their English.
    // Measured at 66 091 bytes, up from 65 763: the wait for the add-ons to be known before the
    // flow starts, and the price an add-on in the shape of 1.0 is judged by.
    // Measured at 66 216 bytes, up from 66 135: what the outcome says of a subscription that waits
    // for its first payment, and the words of its English.
    name: "react-ui · CheckoutFlow + KaitenProvider + KaitenStyleRoot",
    code: `import { CheckoutFlow, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(CheckoutFlow, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 66_350,
  },
  {
    // What a host that shows a customer how they pay ships: the card, the billing hooks that add or
    // replace a payment method and open the provider's portal, and the words of its English.
    name: "react-ui · PaymentMethodCard + KaitenProvider + KaitenStyleRoot",
    code: `import { PaymentMethodCard, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(PaymentMethodCard, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 46_050,
  },
  {
    // What a host that offers a customer portal ships: the sections, the billing hooks they
    // change a subscription with, and the words of their English. A host that offers none does
    // not: the scenarios above are not in it.
    // Measured at 59 051 bytes, up from under 58 200: the usage rule of the Kaiten console, which the
    // meters and the status badges of the sections read (the ceiling, the state, its tone and
    // badge), the meter's allowance band and tick, and the new words of the English.
    // Measured at 59 498 bytes, up from 58 943: the refusals of a change to an add-on, named by
    // the hook and said in their own words, and the fee an add-on is offered at.
    // Measured at 59 702 bytes, up from 59 498: the rule an add-on is offered to a subscription by,
    // and the two refusals of a change that had no words of their own.
    // Measured at 61 543 bytes, up from 59 730: the add-ons panel, where quantities are set and
    // confirmed together, with the summary of what each change does; the native dialog it opens
    // in, which only the paywall carried; and the words of its English.
    // Measured at 61 771 bytes, up from 61 555: what the add-ons panel says of a trial, of a
    // subscription that waits for its payment and of a renewal that changes the billing period.
    // Measured at 62 254 bytes, up from 61 771: the state the plan card and the add-ons card share
    // about the panel, which keeps it and its sentence on screen and says the changes once, and the
    // plan's actions in components of their own.
    // Measured at 62 458 bytes, up from 62 350: the price an add-on in the shape of 1.0 is judged
    // by, which the portal shares with the checkout.
    // Measured at 62 537 bytes, up from 62 463: the state of a subscription that waits for its
    // first payment, what the plan card says of it, and the words of its English.
    name: "react-ui · CustomerPortal + KaitenProvider + KaitenStyleRoot",
    code: `import { CustomerPortal, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(CustomerPortal, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 62_700,
  },
  {
    // Measured at 93 302 bytes, up from 79 688: Base UI's radio group, as in the checkout (12.4 KB),
    // and the Kaiten console's usage rule, as in the customer portal (1.3 KB).
    // Measured at 93 901 bytes, up from 93 705: what the customer portal grew by, as above.
    // Measured at 94 081 bytes, up from 93 933: what the checkout grew by, as above.
    // Measured at 95 126 bytes, up from 94 081: the customer portal's add-ons panel, as above, less
    // the dialog, which the paywall already brought.
    // Measured at 96 165 bytes, up from 95 138: what the checkout grew by, as above.
    // Measured at 96 378 bytes, up from 96 165: what the customer portal grew by, as above.
    // Measured at 96 845 bytes, up from 96 378: what the customer portal grew by, as above.
    // Measured at 97 278 bytes, up from 96 938: what the checkout grew by, as above.
    // Measured at 97 507 bytes, up from 97 327: what the checkout and the customer portal grew by
    // for a subscription that waits for its first payment, as above.
    name: "react-ui · everything",
    code: `import * as all from "@kaitencloud/react-ui"; console.log(all);`,
    budgetGzip: 97_650,
  },
  {
    name: "client · KaitenClient alone",
    code: `import { KaitenClient } from "@kaitencloud/client"; console.log(KaitenClient);`,
    budgetGzip: 13_800,
    headless: true,
    resolveDir: FROM_NODE,
  },
  {
    // What a customer portal or a checkout ships: the customer-session client.
    name: "client · KaitenSessionClient alone",
    code: `import { KaitenSessionClient } from "@kaitencloud/client"; console.log(KaitenSessionClient);`,
    budgetGzip: 9_700,
    headless: true,
    resolveDir: FROM_NODE,
  },
];

/** What a scenario must not contain: nothing, the styled dependencies, or all UI. */
function forbiddenOf(scenario) {
  if (scenario.headless) return UI_ONLY;
  if (scenario.unstyled) return STYLED_ONLY;
  return [];
}

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
      resolveDir: scenario.resolveDir ?? FROM_REACT,
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
    external: [...EXTERNAL, ...externalOf(forbiddenOf(scenario))],
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
 * What a scenario's bundle holds that it must not: a forbidden package that made it
 * into the output, and an import of the output left external that is forbidden too.
 * A headless scenario forbids every import it leaves external, React included, since
 * only React and the UI packages are left external. Nothing for a scenario that
 * holds nothing back.
 */
export function leaksOf(scenario, { packages, imported }) {
  const forbidden = forbiddenOf(scenario);
  if (forbidden.length === 0) return [];
  const isForbidden = (name) => forbidden.some((prefix) => name.startsWith(prefix));
  return [
    ...packages.map(([pkg]) => pkg).filter(isForbidden),
    ...imported.filter(scenario.headless ? () => true : isForbidden),
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
      // gzip, and reading these as gzip is how `tailwind-merge` got quoted at
      // 26 KB in a review when it costs 8.3.
      console.log(`    ${kb(bytes).padStart(9)}  ${pkg} (min)`);
    }
    if (overBudget) {
      console.log(
        `    over budget by ${kb(gzip - scenario.budgetGzip)} — raise it in scripts/check-bundle-size.mjs if the growth is intended, and say so in the changeset`,
      );
    }
    if (leaked.length > 0) {
      console.log(
        scenario.headless
          ? `    UI-only code in a headless bundle: ${leaked.join(", ")} — a module reachable from this entry imports React, a styled component or a primitive that draws`
          : `    Styled dependencies in an unstyled bundle: ${leaked.join(", ")} — a module reachable from this entry imports a styled component, a Radix or Base UI primitive or cva/tailwind-merge`,
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
