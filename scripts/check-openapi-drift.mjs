#!/usr/bin/env node
// Fails when the committed OpenAPI snapshot (contracts/openapi.yaml)
// has drifted from kaiten's published contract.
//
// The snapshot is the single input to the generated client. If it lags behind
// the backend, the public SDK silently ships a smaller surface. The existing `generated-sdk`
// CI job only proves `src/generated` matches the *snapshot*; this check proves
// the *snapshot* matches kaiten's source of truth.
//
// Source resolution — the published contract, never a sibling checkout:
//   - $KAITEN_OPENAPI when set to a non-empty path — CI's contract-drift
//     workflow packs @kaitencloud/openapi and points us at the extracted spec.
//   - else the published contract is fetched here (npm pack
//     @kaitencloud/openapi@latest), so the check needs no local kaiten.
//
// The published contract is required. If it can't be resolved (nothing is
// published, or the registry is unreachable) the check fails rather than skip: a skip
// renders as a green tick, indistinguishable from "compared, no drift".
//
// The sync is a literal copy (`vp run sync-openapi`), so byte-equality is the
// correct invariant — the same one the `generated-sdk` job enforces.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPublishedOpenapi } from "./fetch-published-openapi.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = resolve(repoRoot, "contracts/openapi.yaml");
// `||` (not `??`) on purpose: an unset *or empty* env var falls through to the
// published-contract fetch. CI sets KAITEN_OPENAPI to a step output that is
// empty when the contract pack soft-failed, and an empty path must fall back,
// not point at a nonexistent file.
const envSource = process.env.KAITEN_OPENAPI || "";
const sourcePath = envSource ? resolve(repoRoot, envSource) : fetchPublishedOpenapi();
const sourceLabel = envSource ? sourcePath : "@kaitencloud/openapi@latest";

const countOps = (spec) => (spec.match(/^\s*operationId:/gm) ?? []).length;

if (!sourcePath || !existsSync(sourcePath)) {
  console.error(
    `✘ The published OpenAPI contract (@kaitencloud/openapi) could not be resolved, ` +
      `so the snapshot was not compared against the backend.\n` +
      `  Check that registry.npmjs.org is reachable, or set KAITEN_OPENAPI to a ` +
      `spec path.`,
  );
  process.exit(1);
}

const snapshot = readFileSync(snapshotPath, "utf8");
const source = readFileSync(sourcePath, "utf8");

if (snapshot === source) {
  console.log(
    `✔ OpenAPI snapshot is in sync with @kaitencloud/openapi (${countOps(source)} operations).`,
  );
  process.exit(0);
}

const delta = countOps(source) - countOps(snapshot);
const verdict =
  delta > 0
    ? `→ the published SDK is ${delta} operation(s) behind the backend.`
    : delta < 0
      ? `→ the snapshot has ${-delta} operation(s) the backend no longer exposes.`
      : `→ same operation count but the specs differ (schema/shape change).`;

console.error(
  `✘ OpenAPI snapshot has drifted from the published contract.\n` +
    `  snapshot: contracts/openapi.yaml (${countOps(snapshot)} operations)\n` +
    `  source:   ${sourceLabel} (${countOps(source)} operations)\n` +
    `  ${verdict}\n\n` +
    `  Fix:\n` +
    `    vp run sync-openapi\n` +
    `    (cd packages/client && vp run generate)\n` +
    `    vp check --fix packages/client/src/core/generated\n` +
    `  Then add changesets for @kaitencloud/client and @kaitencloud/server.`,
);
process.exit(1);
