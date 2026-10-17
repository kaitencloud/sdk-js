// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import * as server from "../src/index.ts";
import { createKaitenClient } from "../src/index.ts";

// The resource classes are generated from contracts/openapi.yaml. What ships is
// what the generator makes of it, so this holds the result to the contract: every
// operation of the snapshot is one static method of one exported class, the
// method sends the verb to the path the contract gives it, and the classes of the
// billing routes hold the operations of their tag and no others.

interface Operation {
  operationId: string;
  method: string;
  path: string;
  tags: string[];
}

const CONTRACT = readFileSync(new URL("../../../contracts/openapi.yaml", import.meta.url), "utf8");

/**
 * The REST operations of the snapshot, read as it is laid out: a path at two
 * spaces of indent, its methods at four, and each method's `operationId` and
 * tags at six and eight. Webhooks are not paths and are left out.
 */
function operations(yaml: string): Operation[] {
  const found: Operation[] = [];
  let inPaths = false;
  let path: string | undefined;
  let current: Operation | undefined;
  let inTags = false;
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) {
      inPaths = line.startsWith("paths:");
      continue;
    }
    if (!inPaths) continue;
    const pathLine = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathLine) {
      path = pathLine[1];
      current = undefined;
      inTags = false;
      continue;
    }
    const methodLine = /^ {4}(get|put|post|delete|patch):\s*$/.exec(line);
    if (methodLine && path) {
      current = { operationId: "", method: methodLine[1]!.toUpperCase(), path, tags: [] };
      inTags = false;
      continue;
    }
    const idLine = /^ {6}operationId: (\S+)\s*$/.exec(line);
    if (idLine && current) {
      current.operationId = idLine[1]!;
      found.push(current);
      continue;
    }
    if (/^ {6}tags:\s*$/.test(line)) {
      inTags = true;
      continue;
    }
    const tagLine = /^ {8}- (.+?)\s*$/.exec(line);
    if (inTags && tagLine && current) {
      current.tags.push(tagLine[1]!.replace(/^"|"$/g, ""));
      continue;
    }
    if (inTags && !tagLine) inTags = false;
  }
  return found;
}

/** The generator's name for an operation: `list-customers` is `listCustomers`. */
const methodName = (operationId: string) =>
  operationId.replace(/[-_ ]+(.)/g, (_, next: string) => next.toUpperCase());

/** The resource classes the package exports: the exports with static methods. */
function resourceClasses() {
  const classes = new Map<string, Record<string, unknown>>();
  for (const [name, value] of Object.entries(server)) {
    if (typeof value !== "function") continue;
    const statics = Object.getOwnPropertyNames(value).filter(
      (member) => typeof (value as unknown as Record<string, unknown>)[member] === "function",
    );
    if (statics.length > 0) classes.set(name, value as unknown as Record<string, unknown>);
  }
  return classes;
}

const ALL = operations(CONTRACT);
const CLASSES = resourceClasses();

/** The class the generator makes of a tag: `customer-sessions` is `CustomerSessions`, `OFREP Core` is `OfrepCore`. */
const byName = (a: string | undefined, b: string | undefined) => (a ?? "").localeCompare(b ?? "");
const alnum = (text: string) => text.replace(/[^a-z0-9]/gi, "").toLowerCase();
const classOf = (tag: string) => [...CLASSES.keys()].find((name) => alnum(name) === alnum(tag));

/** Which class holds which method. A method name in two classes would shadow one. */
const OWNERS = new Map<string, string[]>();
for (const [name, cls] of CLASSES) {
  for (const member of Object.getOwnPropertyNames(cls)) {
    if (typeof cls[member] !== "function") continue;
    OWNERS.set(member, [...(OWNERS.get(member) ?? []), name]);
  }
}

describe("the contract and the generated classes", () => {
  test("the snapshot is read whole", () => {
    // 206 REST operations at the snapshot; a read that finds far fewer has lost
    // its footing in the file, and every test below would pass on what is left.
    expect(ALL.length).toBeGreaterThan(200);
    expect(new Set(ALL.map((operation) => operation.operationId)).size).toBe(ALL.length);
  });

  test("every operation is a static method of the class of each of its tags", () => {
    // One class per tag; an operation with two tags is a method of both.
    const wrong = ALL.filter((operation) => {
      const expected = operation.tags.map(classOf).sort(byName);
      const held = [...(OWNERS.get(methodName(operation.operationId)) ?? [])].sort(byName);
      return JSON.stringify(held) !== JSON.stringify(expected);
    });

    expect(wrong.map((operation) => operation.operationId)).toEqual([]);
  });

  test("no class has a method the contract has no operation for", () => {
    const known = new Set(ALL.map((operation) => methodName(operation.operationId)));
    const extra = [...OWNERS.keys()].filter((member) => !known.has(member));

    expect(extra).toEqual([]);
  });

  test("a call sends the operation's verb to its path, under /api", async () => {
    const seen: Request[] = [];
    const client = createKaitenClient({
      token: "ksh_x",
      baseUrl: "https://example.test",
      fetch: async (input, init) => {
        seen.push(input instanceof Request ? input : new Request(input, init));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    for (const operation of ALL) {
      const name = methodName(operation.operationId);
      const owner = OWNERS.get(name)?.[0];
      const cls = owner ? CLASSES.get(owner) : undefined;
      const call = cls?.[name] as ((options: unknown) => Promise<unknown>) | undefined;
      if (!call) continue;

      const parameters = [...operation.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
      const path = Object.fromEntries(parameters.map((parameter) => [parameter, `${parameter}-v`]));
      const hasBody = operation.method !== "GET" && operation.method !== "DELETE";
      await call.call(cls, { client, path, ...(hasBody ? { body: {} } : {}) });
    }

    const sent = seen.map((request) => `${request.method} ${new URL(request.url).pathname}`);
    const expected = ALL.map(
      (operation) => `${operation.method} /api${operation.path.replace(/\{(\w+)\}/g, "$1-v")}`,
    );
    expect(sent).toEqual(expected);
  });
});

describe("the classes of the billing routes", () => {
  test.for([
    "addons",
    "billing",
    "customer-sessions",
    "public",
    "publishable-keys",
    "vouchers",
  ] as const)("%s holds the operations of its tag, and only those", (tag) => {
    const name = classOf(tag);
    const cls = name ? CLASSES.get(name) : undefined;
    expect(cls, `a class for the tag ${tag} is exported`).toBeDefined();

    const held = Object.getOwnPropertyNames(cls!)
      .filter((member) => typeof cls![member] === "function")
      .sort((a, b) => a.localeCompare(b));
    const declared = ALL.filter((operation) => operation.tags.includes(tag))
      .map((operation) => methodName(operation.operationId))
      .sort((a, b) => a.localeCompare(b));

    expect(held).toEqual(declared);
    expect(held.length).toBeGreaterThan(0);
  });

  /** The static methods of a resource class, by name. */
  const methodsOf = (cls: object) =>
    Object.getOwnPropertyNames(cls)
      .filter((member) => typeof (cls as Record<string, unknown>)[member] === "function")
      .sort(byName);

  test("the customer sessions are minted and revoked, and nothing else", () => {
    expect(methodsOf(server.CustomerSessions)).toEqual([
      "createCustomerSession",
      "revokeCustomerSession",
    ]);
  });

  test("the publishable keys are issued, listed, changed and revoked, and nothing else", () => {
    expect(methodsOf(server.PublishableKeys)).toEqual([
      "createPublishableKey",
      "listPublishableKeys",
      "revokePublishableKey",
      "updatePublishableKey",
    ]);
  });

  test("the public surface is the catalogue and the ten calls of a customer session", () => {
    const publicOperations = ALL.filter((operation) => operation.tags.includes("public"));

    expect(
      publicOperations.map((operation) => `${operation.method} ${operation.path}`).sort(byName),
    ).toEqual(
      [
        "GET /public/catalog",
        "GET /public/session/invoices",
        "GET /public/session/portal",
        "POST /public/session/billing/cancel",
        "POST /public/session/billing/payment-method-session",
        "POST /public/session/billing/payment-method-session/{sessionId}/complete",
        "POST /public/session/billing/portal-session",
        "POST /public/session/billing/reactivate",
        "POST /public/session/checkout",
        "POST /public/session/vouchers/validate",
        "PUT /public/session/addons/{addonSlug}",
      ].sort(byName),
    );
  });
});
