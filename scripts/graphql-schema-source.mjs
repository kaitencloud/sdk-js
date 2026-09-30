// Shared source resolution + canonical printing for the GraphQL schema snapshot.
//
// The REST contract (@kaitencloud/openapi) is one printed file, so it diffs byte
// for byte. The GraphQL artifact (@kaitencloud/graphql-schema) is not: it holds
// kaiten's gqlgen `.graphqls` fragments, concatenated as the server loads them.
// So the snapshot is *printed* here from those fragments, and the print has to be
// canonical or the byte-equality diff flakes on fragment order.
//
// `lexicographicSortSchema` gives that canonical form using only `graphql`,
// which packages/client already depends on — no codegen plugin needed.

import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema, lexicographicSortSchema, printSchema } from "graphql";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const snapshotPath = resolve(repoRoot, "contracts/schema.graphql");

// Relative to a kaiten checkout. Kept in one place: the schema is split
// across modules, and a module added in kaiten must land in the snapshot
// without editing anything here.
const SCHEMA_GLOBS = [
  "api/internal/infrastructure/http/graphql/schema.graphqls",
  "api/internal/modules/*/schema/*.graphqls",
];

/** Canonical, order-independent SDL for a set of schema fragments. */
export function printCanonicalSchema(sdl) {
  return `${printSchema(lexicographicSortSchema(buildSchema(sdl)))}`;
}

/**
 * Resolves the upstream schema, mirroring the env-var contract of the REST
 * scripts.
 *
 * - `$KAITEN_GRAPHQL_SCHEMA` — a path to schema SDL: either an
 *   already-printed schema or the raw concatenation of kaiten's fragments
 *   (`extend type` and all — `buildSchema` takes both, and the print below
 *   normalizes either into the same canonical form). This is the hook the
 *   published @kaitencloud/graphql-schema artifact plugs into, the way
 *   `$KAITEN_OPENAPI` carries the packed REST contract — see
 *   .github/workflows/contract-drift.yml. Publishing fragments rather than a
 *   pre-printed SDL is deliberate: `printCanonicalSchema` stays the ONE
 *   definition of the canonical form, so a byte-equality diff can never flake on
 *   two implementations of the same sort order disagreeing.
 * - else `$KAITEN_PATH` (default `../kaiten`) — a sibling checkout.
 *
 * Returns `null` when nothing resolves, so callers decide whether that is a
 * hard failure (sync) or a skip (drift).
 */
export function resolveSourceSchema() {
  // `||` (not `??`): CI may pass an empty string for a step that soft-failed,
  // and empty must fall through rather than point at a nonexistent path.
  const prefetched = process.env.KAITEN_GRAPHQL_SCHEMA || "";
  if (prefetched) {
    const path = resolve(repoRoot, prefetched);
    if (!existsSync(path)) return null;
    return { sdl: printCanonicalSchema(readFileSync(path, "utf8")), label: path };
  }

  const kaitenPath = resolve(repoRoot, process.env.KAITEN_PATH || "../kaiten");
  if (!existsSync(kaitenPath)) return null;

  const files = SCHEMA_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: kaitenPath }))
    .map((relative) => resolve(kaitenPath, relative))
    // globSync's order is filesystem-dependent; the print is sorted anyway, but
    // a stable read order keeps error messages reproducible.
    .sort();

  if (files.length === 0) return null;

  const sdl = files.map((file) => readFileSync(file, "utf8")).join("\n");
  return {
    sdl: printCanonicalSchema(sdl),
    label: `${kaitenPath} (${files.length} .graphqls files)`,
  };
}

/** The GraphQL operations the SDK ships, as written in documents.ts. */
export function readShippedDocuments() {
  const path = resolve(repoRoot, "packages/client/src/graphql/documents.ts");
  const source = readFileSync(path, "utf8");
  // The documents are the tagged template arguments of `graphql(`…`)`. Reading
  // them from source rather than importing keeps this script free of the
  // package's build output, which may not exist when the check runs.
  const operations = [...source.matchAll(/graphql\(`([\s\S]*?)`\)/g)].map((match) => match[1]);
  return { path, operations };
}
