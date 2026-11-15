#!/usr/bin/env node
// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Fails when a browser bundle carries something that belongs on a server.
//
// Anything that reaches a browser is public: a credential that got that far has
// to be rotated, not caught. The client refuses to send a `ksh_` or `ksm_` token
// when a `window` exists, but that is a check on a developer's mistake, after the
// token has already shipped. This check looks at what ships. It fails on:
//
//   - a token: `ksh_`, `ksm_` or `kst_` followed by the base64url of a real one.
//     The client's key guard lists those prefixes on purpose, to name the
//     credential a developer pasted, so a bare prefix is not a finding; a token
//     is. A publishable key (`pk_`) is meant for a browser and never is one.
//   - the name of a secret environment variable, `KAITEN_` and then `SECRET` or
//     `TOKEN` somewhere in it, such as `KAITEN_API_TOKEN` or
//     `KAITEN_WEBHOOK_SECRET`: a bundler that inlines `process.env` for a browser
//     build has pulled server configuration into it.
//   - code of @kaitencloud/server, which only a server runs. In a bundle this
//     check builds, the bundler says which files it took; in a build output it
//     cannot read, a handful of strings only that package contains say so.
//
// What it scans:
//
//   - the client as a browser bundle: everything `@kaitencloud/client` and its
//     `/testing` entry export, built the way a host's bundler would. This is the
//     code every browser host ships, so it is always checked. Needs the build.
//   - the browser build of each example (`examples/*/dist` that holds an HTML
//     page). Examples without one, such as the Node backend, have nothing to scan.
//
//   node scripts/check-no-secrets-in-example-build.mjs
//   node scripts/check-no-secrets-in-example-build.mjs --dir path/to/dist [--dir ...]
//
// With `--dir`, only the directories named are scanned.
//
// A finding never prints the whole secret: the prefix and the first characters
// are enough to find it, and a CI log is not the place for the rest.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import { readArguments } from "./lib/arguments.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A Kaiten credential: `ksh_`, `ksm_` or `kst_`, and 32 base64url characters when
 * Kaiten issues it. Twenty-four are asked for, which leaves out a word that happens
 * to start with a prefix and still catches a token a minifier split. The character
 * before the prefix must not be a letter or a digit, so `monks_...` is not one.
 */
export const TOKEN = /(?<![A-Za-z0-9])(ksh|ksm|kst)_[A-Za-z0-9_-]{24,}/g;

/** The name of a secret environment variable of Kaiten's, with whatever prefix a bundler gave it. */
export const SECRET_NAME = /(?<![A-Za-z0-9])KAITEN_[A-Z0-9_]*(?:SECRET|TOKEN)[A-Z0-9_]*/g;

/**
 * Strings that @kaitencloud/server contains and @kaitencloud/client does not, and
 * that survive minification: a message, the name an error gives itself, a header.
 * `tests/check-no-secrets.test.mjs` holds the list to the two builds, so a marker
 * that stops being true is found there.
 */
export const SERVER_MARKERS = [
  "KaitenWebhookVerificationError",
  "svix-signature",
  "Kaiten baseUrl is required",
  "Request to the Kaiten API failed",
];

/** Where `@kaitencloud/server` lives, as the path of an input of a bundle. */
const SERVER_INPUT = /(^|\/)(packages\/server\/|node_modules\/@kaitencloud\/server\/)/;

/** A short, safe way to name a secret: its prefix, its first characters, its length. */
function redact(token) {
  const at = token.indexOf("_") + 1;
  return `${token.slice(0, at + 4)}… (${token.length} characters)`;
}

/**
 * What is wrong with one text, as findings: `{ kind, detail, offset }`. `kind` is
 * `token`, `secret-name` or `server-code`.
 */
export function scanText(text) {
  const findings = [];
  for (const match of text.matchAll(TOKEN)) {
    findings.push({ kind: "token", detail: redact(match[0]), offset: match.index });
  }
  for (const match of text.matchAll(SECRET_NAME)) {
    findings.push({ kind: "secret-name", detail: match[0], offset: match.index });
  }
  for (const marker of SERVER_MARKERS) {
    const offset = text.indexOf(marker);
    if (offset >= 0) {
      findings.push({ kind: "server-code", detail: `"${marker}"`, offset });
    }
  }
  return findings.sort((a, b) => a.offset - b.offset);
}

/** Every file below `dir`, as paths. */
function filesBelow(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") files.push(...filesBelow(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

/** The findings of a directory of build output, each with the file it is in. */
export function scanDirectory(dir) {
  const findings = [];
  for (const file of filesBelow(dir)) {
    // Read as bytes and decoded as Latin-1: a binary file cannot throw, and an
    // ASCII token is found in it all the same.
    const text = readFileSync(file).toString("latin1");
    for (const finding of scanText(text)) {
      findings.push({ ...finding, file: relative(dir, file) || file });
    }
  }
  return findings;
}

/**
 * The client as a host's bundler would give it to a browser: ESM, minified, for
 * the browser, resolved through the node example so that the package's `exports`
 * apply. Each bundle is `{ name, text, inputs }`, where `inputs` are the files the
 * bundler took.
 */
export async function clientBundles() {
  const bundles = [
    {
      name: "everything @kaitencloud/client exports",
      code: `import * as all from "@kaitencloud/client"; console.log(all);`,
    },
    {
      name: "everything @kaitencloud/client/testing exports",
      code: `import * as all from "@kaitencloud/client/testing"; console.log(all);`,
    },
  ];
  const built = [];
  for (const { name, code } of bundles) {
    const result = await esbuild.build({
      stdin: {
        contents: code,
        resolveDir: join(repoRoot, "examples/node/src"),
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
    const [output] = Object.values(result.metafile.outputs);
    built.push({
      name,
      text: result.outputFiles[0].text,
      inputs: Object.keys(output.inputs),
    });
  }
  return built;
}

/** The findings of a bundle the check built, with the server files the bundler took. */
export function scanBundle({ name, text, inputs }) {
  const findings = scanText(text).map((finding) => ({ ...finding, file: name }));
  for (const input of inputs.filter((path) => SERVER_INPUT.test(path))) {
    findings.push({ kind: "server-code", detail: input, offset: 0, file: name });
  }
  return findings;
}

/** `examples/*` whose build output holds an HTML page: those are built for a browser. */
export function exampleBrowserBuilds(root = repoRoot) {
  const examples = join(root, "examples");
  if (!existsSync(examples)) return [];
  return readdirSync(examples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(examples, entry.name, "dist"))
    .filter((dist) => existsSync(dist) && statSync(dist).isDirectory())
    .filter((dist) => filesBelow(dist).some((file) => file.endsWith(".html")));
}

const KINDS = {
  token: "a Kaiten token",
  "secret-name": "the name of a secret environment variable",
  "server-code": "code of @kaitencloud/server",
};

function report(findings) {
  for (const { file, kind, detail, offset } of findings) {
    console.error(`✘ ${file}: ${KINDS[kind]}: ${detail}${offset ? ` at byte ${offset}` : ""}`);
  }
}

async function main() {
  let dirs;
  try {
    dirs = readArguments(process.argv.slice(2), { options: ["--dir"] }).values["--dir"].map((dir) =>
      resolve(dir),
    );
  } catch (error) {
    console.error(`✘ ${error.message}`);
    process.exit(1);
  }

  const findings = [];
  const scanned = [];

  if (dirs.length > 0) {
    for (const dir of dirs) {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        console.error(`✘ ${dir} is not a directory.`);
        process.exit(1);
      }
      findings.push(...scanDirectory(dir));
      scanned.push(relative(process.cwd(), dir) || dir);
    }
  } else {
    if (!existsSync(join(repoRoot, "packages/client/dist/index.mjs"))) {
      console.error("✘ packages/client/dist is missing: run `vp run -r build` first.");
      process.exit(1);
    }
    for (const bundle of await clientBundles()) {
      findings.push(...scanBundle(bundle));
      scanned.push(bundle.name);
    }
    const builds = exampleBrowserBuilds();
    for (const dist of builds) {
      findings.push(
        ...scanDirectory(dist).map((f) => ({ ...f, file: join(relative(repoRoot, dist), f.file) })),
      );
      scanned.push(relative(repoRoot, dist));
    }
    if (builds.length === 0) {
      console.log(
        "○ no example has a browser build (examples/*/dist with an HTML page): nothing more to scan",
      );
    }
  }

  if (findings.length > 0) {
    report(findings);
    console.error(
      `\n${findings.length} finding(s). A secret in a browser bundle is public already: rotate it, ` +
        "then keep it out of the build.",
    );
    process.exit(1);
  }
  for (const what of scanned) {
    console.log(`✔ ${what}: no token, no secret variable name, no server code`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
