// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Read allowlisted Git blobs only. Never check out or execute companion code,
// and reject symlinks rather than following them to a different contract.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function prepareCompanionContracts(gitDir, commit, outputDir) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Require a full 40-hex companion SHA.");
  const git = (...args) =>
    execFileSync("git", [`--git-dir=${resolve(gitDir)}`, ...args], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  if (git("rev-parse", "FETCH_HEAD").trim() !== commit) {
    throw new Error("Fetched companion commit does not match the requested SHA.");
  }
  const openapiPath = "app/openapi.yaml";
  const baseSchemaPath = "api/internal/infrastructure/http/graphql/schema.graphqls";
  const entries = git("ls-tree", "-r", commit)
    .trim()
    .split("\n")
    .map((line) => {
      const [metadata, path] = line.split("\t");
      const [mode, type] = metadata.split(" ");
      return { mode, type, path };
    })
    .filter(
      ({ path }) =>
        path === openapiPath ||
        path === baseSchemaPath ||
        /^api\/internal\/modules\/[^/]+\/schema\/[^/]+\.graphqls$/.test(path),
    );
  if (
    !entries.some(({ path }) => path === openapiPath) ||
    !entries.some(({ path }) => path === baseSchemaPath) ||
    entries.length < 3
  ) {
    throw new Error("Companion commit lacks the OpenAPI or gqlgen schema fragments.");
  }
  for (const { mode, type, path } of entries) {
    if (type !== "blob" || !["100644", "100755"].includes(mode)) {
      throw new Error(`Companion contract must be a regular file: ${path}`);
    }
  }
  const read = (path) => git("show", `${commit}:${path}`);
  const schemaPaths = entries
    .map(({ path }) => path)
    .filter((path) => path !== openapiPath)
    .sort();
  const openapi = read(openapiPath);
  const schema = schemaPaths.map(read).join("\n");
  const specPath = resolve(outputDir, "openapi.yaml");
  const schemaPath = resolve(outputDir, "schema.graphqls");
  writeFileSync(specPath, openapi);
  writeFileSync(schemaPath, schema);
  for (const [label, content] of [
    [openapiPath, openapi],
    ["GraphQL fragments", schema],
  ]) {
    console.log(`${label}: sha256 ${createHash("sha256").update(content).digest("hex")}`);
  }
  console.log(
    `Read kaitencloud/kaiten@${commit}: ${openapiPath} and ${schemaPaths.length} fragments`,
  );
  for (const path of schemaPaths) console.log(`  ${path}`);
  return { spec: specPath, schema: schemaPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [gitDir, commit, outputDir] = process.argv.slice(2);
  const { spec, schema } = prepareCompanionContracts(gitDir, commit, outputDir);
  appendFileSync(process.env.GITHUB_OUTPUT, `spec=${spec}\nschema=${schema}\n`);
}
