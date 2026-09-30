#!/usr/bin/env node
// Rewrites the committed GraphQL schema snapshot
// (contracts/schema.graphql) from kaiten's gqlgen schema.
//
// The GraphQL twin of `sync-openapi.mjs`. Same contract: resolve the upstream
// source, write the snapshot, hard-fail when the source is unreachable — a
// sync that silently did nothing is worse than one that stops.
//
// After running this, regenerate the typed documents:
//   (cd packages/client && vp run generate-graphql)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolveSourceSchema, snapshotPath } from "./graphql-schema-source.mjs";

const source = resolveSourceSchema();

if (!source) {
  console.error(
    `✘ Could not resolve kaiten's GraphQL schema.\n\n` +
      `  Point one of these at it:\n` +
      `    KAITEN_PATH=../kaiten node scripts/sync-graphql-schema.mjs\n` +
      `    KAITEN_GRAPHQL_SCHEMA=/path/to/schema.graphql node scripts/sync-graphql-schema.mjs\n\n` +
      `  In CI the schema arrives as the published @kaitencloud/graphql-schema\n` +
      `  artifact (.github/workflows/contract-drift.yml); locally a sibling\n` +
      `  checkout is the ordinary source.`,
  );
  process.exit(1);
}

const previous = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf8") : null;

mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, source.sdl);

const countTypes = (sdl) => (sdl.match(/^type \w+/gm) ?? []).length;

if (previous === source.sdl) {
  console.log(`✔ GraphQL schema snapshot already in sync (${countTypes(source.sdl)} types).`);
} else {
  console.log(
    `✔ GraphQL schema snapshot updated from ${source.label}\n` +
      `  ${countTypes(source.sdl)} types (was ${previous === null ? "absent" : countTypes(previous)}).\n` +
      `  Next: (cd packages/client && vp run generate-graphql) and add a changeset.`,
  );
}
