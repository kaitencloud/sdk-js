// How a limit is made up, written down from the figures the server sends. The server settles the
// arithmetic, so the tests give it figures that do not add up, and hold the note to saying them.

import { expect, test } from "vite-plus/test";
import type { EntitlementProvenance } from "@kaitencloud/react";

import { provenanceExpression } from "../src/components/customer-portal/sections/provenance-note.tsx";
import { englishPortalBillingWords as words } from "../src/components/shared/billing-words.ts";

const number = (patch: Partial<NonNullable<EntitlementProvenance["number"]>>) => ({
  license: 100,
  afterAddons: 100,
  boostSet: null,
  boostAdd: null,
  boostMultiply: null,
  unlimited: false,
  effective: 100,
  ...patch,
});

const addon = (quantity: number, value: number, overrideBehavior = "ADD") => ({
  instanceAddonId: "ia",
  addonId: "a",
  addonEntitlementId: "ae",
  quantity,
  overrideBehavior,
  value: { type: "number" as const, value },
  limitCapExceededOveragePercent: null,
  attachedAt: "2026-10-02T00:00:00Z",
});

const provenance = (
  patch: Partial<NonNullable<EntitlementProvenance["number"]>>,
  addons: EntitlementProvenance["addons"] = [],
): EntitlementProvenance => ({
  license: null,
  addons,
  boosts: [],
  number: number(patch),
});

test("a limit nothing but the licence sets has nothing to say", () => {
  expect(provenanceExpression(undefined, words)).toBeNull();
  expect(
    provenanceExpression({ license: null, addons: [], boosts: [], number: null }, words),
  ).toBeNull();
});

test("a multiplying voucher, as the server's own example has it", () => {
  expect(provenanceExpression(provenance({ boostMultiply: 2, effective: 200 }), words)).toBe(
    "(100 base) × 2 voucher = 200",
  );
});

test("add-ons, then a voucher", () => {
  expect(
    provenanceExpression(
      provenance({ license: 10_000, afterAddons: 13_000, boostMultiply: 2, effective: 26_000 }, [
        addon(3, 1_000),
      ]),
      words,
    ),
  ).toBe("(10,000 base + 3 × 1,000 add-on) × 2 voucher = 26,000");
});

test("it writes the effective figure the server sent, not one it works out", () => {
  // 100 × 2 is 200, and the server says 999: 999 is what is written.
  expect(provenanceExpression(provenance({ boostMultiply: 2, effective: 999 }), words)).toBe(
    "(100 base) × 2 voucher = 999",
  );
});

test("a voucher that sets, and one that adds or takes away", () => {
  expect(provenanceExpression(provenance({ boostSet: 500, effective: 500 }), words)).toBe(
    "500 voucher = 500",
  );
  expect(provenanceExpression(provenance({ boostAdd: 50, effective: 150 }), words)).toBe(
    "100 base + 50 voucher = 150",
  );
  expect(provenanceExpression(provenance({ boostAdd: -50, effective: 50 }), words)).toBe(
    "100 base − 50 voucher = 50",
  );
});

test("an add-on that overrides or raises to a floor is not written as a term", () => {
  expect(
    provenanceExpression(
      provenance({ afterAddons: 400, effective: 400 }, [addon(2, 200, "OVERRIDE")]),
      words,
    ),
  ).toBe("400 with add-ons = 400");
});

test("add-ons alone grant a limit", () => {
  expect(
    provenanceExpression(
      provenance({ license: null, afterAddons: 30, effective: 30 }, [addon(3, 10)]),
      words,
    ),
  ).toBe("3 × 10 add-on = 30");
});

test("unlimited is said, with no arithmetic", () => {
  expect(provenanceExpression(provenance({ unlimited: true, effective: -1 }), words)).toBe(
    "Unlimited with a voucher",
  );
});
