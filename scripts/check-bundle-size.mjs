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
    budgetGzip: 26_300,
    unstyled: true,
  },
  {
    name: "core · useEntitlementCheck + KaitenProvider",
    code: `import { useEntitlementCheck, KaitenProvider } from "@kaitencloud/react"; console.log(useEntitlementCheck, KaitenProvider);`,
    budgetGzip: 25_400,
    unstyled: true,
  },
  {
    name: "core · Show + KaitenProvider",
    code: `import { Show, KaitenProvider } from "@kaitencloud/react"; console.log(Show, KaitenProvider);`,
    budgetGzip: 25_600,
    unstyled: true,
  },
  {
    name: "core · formatKaitenMoney alone",
    code: `import { formatKaitenMoney } from "@kaitencloud/react"; console.log(formatKaitenMoney);`,
    budgetGzip: 1_000,
    unstyled: true,
  },
  {
    // Measured at 30 124 bytes. The anonymous checkout client is not in it (the root of this package
    // holds no `/public/checkout-sessions`; the hook that uses it is in the `billing` entry): what
    // grew is what every client of the package carries, namely the four refusals of an anonymous
    // checkout that the errors tell apart, and the OFREP context that names the instance. The
    // budget leaves a margin of about 300 bytes.
    name: "core · everything",
    code: `import * as all from "@kaitencloud/react"; console.log(all);`,
    budgetGzip: 30_450,
    unstyled: true,
  },
  {
    // What a host that draws its own checkout ships: the hooks of the `billing` entry and the
    // provider they read from. Nothing styled is in it, and nothing of it is in the scenarios
    // above, which is the point of the entry.
    // Measured at 28 817 bytes, up from 28 518: the add-ons a refused checkout names, held or
    // ordered, and why the price cannot bill them.
    // Measured at 29 032 bytes, up from 28 817: what every client of the package reads its
    // refusals through grew by the four of an anonymous checkout, as in the session client.
    // Measured at 29 194 bytes, up from 29 032: the listener that hears the popup say it is done is
    // set before the popup opens, which the three flows that open one share.
    name: "billing · useCheckout + KaitenProvider",
    code: `import { KaitenProvider } from "@kaitencloud/react"; import { useCheckout } from "@kaitencloud/react/billing"; console.log(KaitenProvider, useCheckout);`,
    budgetGzip: 29_500,
    unstyled: true,
  },
  {
    // What a host that draws its own checkout for visitors ships: the hook, the loader of
    // Cloudflare's script and the provider they read from. Nothing styled is in it, and none of the
    // hooks of a customer's checkout.
    // Measured at 29 792 bytes, up to 30 204: a refusal told by the operation that made it, the
    // popup that is closed with the checkout, the page that comes back drawn as a wait from its
    // first frame, and the widget's size followed as its container changes.
    // Measured at 30 960 bytes, up from 30 204: 0.5 KB is the shape check of a start, which the hook
    // runs before it takes a Turnstile token and which the anonymous checkout client has already
    // (a page that sells to visitors ships both, so it is paid once there); the rest is the listener
    // set before the popup opens, and the quote kept when an amount changed after the setup.
    name: "billing · useAnonymousCheckout + KaitenProvider",
    code: `import { KaitenProvider } from "@kaitencloud/react"; import { useAnonymousCheckout } from "@kaitencloud/react/billing"; console.log(KaitenProvider, useAnonymousCheckout);`,
    budgetGzip: 31_300,
    unstyled: true,
  },
  {
    // Measured at 18 001 bytes, up from 17 854: the kinds a refused change to an add-on's
    // quantity is named with.
    // Measured at 18 335 bytes, up from 18 035: the add-ons a refused checkout names, as above.
    // Measured at 22 461 bytes, up from 18 335: the hook of the anonymous checkout, with the loader
    // of Cloudflare's script, the widget, the refusals it names and the way back from the payment
    // provider's page. A host that draws a customer's checkout and not a visitor's does not pay for
    // it: the scenario above is where it is measured out.
    // Measured at 22 913 bytes, up from 22 461: what the hook of the anonymous checkout grew by, as above.
    // Measured at 23 542 bytes, up from 22 913: the hook that redeems a code on a live subscription,
    // with the states of a redemption and the refusals it names. Only the entry that exports every
    // hook pays for it: the scenarios of one hook above did not move.
    // Measured at 24 351 bytes, up from 23 542: the shape check of a start, the listener set before
    // a popup opens, and the refusals the billing gate and the origin check are named with.
    name: "billing · everything",
    code: `import * as all from "@kaitencloud/react/billing"; console.log(all);`,
    budgetGzip: 24_700,
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
    // Measured at 5 185 bytes, up from 5 155: what cancelling a subscription that ends at once
    // says, a trial's or a checkout's that waits for its first payment.
    // Measured at 6 142 bytes, up from 5 185: the section of an anonymous checkout, which every
    // language pack carries whole (the form, the security check, the review, the end, and each
    // refusal).
    // Measured at 6 167 bytes, up from 6 142: the trial's price and a missing name, less the words
    // that promised an e-mail.
    // Measured at 6 669 bytes, up from 6 215: the words of the trial banner and of redeeming a code,
    // which every language pack carries whole.
    // Measured at 6 730 bytes: the sentence for a security check that loaded and failed.
    //
    // Why the pack grew by about 1.5 KB (28%) over this stretch, and why that is accepted: a pack is
    // one plain object that a host passes whole to `locale`, so it carries a translation of every
    // sentence of every section the English words have, whichever components the host draws. The
    // anonymous checkout (about 60 sentences) and the trial banner with the redemption of a code
    // are the two sections that were added. Splitting a pack by section would change the shape a
    // host imports (`fr` is that object), which cannot happen in 1.x; a pack is imported only by a
    // host that translates, and the sentences are strings that compress well. The budget keeps a
    // margin of about 300 bytes.
    name: "locales · fr alone",
    code: `import { fr } from "@kaitencloud/react/locales"; console.log(fr);`,
    budgetGzip: 7_050,
    unstyled: true,
  },
  {
    name: "react-ui · Gate + KaitenProvider through the re-export",
    code: `import { Gate, KaitenProvider } from "@kaitencloud/react-ui"; console.log(Gate, KaitenProvider);`,
    budgetGzip: 26_300,
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
    // Measured at 66 391 bytes, up from 66 216: what a customer back at the checkout of such a
    // subscription is told, the invoice it offers to pay, and the wait on it.
    // Measured at 66 625 bytes, up from 66 391: the refusals of an anonymous checkout, as above.
    // Measured at 66 832 bytes, up from 66 625: the text colours the feedback tones gained and the
    // new-tab description of the "Powered by" link, which the customer's checkout shares.
    // Measured at 66 962 bytes, up from 66 832: the warning tone of the shared messages and the
    // press an unavailable button keeps.
    name: "react-ui · CheckoutFlow + KaitenProvider + KaitenStyleRoot",
    code: `import { CheckoutFlow, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(CheckoutFlow, KaitenProvider, KaitenStyleRoot);`,
    // Measured at 67 100 bytes, up from 66 962: the listener that hears the setup popup say it is
    // done, set before the popup opens. The budget keeps a margin of about 300 bytes.
    budgetGzip: 67_400,
  },
  {
    // What a host that sells to visitors ships: the flow, the hook it is made of with the loader of
    // Cloudflare's script, the summary it shares with the customer's checkout, and the words of its
    // English. A host that sells to customers only does not: the scenario above is not in it.
    // Measured at 67 564 bytes, up to 68 337: the hook, as above, and the flow's words for an address
    // that is wrong, a trial's price, and the form's own messages.
    // Measured at 68 606 bytes, up from 68 337: what the flow says of what it knows and no more,
    // the steps it shows a visitor, and the new-tab description of the "Powered by" link.
    // Measured at 68 963 bytes, up from 68 606: the review of a paid plan (its renewal, its price in
    // the card's format), the warning tone of an amount that changed, and the sentence about a trial
    // that asks for no card.
    // Measured at 69 768 bytes, up from 68 963: what the hook grew by, as above, the check that
    // failed told apart from a script that could not load, and the review that does not draw the
    // figures of an amount that changed after the setup.
    // Measured at 70 159 bytes, up from 69 777: the company field and the optional mode of both
    // fields, with their English words (label, hint, required message, the mark of an optional
    // field) and the hook's company beside its name.
    name: "react-ui · AnonymousCheckoutFlow + KaitenProvider + KaitenStyleRoot",
    code: `import { AnonymousCheckoutFlow, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(AnonymousCheckoutFlow, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 70_450,
  },
  {
    // What a host that shows a customer how they pay ships: the card, the billing hooks that add or
    // replace a payment method and open the provider's portal, and the words of its English.
    // Measured at 46 058 bytes: the refusals of an anonymous checkout, as above.
    // Measured at 46 263 bytes, up from 46 058: the text colours of the feedback tones and the
    // new-tab description of links. The jump to 47 193 that an earlier note blamed on the tones was the
    // checkout's English words, which the shared action imported for that one description: it reads
    // it from a module of its own now.
    // Measured at 46 375 bytes, up from 46 263: the warning tone of the shared messages.
    // Measured at 46 433 bytes: the listener of the payment method hook, set before the popup opens.
    name: "react-ui · PaymentMethodCard + KaitenProvider + KaitenStyleRoot",
    code: `import { PaymentMethodCard, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(PaymentMethodCard, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 46_750,
  },
  {
    // What a host that shows a customer their trial ships: the banner, the billing hooks that add a
    // card and end the trial, and the words of its English.
    // Measured at 46 991 bytes.
    // Measured at 47 131 bytes: the listener of the payment method hook, set before the popup opens.
    name: "react-ui · TrialBanner + KaitenProvider + KaitenStyleRoot",
    code: `import { TrialBanner, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(TrialBanner, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 47_450,
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
    // Measured at 62 593 bytes, up from 62 537: what cancelling a subscription that ends at once
    // says, and the words of its English.
    // Measured at 62 833 bytes, up from 62 593: the refusals of an anonymous checkout, as above.
    // Measured at 63 011 bytes, up from 62 833: the feedback tones and the new-tab description, as above.
    // Measured at 65 068 bytes, up from 63 011: redeeming a code on a live subscription (the hook and
    // its states, what a code gives said in sentences, the list of redemptions in force) and the words
    // of its English.
    // Measured at 65 207 bytes, up from 65 068: the listener of the payment method hook, as above.
    name: "react-ui · CustomerPortal + KaitenProvider + KaitenStyleRoot",
    code: `import { CustomerPortal, KaitenProvider, KaitenStyleRoot } from "@kaitencloud/react-ui"; console.log(CustomerPortal, KaitenProvider, KaitenStyleRoot);`,
    budgetGzip: 65_550,
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
    // Measured at 97 714 bytes, up from 97 507: what the checkout and the customer portal grew by
    // for a cancellation that ends at once and a customer back at the checkout, as above.
    // Measured at 97 923 bytes, up from 97 714: the refusals of an anonymous checkout, as above.
    // Measured at 105 881 bytes, up from 98 007: the anonymous checkout, with its hook, its words in
    // English and the billing periods' choice it shares with the customer's checkout.
    // Measured at 106 719 bytes, up from 105 881: what the hook and the flow grew by, as above.
    // Measured at 106 964 bytes, up from 106 719: what the anonymous checkout grew by, as above.
    // Measured at 108 472 bytes, up from 106 964: the trial banner, with the hooks and the words it
    // is made of.
    // Measured at 110 468 bytes, up from 108 472: redeeming a code, as above.
    // Measured at 110 793 bytes, up from 110 468: the anonymous checkout's review and the warning tone.
    // Measured at 111 688 bytes, up from 110 793: what the anonymous checkout and the hooks that open
    // a popup grew by, as above.
    // Measured at 112 248 bytes, up from 111 694: the company field of the anonymous checkout, as above.
    name: "react-ui · everything",
    code: `import * as all from "@kaitencloud/react-ui"; console.log(all);`,
    budgetGzip: 112_550,
  },
  {
    name: "client · KaitenClient alone",
    code: `import { KaitenClient } from "@kaitencloud/client"; console.log(KaitenClient);`,
    budgetGzip: 14_000,
    headless: true,
    resolveDir: FROM_NODE,
  },
  {
    // What a customer portal or a checkout ships: the customer-session client.
    // Measured at 9 751 bytes, up from 9 585: the four refusals of an anonymous checkout
    // the errors tell apart (a Turnstile token refused or out of reach, a session closed, a due
    // amount changed), which every client of the package reads its refusals through.
    // Measured at 9 989 bytes, up from 9 751: the trial block of the portal, the members of a
    // redemption and the call that redeems a code.
    // Measured at 10 039 bytes, up from 9 989: the headers of the two public clients are built in one
    // place.
    name: "client · KaitenSessionClient alone",
    code: `import { KaitenSessionClient } from "@kaitencloud/client"; console.log(KaitenSessionClient);`,
    budgetGzip: 10_350,
    headless: true,
    resolveDir: FROM_NODE,
  },
  {
    // What a page that sells a plan to a visitor with no account ships: the anonymous checkout
    // client, which a host that offers none does not.
    //
    // Measured at 9 740 bytes, up from 9 174: the checks of every bound the API sets on a
    // start (lengths counted in characters, the members it does not know), the token kept for
    // the 24 hours a closed session can still be read, the refusal of an answer outside the
    // closed unions, and `clearCheckoutReturn`.
    // Measured at 9 768 bytes, up from 9 740: the shape check of a start is exported for a page to run
    // before it takes a token, and the headers are built in one place.
    name: "client · KaitenAnonymousCheckoutClient alone",
    code: `import { KaitenAnonymousCheckoutClient } from "@kaitencloud/client"; console.log(KaitenAnonymousCheckoutClient);`,
    budgetGzip: 10_100,
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
