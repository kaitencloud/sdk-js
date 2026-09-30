#!/usr/bin/env node
// Refreshes the committed OpenAPI snapshot (contracts/openapi.yaml)
// from the published contract @kaitencloud/openapi@latest — the source of truth
// on npm, NOT a sibling kaiten checkout. The snapshot is the
// single input to the generated client, so after syncing, regenerate it:
//   (cd packages/client && vp run generate)
//   (cd packages/server && vp run generate)
//   vp check --fix packages/client/src/core/generated packages/server/src/generated
// Then add changesets for @kaitencloud/client and @kaitencloud/server.

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPublishedOpenapi } from "./fetch-published-openapi.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = resolve(repoRoot, "contracts/openapi.yaml");

// $KAITEN_OPENAPI, when set, points at an ALREADY-FETCHED spec and this
// script copies it instead of reaching for the registry itself. Same contract as
// check-openapi-drift.mjs, deliberately: the two scripts consume the same input
// and should be driven the same way.
const prefetched = process.env.KAITEN_OPENAPI || "";
const sourceLabel = prefetched ? prefetched : "@kaitencloud/openapi@latest";

const source = prefetched ? resolve(repoRoot, prefetched) : fetchPublishedOpenapi();

if (!source || !existsSync(source)) {
  console.error(
    prefetched
      ? `✘ KAITEN_OPENAPI is set but no spec exists at ${source}.`
      : "✘ Could not fetch @kaitencloud/openapi@latest from npm.\n" +
          "  Check that registry.npmjs.org is reachable and that kaiten's\n" +
          "  release-openapi workflow has published the contract.\n" +
          "  Already have the spec on disk? Point KAITEN_OPENAPI at it.",
  );
  process.exit(1);
}

copyFileSync(source, snapshotPath);
const ops = (readFileSync(snapshotPath, "utf8").match(/^\s*operationId:/gm) ?? []).length;
console.log(
  `✔ Synced contracts/openapi.yaml from ${sourceLabel} (${ops} operations).\n` +
    "  Next: regenerate the client\n" +
    "    (cd packages/client && vp run generate)\n" +
    "    (cd packages/server && vp run generate)\n" +
    "    vp check --fix packages/client/src/core/generated packages/server/src/generated\n" +
    "  Then add changesets for @kaitencloud/client and @kaitencloud/server.",
);
