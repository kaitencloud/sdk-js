import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient, KaitenError, type KaitenApi } from "../src/index.ts";

const CATALOG = JSON.parse(
  readFileSync(new URL("./fixtures/public-catalog.acme.json", import.meta.url), "utf8"),
) as { plans: unknown[] };

const PK = `pk_${"a".repeat(43)}`;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": status < 400 ? "application/json" : "application/problem+json",
      ...headers,
    },
  });
}

function publicClient(fetch: (input: RequestInfo | URL) => Promise<Response>, token = PK) {
  const onDegraded = vi.fn();
  const onAuthError = vi.fn();
  const client = new KaitenClient({
    apiUrl: "https://api.acme.test/api",
    authScheme: "publishable",
    tokenProvider: () => token,
    fetch,
    onDegraded,
    onAuthError,
  });
  return { client, onDegraded, onAuthError };
}

const requestOf = (call: unknown[]): Request => call[0] as Request;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public mode reads the catalogue from /public/catalog only", () => {
  test("one GET with the publishable key in its header, no Authorization, no cookie", async () => {
    const fetch = vi.fn(async () => json(CATALOG));
    const { client, onDegraded } = publicClient(fetch);

    const catalog = await client.getCatalog();

    expect(fetch).toHaveBeenCalledTimes(1);
    const request = requestOf(fetch.mock.calls[0]!);
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://api.acme.test/api/public/catalog");
    expect(request.headers.get("X-Kaiten-Publishable-Key")).toBe(PK);
    expect(request.headers.get("Authorization")).toBeNull();
    expect(request.credentials).toBe("omit");
    expect(catalog.plans).toHaveLength(8);
    expect(onDegraded).not.toHaveBeenCalled();
  });

  test("a 401 rejects with the API's code, reports it once and falls back to nothing", async () => {
    const fetch = vi.fn(async () =>
      json({ title: "Unauthorized", status: 401, code: "PublicAuth.InvalidCredential" }, 401),
    );
    const { client, onDegraded, onAuthError } = publicClient(fetch);

    const failure = await client.getCatalog().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(KaitenError);
    expect(failure).toMatchObject({ status: 401, code: "PublicAuth.InvalidCredential" });
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(onAuthError.mock.calls[0]![0]).toMatchObject({
      status: 401,
      operation: "getCatalog()",
    });
    // No GraphQL to degrade from and no REST to degrade to.
    expect(onDegraded).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("a 429 exposes Retry-After and is not replayed", async () => {
    const fetch = vi.fn(async () =>
      json({ title: "Too many requests", status: 429, code: "PublicAuth.RateLimited" }, 429, {
        "Retry-After": "7",
      }),
    );
    const { client } = publicClient(fetch);

    const failure = await client.getCatalog().catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 429, retryAfterSeconds: 7 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("a secret key in a browser is refused before any request", async () => {
    vi.stubGlobal("window", { document: {} });
    const fetch = vi.fn(async () => json(CATALOG));
    const { client } = publicClient(fetch, "ksh_live_secret");

    const failure = await client.getCatalog().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(KaitenError);
    expect((failure as KaitenError).detail).toContain("ksh_");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a key that is not a publishable key is refused before any request", async () => {
    const fetch = vi.fn(async () => json(CATALOG));
    const { client } = publicClient(fetch, "not-a-key");

    await expect(client.getCatalog()).rejects.toMatchObject({ status: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("every other read or write is refused locally: a publishable key is never sent there", async () => {
    const fetch = vi.fn(async () => json({}));
    const { client, onAuthError } = publicClient(fetch);

    const calls = [
      () => client.getLicensingSnapshot("acme"),
      () => client.getCustomer("acme"),
      () => client.listLicenses(),
      () => client.evaluateFlags(),
      () =>
        client.reportUsage("acme-prod", "seats", {
          value: { type: "number", value: 1 },
          behavior: "append",
        }),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({
        status: 0,
        message: "Not available with a publishable key",
      });
    }

    expect(fetch).not.toHaveBeenCalled();
    expect(onAuthError).not.toHaveBeenCalled();
  });

  test("a bearer client still composes the catalogue over GraphQL", async () => {
    const fetch = vi.fn(async () => json({ data: { licenses: { items: [], hasMore: false } } }));
    const client = new KaitenClient({
      apiUrl: "https://api.acme.test/api",
      authScheme: "bearer",
      tokenProvider: () => "ksh_server",
      fetch,
    });

    await client.getCatalog();

    expect(requestOf(fetch.mock.calls[0]!).url).toBe("https://api.acme.test/api/graphql");
  });
});

// A catalogue written the way the contract types it, as the API serves it: not
// the fixture of a whole organization, but the few prices and grants whose
// reading is the point. `satisfies` makes the contract check this payload too.
describe("a catalogue as the contract types it", () => {
  const wire = {
    plans: [
      {
        familySlug: "pro",
        licenseSlug: "pro-a1b2c3",
        licenseId: "11111111-1111-4111-8111-111111111111",
        name: "Pro",
        description: "For teams",
        lifecycleState: "PUBLISHED",
        pricingType: "PAID",
        trialPeriodDays: 14,
        requiresPaymentMethod: true,
        selfServe: true,
        selfServeCtaUrl: null,
        currency: "EUR",
        prices: [
          {
            id: "p-m",
            billingModel: "FLAT_FEE",
            billingTiming: "ADVANCE",
            billingPeriod: "MONTHLY",
            currency: "EUR",
            unitAmount: 2900,
            unitAmountDecimal: "2900",
            displayOrder: 0,
            isDefault: true,
          },
          {
            id: "p-y",
            billingModel: "FLAT_FEE",
            billingTiming: "ADVANCE",
            billingPeriod: "ANNUAL",
            currency: "EUR",
            unitAmount: 29000,
            unitAmountDecimal: "29000",
            displayOrder: 1,
            isDefault: true,
          },
          {
            id: "p-q",
            billingModel: "FLAT_FEE",
            billingTiming: "ADVANCE",
            billingPeriod: "QUARTERLY",
            currency: "EUR",
            unitAmount: 8000,
            unitAmountDecimal: "8000",
            displayOrder: 2,
            isDefault: false,
          },
          {
            id: "p-o",
            billingModel: "OVERAGE",
            billingTiming: "ARREARS",
            currency: "EUR",
            unitAmountDecimal: "0.5",
            metered: { entitlementSlug: "tokens", saleUnitFactor: "10000" },
            displayOrder: 3,
            isDefault: false,
          },
        ],
        compatibleAddonFamilies: ["extra-seats"],
        entitlements: [
          {
            slug: "seats",
            name: "Seats",
            type: "NUMBER",
            value: -1,
            unlimited: true,
            displayOrder: 0,
            unitSingular: "seat",
            unitPlural: "seats",
          },
          {
            slug: "tokens",
            name: "Tokens",
            type: "NUMBER",
            value: 1000000,
            unlimited: false,
            displayOrder: 1,
            saleUnitFactor: "10000",
          },
        ],
      },
    ],
    addOns: [
      {
        familySlug: "extra-seats",
        addonSlug: "extra-seats-v1",
        addonId: "22222222-2222-4222-8222-222222222222",
        name: "Extra seats",
        description: "Five more seats",
        pricingType: "PAID",
        maxQuantity: 10,
        prices: [
          {
            id: "a-m",
            billingModel: "FLAT_FEE",
            billingTiming: "ADVANCE",
            billingPeriod: "MONTHLY",
            currency: "EUR",
            unitAmount: 500,
            unitAmountDecimal: "500",
            displayOrder: 0,
            isDefault: true,
          },
        ],
        entitlements: [
          { slug: "seats", name: "Seats", type: "NUMBER", value: 5, overrideBehavior: "ADD" },
        ],
        compatibleLicenseFamilies: ["pro"],
      },
    ],
    capabilities: { checkout: false, paymentMethods: true },
  } satisfies KaitenApi.PublicCatalog;

  const read = async () => {
    const fetch = vi.fn(async () => json(wire));
    const catalog = await publicClient(fetch).client.getCatalog();
    return { catalog, plan: catalog.plans[0]!, fetch };
  };

  test("the default monthly and annual fees are the headline, in minor units", async () => {
    const { catalog, plan, fetch } = await read();

    expect(requestOf(fetch.mock.calls[0]!).url).toBe("https://api.acme.test/api/public/catalog");
    expect(plan).toMatchObject({
      id: wire.plans[0].licenseId,
      slug: "pro-a1b2c3",
      familyId: "pro",
      price: 2900,
      annualPrice: 29000,
      currencyCode: "EUR",
      published: true,
      selfServe: true,
      trialPeriodDays: 14,
    });
    expect(catalog.capabilities).toEqual({ checkout: false, paymentMethods: true });
  });

  test("a quarterly fee is months with a count, and a 1.0 reader never sees it", async () => {
    const { plan } = await read();

    expect(plan.billingPrices?.find((price) => price.id === "p-q")).toMatchObject({
      interval: "month",
      intervalCount: 3,
      amount: 8000,
    });
    expect(plan.prices?.map((price) => price.id)).toEqual(["p-m", "p-y"]);
  });

  test("a fractional overage price stays exact, per sale unit, with no amount and no interval", async () => {
    const { plan } = await read();
    const overage = plan.billingPrices?.find((price) => price.id === "p-o");

    expect(overage).toMatchObject({
      billingModel: "OVERAGE",
      unitAmountDecimal: "0.5",
      meteredEntitlementSlug: "tokens",
      saleUnitFactor: 10000,
    });
    expect(overage).not.toHaveProperty("amount");
    expect(overage).not.toHaveProperty("interval");
    expect(plan.prices?.some((price) => price.id === "p-o")).toBe(false);
  });

  test("an unlimited grant keeps its sentinel, and a sale unit factor is a number", async () => {
    const { plan } = await read();

    expect(plan.entitlements?.[0]).toMatchObject({
      slug: "seats",
      unlimited: true,
      value: { type: "number", value: -1 },
      saleUnitFactor: null,
    });
    expect(plan.entitlements?.[1]?.saleUnitFactor).toBe(10000);
  });

  test("the public add-ons come with their own prices, and a plan names the families it takes", async () => {
    const { catalog, plan } = await read();

    expect(plan.compatibleAddonFamilies).toEqual(["extra-seats"]);
    expect(catalog.addOns).toHaveLength(1);
    expect(catalog.addOns?.[0]).toMatchObject({
      slug: "extra-seats-v1",
      familySlug: "extra-seats",
      price: 500,
      maxQuantity: 10,
      compatibleLicenseFamilies: ["pro"],
    });
    expect(catalog.addOns?.[0]?.billingPrices?.map((price) => price.id)).toEqual(["a-m"]);
  });
});
