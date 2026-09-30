#!/usr/bin/env node
// Guards the GraphQL contract, which — unlike REST — is the SDK's *primary*
// read path: `getCatalog` and `getLicensingSnapshot` compose in one round-trip
// through GraphQL and only fall back to the REST fan-out on failure. That
// fallback is silent by design, so a schema change breaks the fast path without
// breaking anything visibly. This check is what makes it visible.
//
// Two gates, deliberately different in strictness:
//
//   A. documents ⊆ snapshot — the operations in documents.ts must validate
//      against the committed schema. Needs no external source, so it is ALWAYS
//      a hard failure. This is the gate that catches "the SDK now asks for a
//      field the backend stopped serving".
//
//   B. snapshot == backend — byte-equality against kaiten's schema, the
//      analogue of the OpenAPI drift check. The schema is required: it comes from
//      $KAITEN_GRAPHQL_SCHEMA (CI's contract-drift workflow fetches
//      @kaitencloud/graphql-schema) or a sibling checkout, and the check fails
//      when neither resolves.
//
// `--operations-only` runs gate A alone, for the CI jobs that check the shipped
// operations against the snapshot and never fetch the schema.
//
// Gate A alone would pass forever on a stale snapshot; gate B alone would report
// "the schema moved" without saying the SDK is now wrong. Both are needed.

import { existsSync, readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import {
  printCanonicalSchema,
  readShippedDocuments,
  resolveSourceSchema,
  snapshotPath,
} from "./graphql-schema-source.mjs";

const SNAPSHOT_LABEL = "contracts/schema.graphql";

if (!existsSync(snapshotPath)) {
  console.error(
    `✘ No GraphQL schema snapshot at ${SNAPSHOT_LABEL}.\n` +
      `  Create it: KAITEN_PATH=../kaiten node scripts/sync-graphql-schema.mjs`,
  );
  process.exit(1);
}

const snapshotSdl = readFileSync(snapshotPath, "utf8");
const snapshotSchema = buildSchema(snapshotSdl);

// ── Gate A — the shipped operations still validate ──────────────────────────
const { path: documentsPath, operations } = readShippedDocuments();

if (operations.length === 0) {
  console.error(`✘ No GraphQL operations found in ${documentsPath} — the extraction broke.`);
  process.exit(1);
}

const failures = [];
for (const operation of operations) {
  let errors;
  try {
    errors = validate(snapshotSchema, parse(operation));
  } catch (error) {
    errors = [error];
  }
  if (errors.length > 0) {
    const name = /\b(?:query|mutation)\s+(\w+)/.exec(operation)?.[1] ?? "anonymous operation";
    failures.push({ name, errors });
  }
}

if (failures.length > 0) {
  console.error(
    `✘ The GraphQL operations the SDK ships no longer validate against the schema.\n` +
      `  documents: packages/client/src/graphql/documents.ts\n` +
      `  schema:    ${SNAPSHOT_LABEL}\n`,
  );
  for (const { name, errors } of failures) {
    console.error(`  ${name} — ${errors.length} error(s):`);
    for (const error of errors) console.error(`    · ${error.message}`);
  }
  console.error(
    `\n  This is not cosmetic: at runtime the client catches the GraphQL error and\n` +
      `  falls back to the REST fan-out, which drops unlimited/icon/unit/userFacing.\n` +
      `  The fast path would be dead and nothing else would say so.\n\n` +
      `  Fix: update documents.ts, then (cd packages/client && vp run generate-graphql).`,
  );
  process.exit(1);
}

if (process.argv.includes("--operations-only")) {
  console.log(
    `✔ Shipped GraphQL operations validate against ${SNAPSHOT_LABEL} (${operations.length} operations).`,
  );
  process.exit(0);
}

// ── Gate B — the snapshot still matches kaiten ─────────────────────────
const source = resolveSourceSchema();

if (!source) {
  console.error(
    `✘ kaiten's GraphQL schema could not be resolved, so the snapshot was not ` +
      `compared against the backend.\n` +
      `  Set KAITEN_GRAPHQL_SCHEMA to the published schema, or KAITEN_PATH ` +
      `to a checkout of kaiten. --operations-only checks the operations alone.`,
  );
  process.exit(1);
}

// Both sides go through the same canonical print, so a difference is a real
// schema difference and never a formatting or file-order artifact.
if (printCanonicalSchema(snapshotSdl) === source.sdl) {
  console.log(
    `✔ GraphQL schema snapshot is in sync with kaiten, and the ${operations.length} shipped\n` +
      `  operations validate against it.`,
  );
  process.exit(0);
}

const countTypes = (sdl) => (sdl.match(/^type \w+/gm) ?? []).length;

console.error(
  `✘ GraphQL schema snapshot has drifted from kaiten.\n` +
    `  snapshot: ${SNAPSHOT_LABEL} (${countTypes(snapshotSdl)} types)\n` +
    `  source:   ${source.label} (${countTypes(source.sdl)} types)\n\n` +
    `  Fix:\n` +
    `    node scripts/sync-graphql-schema.mjs\n` +
    `    (cd packages/client && vp run generate-graphql)\n` +
    `  Then add a changeset for @kaitencloud/client.`,
);
process.exit(1);
