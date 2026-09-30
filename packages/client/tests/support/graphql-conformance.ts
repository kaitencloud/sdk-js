// Makes a GraphQL test double answerable to the real schema.
//
// A double that answers any field it is asked for can keep a broken query
// green. If `documents.ts` selected a field the backend does not declare, the
// server would reject the WHOLE query and `getLicensingSnapshot` would fall back
// to REST, while a mocked response inventing that field keeps every unit test
// passing. `check-graphql-drift.mjs` gate A cannot see it either: it compares
// the documents with a snapshot that can go stale at the same moment, and gate B
// only runs where the backend schema is reachable.
//
// This closes the double's side. A mocked response is walked against the
// committed schema, so a double can only serve fields the backend actually
// declares. It cannot make the documents right on its own — that is gate A's
// and gate B's job — but it removes the fabrication that would let a dead query
// look alive.

import { readFileSync } from "node:fs";
import {
  buildSchema,
  getNamedType,
  GraphQLObjectType,
  type GraphQLNamedType,
  type GraphQLSchema,
} from "graphql";
import { afterEach } from "vite-plus/test";

const schemaPath = new URL("../../../../contracts/schema.graphql", import.meta.url);

/** The committed snapshot — the same file codegen and gate A read. */
export const committedSchema: GraphQLSchema = buildSchema(readFileSync(schemaPath, "utf8"));

/**
 * Every key in `data` must be a real field on the schema type it sits under.
 *
 * Deliberately one-directional. It does not require a double to serve every
 * field a document selects: doubles are written per test and legitimately carry
 * only what the case under test reads. What no double may do is invent a field,
 * because that is indistinguishable from the backend having one — which is the
 * exact illusion that hid the outage.
 *
 * The walk stops at anything that is not an object type. `Map` is a custom
 * scalar (metadata, entitlement values, usage limits) whose contents
 * are opaque to the schema, so recursing into it would reject legitimate data.
 */
export function findSchemaViolations(data: unknown): string[] {
  const queryType = committedSchema.getQueryType();
  if (!queryType) throw new Error("The committed GraphQL schema declares no Query type.");

  const problems: string[] = [];
  walk(data, queryType, "data", problems);
  return problems;
}

export function assertGraphqlResponseConforms(data: unknown): void {
  pending.push(...findSchemaViolations(data));
}

/**
 * Violations are collected and reported from `afterEach`, never thrown at the
 * double.
 *
 * Throwing inside the fetch mock looked right and was useless: the client
 * catches a failed GraphQL fetch, reports a degradation and falls back to REST,
 * so the conformance error surfaced as a downstream "Unmatched route" from the
 * REST double — the schema violation, which is the actual defect, never reached
 * the report. That is the same silent-fallback mechanism that hid the outage in
 * production. Reporting out-of-band keeps the failure legible.
 */
const pending: string[] = [];

afterEach(() => {
  if (pending.length === 0) return;
  const problems = pending.splice(0, pending.length);
  throw new Error(
    `This GraphQL double served ${problems.length} field(s) the committed schema does not declare.\n` +
      `A test that passes against them proves nothing — the real API rejects the whole query,\n` +
      `and the client then falls back to REST without saying so.\n` +
      problems.map((problem) => `  · ${problem}`).join("\n") +
      `\n\nEither the field is real and the snapshot is stale ` +
      `(node scripts/sync-graphql-schema.mjs), or the double is inventing it.`,
  );
});

function walk(value: unknown, type: GraphQLNamedType, path: string, problems: string[]): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walk(item, type, `${path}[${index}]`, problems);
    }
    return;
  }

  // Scalars, enums, unions — nothing with a field set to check against.
  if (!(type instanceof GraphQLObjectType) || typeof value !== "object") return;

  const fields = type.getFields();
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const field = fields[key];
    if (!field) {
      problems.push(`${path}.${key} — no field "${key}" on type "${type.name}"`);
      continue;
    }
    walk(child, getNamedType(field.type), `${path}.${key}`, problems);
  }
}
