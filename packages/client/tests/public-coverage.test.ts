// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { KaitenClient, KaitenSessionClient } from "../src/index.ts";
import type { KaitenApi, KaitenSessionClientLike } from "../src/index.ts";
import { createMockKaitenSessionClient } from "../src/testing/index.ts";
import { answer } from "./support/session-answers.ts";
import {
  json,
  KST_A,
  MINUTE,
  server,
  session,
  sessionClient,
  sessions,
  T0,
  useSessionClock,
} from "./support/session-harness.ts";

// The public surface is the operations of the contract under `/public/`: the
// catalogue, read with a publishable key, and the ten calls of a customer
// session. Each is one method, and a new one in the contract fails this file
// until the SDK has its method.
useSessionClock();

const CONTRACT = readFileSync(new URL("../../../contracts/openapi.yaml", import.meta.url), "utf8");
const CATALOG = JSON.parse(
  readFileSync(new URL("./fixtures/public-catalog.acme.json", import.meta.url), "utf8"),
) as KaitenApi.PublicCatalog;

/**
 * The operations of the contract under `/public/`, read from the snapshot as it
 * is laid out: a path at two spaces of indent, its methods at four, and each
 * method's `operationId` at six.
 */
function publicOperations(yaml: string) {
  const operations: { operationId: string; method: string; path: string }[] = [];
  let inPaths = false;
  let path: string | undefined;
  let method: string | undefined;
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) {
      inPaths = line.startsWith("paths:");
      continue;
    }
    if (!inPaths) continue;
    const pathLine = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathLine) {
      path = pathLine[1];
      method = undefined;
      continue;
    }
    const methodLine = /^ {4}(get|put|post|delete|patch):\s*$/.exec(line);
    if (methodLine) {
      method = methodLine[1]!.toUpperCase();
      continue;
    }
    const idLine = /^ {6}operationId: (\S+)\s*$/.exec(line);
    if (idLine && path?.startsWith("/public/") && method) {
      operations.push({ operationId: idLine[1]!, method, path });
    }
  }
  return operations;
}

/** The operation each method of the session client is for. A method added to the interface needs a line. */
const OPERATION_OF: Record<keyof KaitenSessionClientLike, string> = {
  getPortal: "getSessionPortal",
  listInvoices: "listSessionInvoices",
  checkout: "createSessionCheckout",
  cancelSubscription: "cancelSessionSubscription",
  reactivateSubscription: "reactivateSessionSubscription",
  createPortalSession: "createSessionPortalSession",
  createPaymentMethodSession: "createSessionPaymentMethodSession",
  completePaymentMethodSession: "completeSessionPaymentMethodSession",
  validateVoucher: "validateSessionVoucher",
  setAddonQuantity: "setSessionAddonQuantity",
};
const CATALOG_OPERATION = "getPublicCatalog";

/** What a call is given, and what the route answers: enough to make each method go through. */
const CALLS: Record<
  keyof KaitenSessionClientLike,
  {
    call: (client: KaitenSessionClientLike) => Promise<unknown>;
    reply: () => unknown;
    /** The values of the path's parameters. */
    params?: Record<string, string>;
  }
> = {
  getPortal: { call: (c) => c.getPortal(), reply: () => answer("portal") },
  listInvoices: { call: (c) => c.listInvoices(), reply: () => answer("invoicesEmpty") },
  checkout: {
    call: (c) => c.checkout({ licensePriceId: "p", dryRun: true }),
    reply: () => answer("checkoutPreview"),
  },
  cancelSubscription: { call: (c) => c.cancelSubscription(), reply: () => answer("cancel") },
  reactivateSubscription: {
    call: (c) => c.reactivateSubscription(),
    reply: () => answer("reactivate"),
  },
  createPortalSession: {
    call: (c) => c.createPortalSession({ returnUrl: "https://app.test/b" }),
    reply: () => answer("portalSession"),
  },
  createPaymentMethodSession: {
    call: (c) => c.createPaymentMethodSession({ returnUrl: "https://app.test/b" }),
    reply: () => answer("paymentMethodSession"),
  },
  completePaymentMethodSession: {
    call: (c) => c.completePaymentMethodSession("cs_1"),
    reply: () => answer("paymentMethodCompleted"),
    params: { sessionId: "cs_1" },
  },
  validateVoucher: {
    call: (c) => c.validateVoucher({ code: "WELCOME20" }),
    reply: () => answer("voucherRefused"),
  },
  setAddonQuantity: {
    call: (c) => c.setAddonQuantity("extra-seats-v1", 1),
    reply: () => answer("addon"),
    params: { addonSlug: "extra-seats-v1" },
  },
};

const publicRoutes = publicOperations(CONTRACT);
// The three routes of an anonymous checkout, under /public/checkout-sessions, are held to the
// contract by their own suite; this one covers the catalogue and the customer session.
const operations = publicRoutes.filter(
  (found) => !found.path.startsWith("/public/checkout-sessions"),
);
const operation = (operationId: string) =>
  operations.find((found) => found.operationId === operationId);
const filled = (path: string, params: Record<string, string> = {}) =>
  path.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);

describe("the public operations of the contract", () => {
  test("the anonymous checkout is the three routes under /public/checkout-sessions", () => {
    expect(
      publicRoutes
        .filter((found) => found.path.startsWith("/public/checkout-sessions"))
        .map((found) => found.operationId)
        .sort(),
    ).toEqual(["confirmCheckoutSession", "createCheckoutSession", "getCheckoutSession"]);
  });

  test("are the catalogue and the ten calls of a session: eleven", () => {
    expect(operations).toHaveLength(11);
    expect(operations.map((found) => found.operationId).sort()).toEqual(
      [CATALOG_OPERATION, ...Object.values(OPERATION_OF)].sort(),
    );
  });

  test("the contract names the routes this suite expects", () => {
    expect(operation(CATALOG_OPERATION)).toMatchObject({ method: "GET", path: "/public/catalog" });
    for (const operationId of Object.values(OPERATION_OF)) {
      expect(operation(operationId)?.path, operationId).toMatch(/^\/public\/session\//);
    }
  });
});

describe("each is one method", () => {
  test("getCatalog reads /public/catalog with a publishable key, and nothing else", async () => {
    const { fetch, requests } = server(() => json(CATALOG));
    const client = new KaitenClient({
      apiUrl: "https://api.acme.test/api",
      authScheme: "publishable",
      tokenProvider: () => `pk_${"a".repeat(43)}`,
      fetch,
    });

    const catalog = await client.getCatalog();

    const contract = operation(CATALOG_OPERATION)!;
    expect(catalog.plans.length).toBeGreaterThan(0);
    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      [contract.method, `/api${contract.path}`],
    ]);
    expect(requests[0]!.headers.get("X-Kaiten-Publishable-Key")).toBe(`pk_${"a".repeat(43)}`);
    expect(requests[0]!.headers.get("Authorization")).toBeNull();
  });

  for (const [method, operationId] of Object.entries(OPERATION_OF) as [
    keyof KaitenSessionClientLike,
    string,
  ][]) {
    test(`${method} is ${operationId}, on the route and with the verb the contract gives it`, async () => {
      const contract = operation(operationId)!;
      const { call, reply, params } = CALLS[method];
      const { fetch, requests } = server(() => json(reply()));
      const client = sessionClient(fetch, sessions(session(KST_A, T0 + 30 * MINUTE)));

      await call(client);

      expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
        [contract.method, `/api${filled(contract.path, params)}`],
      ]);
      expect(requests[0]!.headers.get("Authorization")).toBe(`Bearer ${KST_A}`);
    });
  }

  test("the session client and its double have a method for each, and none more", () => {
    const methods = Object.keys(OPERATION_OF).sort();
    const double = createMockKaitenSessionClient();

    for (const method of methods) {
      expect(typeof (KaitenSessionClient.prototype as never)[method], method).toBe("function");
      expect(typeof (double as never)[method], method).toBe("function");
    }
    const callable = Object.keys(double)
      .filter((key) => typeof (double as never)[key] === "function")
      .filter((key) => !["setPortal", "setInvoices"].includes(key))
      .sort();
    expect(callable).toEqual(methods);
  });
});
