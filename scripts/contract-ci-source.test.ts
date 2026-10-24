// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { selectContractCommit } from "./contract-ci-source.mjs";
import { prepareCompanionContracts } from "./prepare-companion-contracts.mjs";

const commit = "53c5261143b9bf049d44ee76ce370a8c648ff8f1";
const source = { repository: "kaitencloud/kaiten", commit, headBranch: "feat/ai-credits" };
const json = JSON.stringify(source);

it("selects a pinned source only for its feature PR; published defaults remain", () => {
  expect(selectContractCommit("pull_request", "feat/ai-credits", json)).toBe(commit);
  expect(selectContractCommit("pull_request", "other-feature", json)).toBe("");
  expect(selectContractCommit("pull_request", "feat/ai-credits", null)).toBe("");
  for (const event of ["push", "schedule", "workflow_dispatch"]) {
    expect(selectContractCommit(event, "feat/ai-credits", json)).toBe("");
    expect(selectContractCommit(event, "feat/ai-credits", "invalid JSON")).toBe("");
  }
});

it("fails closed on malformed or unsafe PR source overrides", () => {
  for (const override of [
    "invalid JSON",
    "null",
    "[]",
    JSON.stringify({ ...source, repository: "attacker/kaiten" }),
    JSON.stringify({ ...source, commit: "feat/ai-credits" }),
    JSON.stringify({ ...source, commit: `${commit}\nother=value` }),
    JSON.stringify({ ...source, commit: "a".repeat(39) }),
    JSON.stringify({ ...source, headBranch: "" }),
    JSON.stringify({ ...source, path: "../../contract" }),
  ]) {
    expect(() => selectContractCommit("pull_request", "feat/ai-credits", override)).toThrow();
  }
});

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture({ missingOpenapi = false, symlink = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kaiten-contract-test-"));
  directories.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "--quiet");
  const files = {
    "app/openapi.yaml": "operationId: fixture\n",
    "api/internal/infrastructure/http/graphql/schema.graphqls": "type Query { fixture: String }",
    "api/internal/modules/z/schema/z.graphqls": "type Z { id: ID }",
    "api/internal/modules/a/schema/a.graphqls": "type A { id: ID }",
    "api/never-run.mjs": "throw new Error('Companion code must never execute');",
  };
  for (const [path, content] of Object.entries(files)) {
    if (missingOpenapi && path === "app/openapi.yaml") continue;
    const fullPath = join(dir, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    if (symlink && path === "app/openapi.yaml") symlinkSync("../api/never-run.mjs", fullPath);
    else writeFileSync(fullPath, content);
  }
  git("add", ".");
  git(
    "-c",
    "user.name=Contract test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const sha = git("rev-parse", "HEAD").trim();
  writeFileSync(join(dir, ".git/FETCH_HEAD"), `${sha}\t\tfixture\n`);
  return { dir, sha, gitDir: join(dir, ".git") };
}

it("reads only pinned regular contract blobs and deterministically joins all fragments", () => {
  const { dir, sha, gitDir } = fixture();
  const result = prepareCompanionContracts(gitDir, sha, dir);
  expect(readFileSync(result.spec, "utf8")).toBe("operationId: fixture\n");
  expect(readFileSync(result.schema, "utf8")).toBe(
    "type Query { fixture: String }\ntype A { id: ID }\ntype Z { id: ID }",
  );
});

it("rejects wrong commits, missing contracts and symlinks without fallback", () => {
  const valid = fixture();
  expect(() => prepareCompanionContracts(valid.gitDir, "a".repeat(40), valid.dir)).toThrow(
    "does not match",
  );
  expect(() => prepareCompanionContracts(valid.gitDir, "main", valid.dir)).toThrow("40-hex");
  const missing = fixture({ missingOpenapi: true });
  expect(() => prepareCompanionContracts(missing.gitDir, missing.sha, missing.dir)).toThrow(
    "lacks",
  );
  const linked = fixture({ symlink: true });
  expect(() => prepareCompanionContracts(linked.gitDir, linked.sha, linked.dir)).toThrow(
    "regular file",
  );
});
