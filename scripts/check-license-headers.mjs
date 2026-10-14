#!/usr/bin/env node
// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Fails when a JavaScript or TypeScript file does not open with the license header
// of scripts/license-header.mjs, and lists the files that lack it.
//
// Every such file of the repository is checked, generated ones included: tracked
// files and new ones git does not ignore, so dist/ and node_modules/ stay out. A
// script's `#!` line has to come first, so the header may follow it.
//
//   node scripts/check-license-headers.mjs         # check
//   node scripts/check-license-headers.mjs --fix   # add the header where it lacks
//
// `--fix` is for hand-written files. A generated file lacks the header only when it
// was not produced by its generator, which writes the header itself: regenerate it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LICENSE_HEADER } from "./license-header.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const fix = process.argv.includes("--fix");

/** Tracked files and untracked ones git does not ignore, relative to the root. */
function sourceFiles() {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const paths = new Set(listed.split("\0").filter((path) => SOURCE.test(path)));
  // A tracked file deleted from the working tree is still listed.
  return [...paths]
    .filter((path) => existsSync(join(repoRoot, path)))
    .sort((a, b) => a.localeCompare(b));
}

function opensWithHeader(text) {
  const lines = text.split(/\r?\n/);
  const start = lines[0]?.startsWith("#!") ? 1 : 0;
  return LICENSE_HEADER.every((line, index) => lines[start + index] === line);
}

/** The text with the header on top, after the `#!` line if there is one. */
function withHeader(text) {
  const shebang = text.startsWith("#!") ? text.slice(0, text.indexOf("\n") + 1) : "";
  const rest = text.slice(shebang.length);
  const gap = rest === "" || rest.startsWith("\n") ? "" : "\n";
  return `${shebang}${LICENSE_HEADER.join("\n")}\n${gap}${rest}`;
}

const files = sourceFiles();
if (files.length === 0) {
  console.error("✘ No source file found to check: run this from a git checkout.");
  process.exit(1);
}

const missing = files.filter(
  (path) => !opensWithHeader(readFileSync(join(repoRoot, path), "utf8")),
);

if (missing.length === 0) {
  console.log(`✔ ${files.length} source files open with the license header`);
  process.exit(0);
}

if (fix) {
  for (const path of missing) {
    const file = join(repoRoot, path);
    writeFileSync(file, withHeader(readFileSync(file, "utf8")));
    console.log(`+ ${path}`);
  }
  console.log(`✔ Added the license header to ${missing.length} of ${files.length} source files`);
  process.exit(0);
}

console.error(
  `✘ ${missing.length} of ${files.length} source files do not open with the license header:\n`,
);
for (const path of missing) console.error(`  ${path}`);
console.error(
  [
    "",
    "Each must start with these two lines, after its #! line if it has one:",
    "",
    ...LICENSE_HEADER.map((line) => `  ${line}`),
    "",
    "Run `node scripts/check-license-headers.mjs --fix` to add them to hand-written",
    "files; regenerate a generated one instead (CONTRIBUTING.md, API contracts).",
  ].join("\n"),
);
process.exit(1);
