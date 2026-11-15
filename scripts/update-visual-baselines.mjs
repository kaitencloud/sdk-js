#!/usr/bin/env node
// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Dispatches the "Update visual baselines" workflow against the current branch.
//
// The baselines are amd64-Linux renderings (sub-pixel anti-aliasing differs by CPU
// arch, OS and font stack), so they can only be regenerated inside the same
// Playwright container CI uses — never on a developer machine. That makes this a
// remote operation, and remote operations fail in confusing ways when a local
// precondition is missing. The checks below turn each of those into a sentence.
//
// The workflow commits the regenerated PNGs back to the branch it ran on, so pull
// once it finishes.
//
// Flags:
//   --dry-run   run every check and print what would be dispatched, without firing.
//               This exists because the useful part of the script is the checks, and
//               there is otherwise no way to exercise them without starting a real
//               CI run that pushes a commit.
//   --force     dispatch even when the local branch is ahead of (or behind) origin.

import { execFileSync } from "node:child_process";

const WORKFLOW = "update-visual-baselines.yml";
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");

const run = (command, commandArgs) =>
  execFileSync(command, commandArgs, { encoding: "utf8" }).trim();

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

let branch;
try {
  branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
} catch {
  fail("not inside a git repository");
}

if (branch === "HEAD") {
  fail("HEAD is detached — check out the branch whose baselines you want to rebuild");
}

try {
  run("gh", ["--version"]);
} catch {
  fail(
    "the GitHub CLI (`gh`) is required to dispatch a workflow.\n" +
      "  Install it with `brew install gh`, then `gh auth login`.",
  );
}

// The dispatch names a ref on the remote; a branch that exists only locally is
// rejected with a bare "workflow does not have 'workflow_dispatch' trigger", which
// points at entirely the wrong thing.
const remoteRef = run("git", ["ls-remote", "--heads", "origin", branch]);
if (!remoteRef) {
  fail(
    `branch "${branch}" does not exist on origin yet.\n` +
      `  The workflow renders and commits the baselines on the remote branch, so push first:\n` +
      `    git push -u origin ${branch}`,
  );
}

// Rendering from a commit that is not the one you are working on produces baselines
// for markup you do not have, and the workflow then commits them — so this is a stop,
// not a warning.
const localHead = run("git", ["rev-parse", "HEAD"]);
const remoteHead = remoteRef.split(/\s+/)[0];
if (localHead !== remoteHead && !force) {
  fail(
    `origin/${branch} is at ${remoteHead.slice(0, 8)} but local HEAD is at ${localHead.slice(0, 8)}.\n` +
      `  Baselines would be rendered from the remote commit and committed there, which is\n` +
      `  not the code you are looking at. Push first:\n` +
      `    git push\n` +
      `  Or pass --force if the difference is deliberate.`,
  );
}

if (dryRun) {
  console.log(
    `✓ every precondition holds. Would dispatch:\n` +
      `    gh workflow run ${WORKFLOW} --ref ${branch}\n` +
      `  (nothing was triggered — drop --dry-run to run it for real)`,
  );
  process.exit(0);
}

console.log(`Dispatching "${WORKFLOW}" on ${branch}…`);
try {
  run("gh", ["workflow", "run", WORKFLOW, "--ref", branch]);
} catch (error) {
  fail(`dispatch failed:\n${error.stderr ?? error.message}`);
}

console.log(
  `✓ dispatched.\n\n` +
    `  Watch it:   gh run watch --exit-status\n` +
    `  Or:         gh run list --workflow ${WORKFLOW} --branch ${branch}\n\n` +
    `  It commits the regenerated *-linux.png back to ${branch}, so pull when it finishes:\n` +
    `    git pull --ff-only`,
);
