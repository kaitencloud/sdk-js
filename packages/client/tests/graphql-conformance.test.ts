// The GraphQL contract, checked from inside the test run.
//
// `scripts/check-graphql-drift.mjs` already guards this, in two gates:
//
//   Gate A (documents ⊆ snapshot) compares two artifacts that can go stale
//   TOGETHER. If `documents.ts` and `contracts/schema.graphql` were frozen at
//   the same moment, the gate would confirm the SDK agrees with its own
//   out-of-date picture of the backend. It is a self-consistency check.
//
//   Gate B (snapshot == the backend schema) is the one that measures anything,
//   and it only runs where that schema can be read: the published
//   `@kaitencloud/graphql-schema`, or a local checkout of kaiten.
//
// A query that asks for an undeclared field is rejected whole, and
// `getLicensingSnapshot` falls back to REST — silently, by design. Duplicating
// gate A here would not change that. What this file adds is the third leg:
// proof that the DOUBLES cannot invent the fields the documents wrongly ask
// for, which is what would keep the unit suite green.

import { describe, expect, test } from "vite-plus/test";
import { parse, validate } from "graphql";

import { LICENSING_CATALOG_QUERY, LICENSING_SNAPSHOT_QUERY } from "../src/graphql/documents.ts";
import { committedSchema, findSchemaViolations } from "./support/graphql-conformance.ts";

const OPERATIONS = [
  ["LicensingSnapshot", LICENSING_SNAPSHOT_QUERY.toString()],
  ["LicensingCatalog", LICENSING_CATALOG_QUERY.toString()],
] as const;

describe("the shipped GraphQL operations", () => {
  // The failure mode with no symptom. A single invalid field rejects the WHOLE
  // query — the server never answers partially — so one stale name takes down
  // the icons, units, sale units and entitlement groups that only this path
  // carries. The client then reports a degradation and serves REST, which is
  // indistinguishable from "the network hiccuped" unless somebody is watching
  // the degradation callback.
  test.each(OPERATIONS)("%s validates against the committed schema", (_name, source) => {
    expect(validate(committedSchema, parse(source))).toEqual([]);
  });

  // The window bounds are the reason this file exists at all. They are what lets
  // the primary read path answer a cadence instead of `usageWindowUnknown`, and
  // they were dropped for so long that the SDK grew a flag to describe the gap.
  // Pinned by name: dropping them again is a silent regression to "every meter
  // is UNKNOWN", which no other test would notice.
  test("LicensingSnapshot selects the entitlement usage window", () => {
    const source = LICENSING_SNAPSHOT_QUERY.toString();
    for (const field of ["limit", "currentPeriodStart", "currentPeriodEnd"]) {
      expect(source).toContain(field);
    }
  });
});

describe("the conformance guard itself", () => {
  // A guard nobody has seen fail is indistinguishable from a guard that does
  // nothing. These three names are the exact fields that were dead in
  // production, and the doubles used to serve all three.
  test.each([
    ["License.isActive", { licenses: { items: [{ isActive: true }] } }],
    [
      "LicenseEntitlement.licenseID",
      { licenses: { items: [{ entitlements: [{ licenseID: "lic-1" }] }] } },
    ],
    ["Instance.deletedAt", { customer: { instances: [{ deletedAt: null }] } }],
  ])("rejects a double serving %s", (_name, data) => {
    expect(findSchemaViolations(data)).toHaveLength(1);
  });

  test("accepts a response built only from declared fields", () => {
    expect(
      findSchemaViolations({
        licenses: { items: [{ id: "lic-1", slug: "pro", isDefault: true }], hasMore: false },
        customer: { id: "c-1", slug: "acme", instances: [{ id: "i-1", slug: "prod" }] },
      }),
    ).toEqual([]);
  });

  // `Map` is a custom scalar — metadata, entitlement values and usage
  // limits are opaque JSON. Recursing into one would reject legitimate data, so
  // the walk must stop at the scalar boundary.
  test("does not walk into opaque Map scalars", () => {
    expect(
      findSchemaViolations({
        customer: {
          instances: [{ metadata: { anything: { nested: true } } }],
        },
      }),
    ).toEqual([]);
  });
});
