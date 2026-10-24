// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A reviewed, immutable companion commit is a PR-only contract source, not a
// substitute for the published-contract checks on main and on the schedule.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function selectContractCommit(eventName, headBranch, sourceJson) {
  if (eventName !== "pull_request" || sourceJson === null) return "";
  const source = JSON.parse(sourceJson);
  if (
    source === null ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    Object.keys(source).sort().join(",") !== "commit,headBranch,repository" ||
    source.repository !== "kaitencloud/kaiten" ||
    typeof source.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(source.commit) ||
    typeof source.headBranch !== "string" ||
    !source.headBranch.trim()
  ) {
    throw new Error(
      "Invalid companion contract source: require repository kaitencloud/kaiten, " +
        "a full lowercase 40-hex commit SHA, and a non-empty headBranch.",
    );
  }
  // An override retained in main must never exempt unrelated PRs.
  return headBranch === source.headBranch ? source.commit : "";
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = resolve(repoRoot, ".github/kaiten-contract-source.json");
  const eventName = process.env.GITHUB_EVENT_NAME;
  const sourceJson =
    eventName === "pull_request" && existsSync(path) ? readFileSync(path, "utf8") : null;
  const commit = selectContractCommit(eventName, process.env.GITHUB_HEAD_REF, sourceJson);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `commit=${commit}\n`);
  }
  const label = commit
    ? `kaitencloud/kaiten@${commit} (companion source; NOT npm latest)`
    : "@kaitencloud/openapi@latest and @kaitencloud/graphql-schema@latest (published)";
  console.log(`Contract comparison source: ${label}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Contract comparison source: \`${label}\`\n`);
  }
}
