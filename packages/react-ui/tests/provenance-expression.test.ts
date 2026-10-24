// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

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

// The add-ons that override the licence do not stack: which one wins is the server's to say, and
// the figure after them is all that is written, however many there are. The figures below are not
// the sum of the add-ons', on purpose.
test("several add-ons that override are one figure, the server's, whatever their number", () => {
  expect(
    provenanceExpression(
      provenance({ license: 100, afterAddons: 300, effective: 300 }, [
        addon(1, 200, "OVERRIDE"),
        addon(1, 300, "OVERRIDE"),
      ]),
      words,
    ),
  ).toBe("300 with add-ons = 300");

  expect(
    provenanceExpression(
      provenance({ license: 100, afterAddons: 450, effective: 450 }, [
        addon(2, 150, "OVERRIDE"),
        addon(1, 100, "OVERRIDE"),
        addon(3, 50, "OVERRIDE"),
      ]),
      words,
    ),
  ).toBe("450 with add-ons = 450");
});

test("add-ons that override and add, or raise to a floor, are one figure too", () => {
  expect(
    provenanceExpression(
      provenance({ license: 100, afterAddons: 260, effective: 260 }, [
        addon(2, 30, "ADD"),
        addon(1, 200, "OVERRIDE"),
        addon(1, 150, "MAX"),
      ]),
      words,
    ),
  ).toBe("260 with add-ons = 260");
});

test("an override that is not known yet reads as the figure after the add-ons", () => {
  expect(
    provenanceExpression(
      provenance({ afterAddons: 70, effective: 70 }, [addon(1, 70, "SOMETHING_NEW")]),
      words,
    ),
  ).toBe("70 with add-ons = 70");
});

test("add-ons that override, then a voucher that multiplies or adds", () => {
  const overriding = [addon(1, 200, "OVERRIDE"), addon(1, 300, "OVERRIDE")];
  expect(
    provenanceExpression(
      provenance({ afterAddons: 300, boostMultiply: 2, effective: 600 }, overriding),
      words,
    ),
  ).toBe("(300 with add-ons) × 2 voucher = 600");
  expect(
    provenanceExpression(
      provenance({ afterAddons: 300, boostAdd: 50, effective: 350 }, overriding),
      words,
    ),
  ).toBe("300 with add-ons + 50 voucher = 350");
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
    "Unlimited",
  );
});
