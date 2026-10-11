// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { contractProblems } from "./support/contract-schema.ts";
import { QUOTA_EXCEEDED } from "./support/session-answers.ts";

// The recorded answers are what the mapping tests read. They only mean something
// while they are answers the contract allows, so each is checked against its
// response schema in `contracts/openapi.yaml`. When the snapshot is synced and a
// member becomes required, nullable or bounded, this file fails where the
// fixtures no longer fit, and the fixtures are regenerated from Kaiten as
// `fixtures/README.md` says.

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;
}

describe("the public catalogue fixture", () => {
  const catalog = fixture<Record<string, unknown>>("public-catalog.acme.json");

  test("is an answer the contract allows", () => {
    expect(contractProblems("PublicCatalog", catalog)).toEqual([]);
  });

  test("is refused when it no longer fits, so the check can fail", () => {
    const { plans: _plans, ...withoutPlans } = catalog;
    expect(contractProblems("PublicCatalog", withoutPlans)).not.toEqual([]);
    expect(contractProblems("PublicCatalog", { ...catalog, plans: [{ id: 7 }] })).not.toEqual([]);
  });
});

/** The response schema each answer of `session.initech.json` is held to, by its key. */
function sessionSchema(key: string): string {
  if (key === "portalSession") return "PortalSession";
  if (key.startsWith("portal")) return "SessionPortal";
  if (key.startsWith("invoices")) return "PageSessionInvoice";
  if (key.startsWith("checkout")) return "SessionCheckout";
  if (key === "cancel" || key === "reactivate") return "SessionSubscription";
  if (key === "paymentMethodSession") return "PaymentMethodSession";
  if (key.startsWith("paymentMethodCompleted")) return "CompletedPaymentMethodSession";
  if (key.startsWith("voucher")) return "SessionVoucherValidity";
  if (key.startsWith("addon")) return "SessionAddon";
  throw new Error(`No response schema is named for the session answer ${key}`);
}

describe("the customer session fixture", () => {
  const { errors, ...answers } = fixture<
    Record<string, unknown> & { errors: Record<string, { status: number; body: unknown }> }
  >("session.initech.json");

  test.each(Object.keys(answers))("%s is an answer the contract allows", (key) => {
    expect(contractProblems(sessionSchema(key), answers[key])).toEqual([]);
  });

  test.each(Object.keys(errors))("the refusal %s is a problem the contract allows", (key) => {
    expect(contractProblems("Problem", errors[key]!.body)).toEqual([]);
  });

  test("the quota refusal the tests add is a problem the contract allows", () => {
    expect(contractProblems("Problem", QUOTA_EXCEEDED.body)).toEqual([]);
  });

  test("is refused when it no longer fits, so the check can fail", () => {
    const portal = answers.portal as Record<string, unknown>;
    const { subscription: _subscription, ...withoutSubscription } = portal;
    expect(contractProblems("SessionPortal", withoutSubscription)).not.toEqual([]);
    expect(contractProblems("SessionPortal", { ...portal, unknown: true })).not.toEqual([]);
    expect(contractProblems("SessionPortal", { ...portal, instances: "none" })).not.toEqual([]);
  });
});
