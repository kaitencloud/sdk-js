// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { parse } from "yaml";

// A small checker of a JSON value against a schema of `contracts/openapi.yaml`.
// It exists to hold the recorded fixtures to the contract: when the snapshot is
// synced and a member becomes required, nullable or bounded, a fixture that no
// longer fits fails here, instead of leaving the mapping tests to pass on an
// answer the API would not send.
//
// It reads the keywords the contract uses: `$ref`, `oneOf`, `anyOf`, `allOf`,
// `type` (a name or a list), `enum`, `required`, `properties`,
// `additionalProperties`, `items`, `minimum`/`maximum`, `minLength`/`maxLength`,
// `pattern`, and the `date-time` and `uuid` formats. Anything else is not checked.

type Schema = {
  $ref?: string;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  type?: string | string[];
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
};

const contract = parse(
  readFileSync(new URL("../../../../contracts/openapi.yaml", import.meta.url), "utf8"),
) as { components: { schemas: Record<string, Schema> } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function problems(schema: Schema, value: unknown, path: string): string[] {
  if (schema.$ref) {
    const name = schema.$ref.slice(schema.$ref.lastIndexOf("/") + 1);
    const target = contract.components.schemas[name];
    if (!target) return [`${path}: the contract has no schema ${name}`];
    return problems(target, value, path);
  }

  const found: string[] = [];
  if (schema.allOf) {
    for (const part of schema.allOf) found.push(...problems(part, value, path));
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    const options = schema[key];
    if (!options) continue;
    const matching = options.filter((option) => problems(option, value, path).length === 0);
    if (key === "oneOf" ? matching.length !== 1 : matching.length === 0) {
      found.push(`${path}: matches ${matching.length} of the ${options.length} ${key} options`);
    }
  }
  if (
    schema.enum &&
    !schema.enum.some((member) => JSON.stringify(member) === JSON.stringify(value))
  ) {
    return [
      ...found,
      `${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`,
    ];
  }
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeName(value);
    if (!allowed.some((type) => type === actual || (type === "number" && actual === "integer"))) {
      return [...found, `${path}: a ${actual} where the contract says ${allowed.join(" or ")}`];
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      found.push(`${path}: shorter than ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      found.push(`${path}: longer than ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      found.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      found.push(`${path}: ${JSON.stringify(value)} is not a date-time`);
    }
    if (schema.format === "uuid" && !UUID.test(value)) {
      found.push(`${path}: ${JSON.stringify(value)} is not a uuid`);
    }
  } else if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      found.push(`${path}: below ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      found.push(`${path}: above ${schema.maximum}`);
    }
  } else if (Array.isArray(value)) {
    const items = schema.items;
    if (items) value.forEach((item, at) => found.push(...problems(items, item, `${path}[${at}]`)));
  } else if (isRecord(value)) {
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) {
      if (!(name in value)) found.push(`${path}: the required member ${name} is missing`);
    }
    for (const [name, member] of Object.entries(value)) {
      const declared = properties[name];
      const extra = schema.additionalProperties;
      if (declared) found.push(...problems(declared, member, `${path}.${name}`));
      else if (extra === false) found.push(`${path}: ${name} is not a member of the schema`);
      else if (typeof extra === "object") found.push(...problems(extra, member, `${path}.${name}`));
    }
  }
  return found;
}

/** What is wrong with `value` as an instance of the contract's schema `name`; empty when it fits. */
export function contractProblems(name: string, value: unknown): string[] {
  return problems({ $ref: `#/components/schemas/${name}` }, value, name);
}
