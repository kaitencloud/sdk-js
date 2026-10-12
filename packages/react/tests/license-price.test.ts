import { expect, test } from "vite-plus/test";

import {
  formatKaitenPrice,
  isHeadlinePrice,
  kaitenPriceParts,
  resolveLicensePrice,
} from "../src/lib/license-price.ts";
import { defaultLocalization } from "../src/localization/defaults.ts";
import { fr } from "../src/localization/locales/fr.ts";
import type { License, Plan } from "../src/types.ts";
import { mappedAcmeCatalog } from "./support/acme-catalog.ts";

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

// ---------------------------------------------------------------------------
// How a price reads: per period, per sale unit, whole.
//
// Run on the catalogue Kaiten serves for Acme, through the client's mapping: the
// plan `pro` sells a monthly, a quarterly, a half-yearly and an annual fee, a price
// per 1M tokens and a price per call of two ten-thousandths of a cent.
// ---------------------------------------------------------------------------

const catalog = await mappedAcmeCatalog();
const pro = catalog.plans.find((candidate) => candidate.slug === "pro-v2")!;
const priceOf = (id: string) => pro.billingPrices!.find((price) => price.id.endsWith(id))!;
const label = (id: string) =>
  formatKaitenPrice(priceOf(id), defaultLocalization, { entitlements: pro.entitlements });

test("a flat fee is per period, and a quarterly one says every three months", () => {
  expect(label("0201")).toBe("€49.00/month");
  expect(label("0204")).toBe("€490.00/year");
  expect(label("0202")).toBe("€135.00 every 3 months");
  expect(label("0203")).toBe("€260.00 every 6 months");
  // A quarterly fee is never read as a monthly one.
  expect(label("0202")).not.toContain("/month");
});

test("a usage price is per sale unit, exact, and never the headline", () => {
  // 200 minor units of a sale unit named "1M tokens".
  expect(label("0206")).toBe("€2.00 per 1M tokens");
  // 0.0002 cents a call, written whole: no rounding to €0.00. The unit comes from the
  // entitlement the price meters, since the price names none.
  expect(priceOf("0207").amount).toBeUndefined();
  expect(label("0207")).toBe("€0.000002 per call");
  // The headline stays the monthly flat fee: no usage price is summed into it.
  expect(pro.price).toBe(4900);
  expect(pro.annualPrice).toBe(49000);
});

test("a usage price without a unit of any kind is per unit", () => {
  const bare = { ...priceOf("0207"), meteredEntitlementSlug: "nothing-like-it" };
  expect(formatKaitenPrice(bare, defaultLocalization, { entitlements: pro.entitlements })).toBe(
    "€0.000002 per unit",
  );
  expect(formatKaitenPrice(bare, defaultLocalization)).toBe("€0.000002 per unit");
});

test("the three decimals of a dinar and the missing ones of a yen", () => {
  const kw = catalog.plans.find((candidate) => candidate.slug === "kw-v1")!;
  const jp = catalog.plans.find((candidate) => candidate.slug === "jp-v1")!;
  expect(formatKaitenPrice(kw.billingPrices![0]!, defaultLocalization)).toBe("KWD 12.500/month");
  expect(formatKaitenPrice(jp.billingPrices![0]!, defaultLocalization)).toBe("¥980/month");
});

test("each language writes the period and the unit its own way", () => {
  expect(formatKaitenPrice(priceOf("0201"), fr)).toBe("49,00 €/mois");
  expect(formatKaitenPrice(priceOf("0202"), fr)).toBe("135,00 € tous les 3 mois");
  expect(formatKaitenPrice(priceOf("0206"), fr)).toBe("2,00 € par 1M tokens");
  expect(formatKaitenPrice(priceOf("0207"), fr, { entitlements: pro.entitlements })).toBe(
    "0,000002 € par call",
  );
});

test("a price it cannot write without guessing has no label", () => {
  // No amount at all.
  expect(
    kaitenPriceParts(
      { ...priceOf("0201"), amount: undefined, unitAmountDecimal: undefined } as never,
      defaultLocalization,
    ),
  ).toBeNull();
  // A model the SDK does not know is never taken for a flat fee.
  expect(
    formatKaitenPrice({ ...priceOf("0201"), billingModel: "TIERED" }, defaultLocalization),
  ).toBeNull();
  expect(
    formatKaitenPrice({ ...priceOf("0201"), billingModel: "" }, defaultLocalization),
  ).toBeNull();
});

test("a price a host wrote itself, with no model, is a flat fee in the currency it is given", () => {
  expect(
    formatKaitenPrice({ amount: 7900, interval: "month" }, defaultLocalization, {
      currencyCode: "USD",
    }),
  ).toBe("$79.00/month");
  expect(formatKaitenPrice({ amount: 7900 }, defaultLocalization, { currencyCode: "USD" })).toBe(
    "$79.00",
  );
});
