import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { mapBillingPrice, mapPlan, mapPublicCatalog } from "../src/client/billing.ts";
import type { BillingPrice, KaitenApi, Plan, PlanPrice } from "../src/index.ts";

// The payload is typed by the contract, so a member the API renames breaks this
// file's types before it breaks a test. A case that needs a value the contract
// does not allow (a period it does not list) goes through `outOfContract`.
const PAYLOAD = JSON.parse(
  readFileSync(new URL("./fixtures/public-catalog.acme.json", import.meta.url), "utf8"),
) as KaitenApi.PublicCatalog;

const outOfContract = <T>(value: object): T => value as T;

const rawPlan = (family: string): KaitenApi.PublicPlan => {
  const plan = PAYLOAD.plans.find((candidate) => candidate.familySlug === family);
  if (!plan) throw new Error(`no ${family} plan in the fixture`);
  return structuredClone(plan);
};

const rawPrice = (id: string): KaitenApi.PublicPrice => {
  for (const plan of PAYLOAD.plans) {
    const price = plan.prices.find((candidate) => candidate.id === id);
    if (price) return structuredClone(price);
  }
  throw new Error(`no price ${id} in the fixture`);
};

const catalog = mapPublicCatalog(PAYLOAD);
const plan = (family: string): Plan => catalog.plans.find((entry) => entry.familyId === family)!;

describe("money: API price to BillingPrice", () => {
  test("a monthly flat fee keeps its integer amount and has no interval count", () => {
    expect(mapBillingPrice(rawPrice("lp-pro-m"))).toEqual({
      id: "lp-pro-m",
      amount: 4900,
      unitAmountDecimal: "4900",
      currencyCode: "EUR",
      billingModel: "FLAT_FEE",
      isDefault: true,
      interval: "month",
      label: "Monthly",
    });
  });

  test("a usage price is per sale unit and has no interval", () => {
    const price = mapBillingPrice(rawPrice("lp-pro-tok"));

    expect(price).toMatchObject({
      amount: 200,
      currencyCode: "EUR",
      unitAmountDecimal: "200",
      billingModel: "USAGE_BASED",
      meteredEntitlementSlug: "tokens",
      saleUnitFactor: 1000000,
      saleUnitSingular: "1M tokens",
    });
    expect(price).not.toHaveProperty("interval");
  });

  test("a price below one minor unit gets no amount: it is never rounded into one", () => {
    const price = mapBillingPrice(rawPrice("lp-pro-calls"));

    expect(price).not.toHaveProperty("amount");
    expect(price).toMatchObject({
      unitAmountDecimal: "0.0002",
      billingModel: "USAGE_BASED",
      meteredEntitlementSlug: "api-calls",
      saleUnitFactor: 1,
    });
  });

  test("currencies with 0 and 3 decimals travel as the same integers", () => {
    expect(mapBillingPrice(rawPrice("lp-jp-m"))).toMatchObject({
      amount: 980,
      currencyCode: "JPY",
      interval: "month",
    });
    expect(mapBillingPrice(rawPrice("lp-kw-m"))).toMatchObject({
      amount: 12500,
      currencyCode: "KWD",
      interval: "month",
    });
  });

  test("periods: month, year, and months with a count; never one_time", () => {
    const periods = ["MONTHLY", "ANNUAL", "QUARTERLY", "SEMI_ANNUAL", null, "WEEKLY"];
    const mapped = periods.map((billingPeriod) => {
      const { interval, intervalCount } = mapBillingPrice(
        outOfContract({ ...rawPrice("lp-pro-m"), billingPeriod }),
      );
      return { interval, intervalCount };
    });

    expect(mapped).toEqual([
      { interval: "month", intervalCount: undefined },
      { interval: "year", intervalCount: undefined },
      { interval: "month", intervalCount: 3 },
      { interval: "month", intervalCount: 6 },
      { interval: undefined, intervalCount: undefined },
      // A period this SDK does not know is not guessed at.
      { interval: undefined, intervalCount: undefined },
    ]);
  });

  test("property: the amount is the API's integer, never scaled; the currency is the API's", () => {
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    const currencies = ["EUR", "JPY", "KWD", "USD", "BHD"];

    for (let index = 0; index < 10_000; index += 1) {
      const unitAmount = next() % 1_000_000_000;
      const currency = currencies[next() % currencies.length]!;
      const price = mapBillingPrice({
        ...rawPrice("lp-pro-m"),
        unitAmount,
        unitAmountDecimal: `${unitAmount}`,
        currency,
      });
      expect(price.amount).toBe(unitAmount);
      expect(price.currencyCode).toBe(currency);
    }
  });
});

describe("plans", () => {
  test("pro: headline from the default prices, 1.0-safe prices, every price in billingPrices", () => {
    const pro = plan("pro");

    expect(pro).toMatchObject({
      id: "00000000-0000-4000-8000-000000000002",
      slug: "pro-v2",
      name: "Pro",
      price: 4900,
      annualPrice: 49000,
      currencyCode: "EUR",
      published: true,
      lifecycleState: "PUBLISHED",
      familyId: "pro",
      pricingType: "PAID",
      trialPeriodDays: null,
      requiresPaymentMethod: true,
      selfServe: true,
      selfServeCtaUrl: "https://acme.test/sales",
      compatibleAddonFamilies: ["extra-seats", "gpu-pack"],
    });
    expect(pro.billingPrices?.map((price) => price.id)).toEqual([
      "lp-pro-m",
      "lp-pro-q",
      "lp-pro-s",
      "lp-pro-y",
      "lp-pro-m2",
      "lp-pro-tok",
      "lp-pro-calls",
    ]);
    // What a 1.0 consumer reads: one monthly and one annual flat fee, both of
    // exactly one interval and both integral.
    expect(pro.prices?.map((price) => [price.id, price.interval, price.amount])).toEqual([
      ["lp-pro-m", "month", 4900],
      ["lp-pro-y", "year", 49000],
    ]);
  });

  test("the headline never comes from a non-default, quarterly or metered price, whatever the order", () => {
    const shuffled = rawPlan("pro");
    shuffled.prices.reverse();

    const mapped = mapPlan(shuffled);

    expect(mapped.price).toBe(4900);
    expect(mapped.annualPrice).toBe(49000);
    // A 1.0 consumer's `prices.find(p => p.interval === "month")` finds the
    // monthly fee, never the quarterly one that now comes first.
    expect(mapped.prices?.find((price) => price.interval === "month")?.amount).toBe(4900);
  });

  test("a plan whose only default flat fee is quarterly has no headline and no 1.0 price", () => {
    const synthetic = rawPlan("pro");
    synthetic.prices = [rawPrice("lp-pro-q")];

    const mapped = mapPlan(synthetic);

    expect(mapped.price).toBeUndefined();
    expect(mapped.annualPrice).toBeUndefined();
    expect(mapped.prices).toEqual([]);
    expect(mapped.billingPrices).toMatchObject([
      { id: "lp-pro-q", amount: 13500, interval: "month", intervalCount: 3 },
    ]);
  });

  test("every PlanPrice the mapper produces is a faithful 1.0 price", () => {
    const all: PlanPrice[] = catalog.plans.flatMap((entry) => entry.prices ?? []);
    for (const price of all) {
      expect(Number.isSafeInteger(price.amount)).toBe(true);
      expect(price.intervalCount).toBeUndefined();
      expect(price.billingModel).toBe("FLAT_FEE");
      expect(["month", "year"]).toContain(price.interval);
    }
  });

  test("published follows the lifecycle state alone, never isActive", () => {
    const withState = (lifecycleState: string, isActive: boolean) =>
      mapPlan(outOfContract({ ...rawPlan("pro"), lifecycleState, isActive })).published;

    expect(withState("PUBLISHED", false)).toBe(true);
    expect(withState("ARCHIVED", true)).toBe(false);
  });

  test("custom and non-self-serve plans keep their call to action", () => {
    expect(plan("enterprise")).toMatchObject({
      pricingType: "CUSTOM",
      selfServe: false,
      selfServeCtaUrl: "https://acme.test/contact",
      prices: [],
      billingPrices: [],
    });
    expect(plan("solo")).toMatchObject({ selfServe: false, selfServeCtaUrl: null });
    // Solo has a monthly fee, but no default one: nothing to headline.
    expect(plan("solo").price).toBeUndefined();
  });

  test("entitlements carry their tagged value and presentation", () => {
    const [apiCalls, tokens, , sso] = plan("pro").entitlements!;

    expect(apiCalls).toMatchObject({
      slug: "api-calls",
      type: "NUMBER",
      value: { type: "number", value: 100000 },
      unlimited: false,
      unitPlural: "calls",
      displayOrder: 0,
    });
    expect(tokens).toMatchObject({ saleUnitSingular: "1M tokens", saleUnitFactor: 1000000 });
    expect(sso).toMatchObject({ type: "BOOLEAN", value: { type: "boolean", value: true } });
    expect(plan("enterprise").entitlements![0]).toMatchObject({
      value: { type: "number", value: -1 },
      unlimited: true,
    });
  });
});

describe("add-ons and capabilities", () => {
  test("extra seats: the monthly fee as headline, both 1.0 prices, its family and limits", () => {
    const seats = catalog.addOns?.find((addon) => addon.slug === "extra-seats-v1");

    expect(seats).toMatchObject({
      id: "00000000-0000-4000-8000-0000000000a1",
      slug: "extra-seats-v1",
      name: "Extra seats",
      familySlug: "extra-seats",
      price: 1000,
      currencyCode: "EUR",
      interval: "month",
      maxQuantity: 50,
      compatibleLicenseFamilies: ["growth", "pro"],
      entitlements: [{ slug: "seats", value: { type: "number", value: 1 } }],
    });
    expect(seats?.prices).toHaveLength(2);
    expect(catalog.addOns?.find((addon) => addon.slug === "gpu-pack-v1")).toMatchObject({
      maxQuantity: null,
      currencyCode: "USD",
      price: 3000,
    });
  });

  test("capabilities are read as booleans, and an empty catalogue is empty", () => {
    expect(catalog.capabilities).toEqual({ checkout: true, paymentMethods: true });
    expect(mapPublicCatalog({ plans: [], addOns: [], capabilities: {} })).toMatchObject({
      plans: [],
      addOns: [],
      capabilities: { checkout: false, paymentMethods: false },
    });
  });

  test("a BillingPrice without an amount is not assignable to a 1.0 PlanPrice", () => {
    const decimal: BillingPrice = mapBillingPrice(rawPrice("lp-pro-calls"));
    // @ts-expect-error -- `amount` is optional on BillingPrice and required on PlanPrice.
    const legacy: PlanPrice = decimal;
    expect(legacy.amount).toBeUndefined();
  });
});
