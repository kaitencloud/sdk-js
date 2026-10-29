// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "vite-plus/test";

import { saleUnitLabel, toSaleUnits, unitLabel } from "../src/lib/entitlement-presentation.ts";
import type { EntitlementPresentation } from "../src/types.ts";

function entitlement(over: Partial<EntitlementPresentation> = {}): EntitlementPresentation {
  return { ...over } as EntitlementPresentation;
}

// An entitlement is not always sold in the unit it is metered in: usage is
// counted in tokens and quoted per million. Without these two helpers a pricing
// table can only say "$8 per unit", which is off by the factor.
test("quotes the sale unit, not the metered unit", () => {
  const tokens = entitlement({
    unitSingular: "token",
    unitPlural: "tokens",
    saleUnitSingular: "1M tokens",
    saleUnitPlural: "1M tokens",
    saleUnitFactor: 1_000_000,
  });

  expect(unitLabel(tokens, 40_000_000)).toBe("tokens");
  expect(saleUnitLabel(tokens, 40)).toBe("1M tokens");
  expect(toSaleUnits(tokens, 40_000_000)).toBe(40);
});

test("picks singular or plural on the sale unit like unitLabel does", () => {
  const seats = entitlement({ saleUnitSingular: "seat", saleUnitPlural: "seats" });

  expect(saleUnitLabel(seats, 1)).toBe("seat");
  expect(saleUnitLabel(seats, -1)).toBe("seat");
  expect(saleUnitLabel(seats, 0)).toBe("seats");
  expect(saleUnitLabel(seats, 12)).toBe("seats");
});

test("falls back to whichever sale-unit label is present", () => {
  expect(saleUnitLabel(entitlement({ saleUnitSingular: "block" }), 5)).toBe("block");
  expect(saleUnitLabel(entitlement({ saleUnitPlural: "blocks" }), 1)).toBe("blocks");
});

// The REST read path never carries sale-unit metadata. Returning null (rather
// than falling back to the metered unit) forces the caller to choose the base
// unit deliberately, instead of quoting a per-million price as per-token.
test("returns null rather than borrowing the metered unit", () => {
  const metered = entitlement({ unitSingular: "token", unitPlural: "tokens" });

  expect(saleUnitLabel(metered, 5)).toBeNull();
  expect(toSaleUnits(metered, 40_000_000)).toBeNull();
});

// The type documents this explicitly: an absent factor means "no distinct sale
// unit", NOT "one base unit per sale unit". Defaulting to 1 would quote a 40M
// token limit as 40M sale units — the exact mistake the helper exists to stop.
test("never treats an unusable factor as 1", () => {
  for (const factor of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(toSaleUnits(entitlement({ saleUnitFactor: factor }), 40_000_000)).toBeNull();
  }
});

test("divides fractionally rather than rounding a partial sale unit away", () => {
  const tokens = entitlement({ saleUnitFactor: 1_000_000 });

  expect(toSaleUnits(tokens, 500_000)).toBe(0.5);
  expect(toSaleUnits(tokens, 0)).toBe(0);
});
