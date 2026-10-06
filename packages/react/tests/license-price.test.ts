import { expect, test } from "vite-plus/test";

import { isHeadlinePrice, resolveLicensePrice } from "../src/lib/license-price.ts";
import type { License, Plan } from "../src/types.ts";

function license(over: Partial<License> = {}): License {
  return {
    id: "lic-1",
    slug: "pro",
    name: "Pro License",
    description: "",
    type: "PAID",
    version: "1",
    lifecycleState: "PUBLISHED",
    familyId: "fam-1",
    isDefault: false,
    ...over,
  };
}

function plan(over: Partial<Plan> = {}): Plan {
  return { slug: "pro", name: "Pro", ...over };
}

// The join the portal never made: prices live on Plan, the section reads
// License, and `planFromLicense` gives every plan its license's slug.
test("joins the license to its catalog plan by slug", () => {
  const resolved = resolveLicensePrice(license(), [
    plan({ slug: "starter", price: 900 }),
    plan({ slug: "pro", price: 7900, currencyCode: "EUR", interval: "month" }),
  ]);

  expect(resolved).toEqual({ amount: 7900, currencyCode: "EUR", interval: "month" });
});

test("returns null when no plan carries the license's slug", () => {
  expect(resolveLicensePrice(license({ slug: "bespoke" }), [plan({ price: 7900 })])).toBeNull();
});

// The normal case today: Kaiten models no prices server-side, so the joined plan
// has no amount at all. Null, never a zero — the caller renders nothing.
test("returns null when the joined plan has no amount", () => {
  expect(resolveLicensePrice(license(), [plan()])).toBeNull();
  expect(resolveLicensePrice(license(), [])).toBeNull();
  expect(resolveLicensePrice(license(), undefined)).toBeNull();
  expect(resolveLicensePrice(null, [plan({ price: 7900 })])).toBeNull();
});

// The portal has no interval toggle. What the customer pays is a property of the
// license they already hold, so that is what selects among a plan's prices.
test("selects the price matching the license's own billing interval", () => {
  const prices = [
    { amount: 7900, interval: "month" as const },
    { amount: 79_000, interval: "year" as const },
  ];

  expect(
    resolveLicensePrice(license({ billingInterval: "year" }), [plan({ prices })]),
  ).toMatchObject({ amount: 79_000, interval: "year" });
  expect(
    resolveLicensePrice(license({ billingInterval: "month" }), [plan({ prices })]),
  ).toMatchObject({ amount: 7900, interval: "month" });
});

test("falls back to the plan's interval when the license states none", () => {
  const resolved = resolveLicensePrice(license(), [
    plan({
      interval: "year",
      prices: [
        { amount: 7900, interval: "month" },
        { amount: 79_000, interval: "year" },
      ],
    }),
  ]);

  expect(resolved).toMatchObject({ amount: 79_000, interval: "year" });
});

// A single price is unambiguous whatever the interval says. Several are not:
// showing one of them would be picking a tariff on the customer's behalf, which
// is the same class of mistake as inventing an amount.
test("uses a lone price regardless of interval, but never guesses among several", () => {
  expect(
    resolveLicensePrice(license({ billingInterval: "year" }), [
      plan({ prices: [{ amount: 7900, interval: "month" }] }),
    ]),
  ).toMatchObject({ amount: 7900 });

  expect(
    resolveLicensePrice(license({ billingInterval: "one_time" }), [
      plan({
        prices: [
          { amount: 7900, interval: "month" },
          { amount: 79_000, interval: "year" },
        ],
      }),
    ]),
  ).toBeNull();
});

test("reads the legacy price/annualPrice fields when a plan carries no prices array", () => {
  expect(
    resolveLicensePrice(license({ billingInterval: "year" }), [
      plan({ price: 7900, annualPrice: 79_000, currencyCode: "USD", interval: "month" }),
    ]),
  ).toMatchObject({ amount: 79_000, interval: "year" });

  expect(
    resolveLicensePrice(license(), [plan({ price: 7900, currencyCode: "USD", interval: "month" })]),
  ).toMatchObject({ amount: 7900, interval: "month" });
});

// A zero is a real price — free tiers exist — and must not be confused with the
// absence of one. Only `null` means "no amount".
test("treats a zero amount as a real price", () => {
  expect(resolveLicensePrice(license(), [plan({ price: 0, interval: "month" })])).toMatchObject({
    amount: 0,
  });
});

test("prefers a price's own currency over the plan's", () => {
  const resolved = resolveLicensePrice(license(), [
    plan({
      currencyCode: "USD",
      prices: [{ amount: 7900, interval: "month", currencyCode: "JPY" }],
    }),
  ]);

  expect(resolved?.currencyCode).toBe("JPY");
});

// A quarterly price is `interval: "month"` with `intervalCount: 3`, and a
// metered one has a `billingModel` other than FLAT_FEE. Neither is "per month".
test("never takes a quarterly or a metered price for the plan's monthly price", () => {
  const quarterly = { amount: 13500, interval: "month" as const, intervalCount: 3 };
  const metered = { amount: 200, interval: "month" as const, billingModel: "USAGE_BASED" };
  const monthly = { amount: 4900, interval: "month" as const, billingModel: "FLAT_FEE" };

  expect(
    resolveLicensePrice(license({ billingInterval: "month" }), [
      plan({ prices: [quarterly, metered, monthly] }),
    ]),
  ).toMatchObject({ amount: 4900, interval: "month" });
  // Alone, they are not the unambiguous single price either.
  expect(resolveLicensePrice(license(), [plan({ prices: [quarterly] })])).toBeNull();
  expect(resolveLicensePrice(license(), [plan({ prices: [metered] })])).toBeNull();
});

test("isHeadlinePrice: a flat fee billed every single interval", () => {
  expect(isHeadlinePrice({ amount: 1, interval: "month" }, "month")).toBe(true);
  expect(isHeadlinePrice({ amount: 1, interval: "month", intervalCount: 1 }, "month")).toBe(true);
  expect(isHeadlinePrice({ amount: 1, interval: "year", billingModel: "FLAT_FEE" })).toBe(true);
  expect(isHeadlinePrice({ amount: 1, interval: "year" }, "month")).toBe(false);
  expect(isHeadlinePrice({ amount: 1, interval: "month", intervalCount: 6 }, "month")).toBe(false);
  expect(isHeadlinePrice({ amount: 1, billingModel: "OVERAGE" })).toBe(false);
});
