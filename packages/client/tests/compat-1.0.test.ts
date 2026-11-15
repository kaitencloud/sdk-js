// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Code written against @kaitencloud/client 1.0.0 must keep compiling, unchanged,
// against every 1.x. This file is such code: `vp check` type-checks it, so a
// breaking change to the surface it touches fails the build. Do not adapt it to
// a new release; it is the 1.0 consumer.

import { describe, expect, test } from "vite-plus/test";

import { KaitenClient, normalizePlanPrices } from "../src/index.ts";
import type {
  Addon,
  BillingCapabilities,
  BillingInterval,
  BulkEvaluationResponse,
  EntitlementType,
  EvaluationSuccess,
  KaitenCatalog,
  KaitenClientConfig,
  KaitenClientLike,
  LicensingSnapshot,
  Plan,
  PlanPrice,
  ResolvedEntitlement,
} from "../src/index.ts";

/** Compile-time equality of two types. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const exactly = <T extends true>(): T => true as T;

// The 1.0 enumerations a reader may have switched over exhaustively.
exactly<Equal<BillingInterval, "month" | "year" | "one_time">>();
// `EntitlementType` is the one enumeration 1.0.0 published that has grown since.
// It named three types while the API already sent a fourth, `NUMBER_AI_CREDIT`,
// so a minor release corrected it: a `switch` over it with no `default` stops
// compiling until it has the new case. It is frozen at that state. Another
// member would break the same switches again, and fails the build here.
exactly<Equal<EntitlementType, "BOOLEAN" | "NUMBER" | "CONFIG" | "NUMBER_AI_CREDIT">>();
exactly<Equal<ResolvedEntitlement["source"], "license" | "addon" | "credit">>();
exactly<
  Equal<ResolvedEntitlement["status"], "enabled" | "disabled" | "near_limit" | "over_limit">
>();

// A 1.0 double: exactly the five methods, no cast.
const double: KaitenClientLike = {
  getCatalog: async (): Promise<KaitenCatalog> => ({ plans: [] }),
  getLicensingSnapshot: async (): Promise<LicensingSnapshot> => snapshot,
  evaluateFlag: async (key: string): Promise<EvaluationSuccess> =>
    ({ key, value: true, reason: "STATIC" }) as EvaluationSuccess,
  evaluateFlags: async (): Promise<BulkEvaluationResponse> => ({ flags: [] }),
  reportUsage: async () => ({
    entitlementId: "e",
    entitlementSlug: "seats",
    licenseId: "l",
    licenseSlug: "pro",
    value: { type: "number", value: 1 },
  }),
};

// 1.0 values, built the way 1.0 code builds them.
const monthly: PlanPrice = {
  amount: 4900,
  currencyCode: "EUR",
  interval: "month",
  label: "Monthly",
};
const plan: Plan = { slug: "pro", name: "Pro", price: 4900, annualPrice: 49000, prices: [monthly] };
const addon: Addon = { slug: "seats", name: "Seats", price: 1000, interval: "month" };
const capabilities: BillingCapabilities = {
  paymentMethods: false,
  invoices: false,
  unsubscribe: false,
  checkout: false,
};
const snapshot: LicensingSnapshot = {
  source: "snapshot",
  customer: null,
  instance: null,
  license: null,
  plans: [plan],
  addOns: [addon],
  credits: [],
  entitlements: [],
  flags: [],
  actions: [],
  capabilities,
};
const config: KaitenClientConfig = {
  apiUrl: "https://api.test",
  authScheme: "bearer",
  tokenProvider: () => "ksh_server",
};

// A 1.0 reader: what it reads is still there, with the type it had.
function headline(catalog: KaitenCatalog): string[] {
  return catalog.plans.map((entry) => {
    const price: PlanPrice | undefined = entry.prices?.find((item) => item.interval === "month");
    const amount: number = price?.amount ?? 0;
    return `${entry.name}: ${amount} ${price?.currencyCode ?? ""}`;
  });
}

describe("1.0 consumers", () => {
  test("a 1.0 double, 1.0 values and a 1.0 reader compile and run unchanged", async () => {
    expect(headline(await double.getCatalog())).toEqual([]);
    expect(headline({ plans: [plan] })).toEqual(["Pro: 4900 EUR"]);
    expect(normalizePlanPrices({ slug: "x", name: "X", price: 100 }).prices).toEqual([
      { amount: 100, currencyCode: undefined, interval: undefined },
    ]);
    expect(new KaitenClient(config)).toBeInstanceOf(KaitenClient);
  });
});

describe("1.0 enumerations", () => {
  test("EntitlementType is closed over the four types the API sends", () => {
    // Exhaustive without a default: it compiles only while the union is exactly
    // the four members below.
    const meter = (type: EntitlementType): "flag" | "setting" | "metered" => {
      switch (type) {
        case "BOOLEAN":
          return "flag";
        case "CONFIG":
          return "setting";
        case "NUMBER":
        case "NUMBER_AI_CREDIT":
          return "metered";
        default: {
          const unreachable: never = type;
          return unreachable;
        }
      }
    };

    expect(
      (["BOOLEAN", "NUMBER", "CONFIG", "NUMBER_AI_CREDIT"] as const).map((type) => meter(type)),
    ).toEqual(["flag", "metered", "setting", "metered"]);
  });
});
