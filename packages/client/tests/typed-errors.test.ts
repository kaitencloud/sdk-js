import { describe, expect, test } from "vite-plus/test";

import {
  BoundaryPendingError,
  KaitenClient,
  KaitenError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
} from "../src/index.ts";
import type { KaitenApiError, KaitenSessionClient, KaitenThrownError } from "../src/index.ts";
import { QUOTA_EXCEEDED, refusal, refused } from "./support/session-answers.ts";
import { json, open } from "./support/session-harness.ts";

// The refusals a host acts on are told apart by status and code, and each is a
// class of its own. The answers are the ones Kaiten serves (fixtures/README.md),
// with the `Retry-After` they came with; every other refusal stays a plain
// `KaitenError`, read by its `code`.

const caught = async (call: Promise<unknown>) => call.catch((thrown: unknown) => thrown);

const PRICE = "00000000-0000-4000-8000-000000000201";

describe("QuotaExceededError", () => {
  test("a checkout over the plan's quota names the entitlements, and is a KaitenError", async () => {
    const { client, requests } = open(() => json(QUOTA_EXCEEDED.body, QUOTA_EXCEEDED.status));

    const error = await caught(client.checkout({ licensePriceId: PRICE }));

    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({
      name: "QuotaExceededError",
      kind: "api",
      status: 422,
      code: "CreateSessionCheckout.QuotaExceeded",
      entitlementSlugs: ["seats", "api-calls"],
    });
    expect(requests).toHaveLength(1);
  });

  test("a preview is refused the same way", async () => {
    const { client } = open(() => json(QUOTA_EXCEEDED.body, QUOTA_EXCEEDED.status));

    const error = await caught(client.checkout({ licensePriceId: PRICE, dryRun: true }));

    expect(error).toBeInstanceOf(QuotaExceededError);
    expect((error as QuotaExceededError).entitlementSlugs).toEqual(["seats", "api-calls"]);
  });

  test("a body without the slugs gives none, and anything but a slug is left out", () => {
    const apiError = (errors: KaitenApiError["errors"]): KaitenApiError => ({
      title: "Unprocessable Entity",
      status: 422,
      code: "CreateSessionCheckout.QuotaExceeded",
      errors,
    });
    const slugsOf = (errors: KaitenApiError["errors"]) =>
      new QuotaExceededError(apiError(errors)).entitlementSlugs;
    const at = (value: unknown) => [{ location: "body", message: "over", value }];

    expect(slugsOf(undefined)).toEqual([]);
    expect(slugsOf([])).toEqual([]);
    expect(slugsOf(at("seats"))).toEqual([]);
    expect(slugsOf(at({ entitlementSlugs: "seats" }))).toEqual([]);
    expect(slugsOf(at({ entitlementSlugs: ["seats", 3, null, "api-calls"] }))).toEqual([
      "seats",
      "api-calls",
    ]);
  });
});

describe("RateLimitedError", () => {
  test("a voucher check answered 429 says how long to wait", async () => {
    const { client, requests } = open(() => refused("voucherRateLimited"));

    const error = await caught(client.validateVoucher({ code: "WELCOME20" }));

    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({
      name: "RateLimitedError",
      kind: "api",
      status: 429,
      code: "ValidateSessionVoucher.RateLimited",
      retryAfterSeconds: 90,
    });
    expect(requests).toHaveLength(1);
  });

  test("a 429 on a read is the same class, and the read is not sent again", async () => {
    const { body } = refusal("voucherRateLimited");
    const { client, requests } = open(() =>
      json({ ...body, code: "PublicAuth.RateLimited" }, 429, { "Retry-After": "12" }),
    );

    const error = await caught(client.getPortal());

    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({ code: "PublicAuth.RateLimited", retryAfterSeconds: 12 });
    expect(requests).toHaveLength(1);
  });

  test("the catalogue of a publishable key answers it too", async () => {
    const { body } = refusal("voucherRateLimited");
    const client = new KaitenClient({
      apiUrl: "https://api.acme.test/api",
      authScheme: "publishable",
      tokenProvider: () => `pk_${"a".repeat(43)}`,
      fetch: async () =>
        json({ ...body, code: "GetPublicCatalog.RateLimited" }, 429, { "Retry-After": "5" }),
    });

    const error = await caught(client.getCatalog());

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(5);
  });
});

describe("BoundaryPendingError", () => {
  test("a cancellation refused while the period closes carries the delay, and is not replayed", async () => {
    const { client, requests } = open(() => refused("cancelBoundaryPending"));

    const error = await caught(client.cancelSubscription());

    expect(error).toBeInstanceOf(BoundaryPendingError);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({
      name: "BoundaryPendingError",
      kind: "api",
      status: 409,
      code: "CancelSessionSubscription.BoundaryPending",
      retryAfterSeconds: 60,
    });
    expect(requests).toHaveLength(1);
  });

  test.each([
    ["reactivateSubscription", (client: KaitenSessionClient) => client.reactivateSubscription()],
    [
      "setAddonQuantity",
      (client: KaitenSessionClient) => client.setAddonQuantity("extra-seats-v1", 2),
    ],
  ])("%s answers it too", async (operation, call) => {
    const { body } = refusal("cancelBoundaryPending");
    const { client } = open(() =>
      json({ ...body, code: `${operation}.BoundaryPending` }, 409, { "Retry-After": "45" }),
    );

    const error = await caught(call(client));

    expect(error).toBeInstanceOf(BoundaryPendingError);
    expect((error as BoundaryPendingError).retryAfterSeconds).toBe(45);
  });
});

describe("ProviderUnavailableError", () => {
  test("a checkout the provider could not take says how long to wait, and is sent once", async () => {
    const { client, requests } = open(() => refused("checkoutProviderUnavailable"));

    const error = await caught(client.checkout({ licensePriceId: PRICE }));

    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({
      name: "ProviderUnavailableError",
      kind: "api",
      status: 503,
      code: "CreateSessionCheckout.ProviderUnavailable",
      retryAfterSeconds: 30,
    });
    expect(requests).toHaveLength(1);
  });

  test("so does a payment method page", async () => {
    const { client } = open(() => refused("paymentMethodUnavailable"));

    const error = await caught(
      client.createPaymentMethodSession({ returnUrl: "https://app.test" }),
    );

    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).retryAfterSeconds).toBe(30);
  });
});

describe("the other refusals stay readable by code", () => {
  test.each([
    ["addonIncompatible", "setAddonQuantity"],
    ["cancelNotActive", "cancelSubscription"],
    ["checkoutAlreadySubscribed", "checkout"],
  ] as const)("%s is a KaitenError and nothing narrower", async (key, call) => {
    const { client } = open(() => refused(key));
    const calls = {
      setAddonQuantity: () => client.setAddonQuantity("extra-seats-v1", 2),
      cancelSubscription: () => client.cancelSubscription(),
      checkout: () => client.checkout({ licensePriceId: PRICE }),
    };

    const error = await caught(calls[call]());

    expect(error).toBeInstanceOf(KaitenError);
    expect(Object.getPrototypeOf(error)).toBe(KaitenError.prototype);
    expect(error).toMatchObject({
      name: "KaitenError",
      status: refusal(key).status,
      code: refusal(key).body.code,
    });
    expect((error as KaitenError).retryAfterSeconds).toBeUndefined();
  });

  // A code alone does not make the class: the status has to be the one the API
  // answers with, so a proxy's page or another route's code is not mistaken.
  test.each([
    [409, "CreateSessionCheckout.QuotaExceeded"],
    [429, "CreateSessionCheckout.BoundaryPending"],
    [503, "ValidateSessionVoucher.RateLimited"],
    [500, "CreateSessionCheckout.ProviderUnavailable"],
    [429, "RateLimited"],
    [409, undefined],
  ])("%i %s is a plain KaitenError", async (status, code) => {
    const { client } = open(() => json({ title: "Refused", status, code }, status));

    const error = await caught(client.getPortal());

    expect(Object.getPrototypeOf(error)).toBe(KaitenError.prototype);
  });
});

describe("a wait the client cannot read is 60 seconds", () => {
  const WAITS = [
    ["voucherRateLimited", "validateVoucher", RateLimitedError],
    ["cancelBoundaryPending", "cancelSubscription", BoundaryPendingError],
    ["checkoutProviderUnavailable", "checkout", ProviderUnavailableError],
  ] as const;

  // A browser calling another origin sees `Retry-After` only if the API's CORS
  // policy exposes it, and otherwise reads no header at all.
  test.each(WAITS)("%s, with no Retry-After to read", async (key, call, expected) => {
    const { status, body } = refusal(key);
    const { client } = open(() => json(body, status));
    const calls = {
      validateVoucher: () => client.validateVoucher({ code: "WELCOME20" }),
      cancelSubscription: () => client.cancelSubscription(),
      checkout: () => client.checkout({ licensePriceId: PRICE }),
    };

    const error = await caught(calls[call]());

    expect(error).toBeInstanceOf(expected);
    expect((error as KaitenError).retryAfterSeconds).toBe(60);
  });

  test.each(["soon", "-5", "1.5", "", "12 seconds"])(
    "a Retry-After of %j is not one",
    async (header) => {
      const { status, body } = refusal("voucherRateLimited");
      const { client } = open(() => json(body, status, { "Retry-After": header }));

      const error = await caught(client.validateVoucher({ code: "WELCOME20" }));

      expect((error as RateLimitedError).retryAfterSeconds).toBe(60);
    },
  );

  test("an HTTP date is read as seconds from now", async () => {
    const { status, body } = refusal("voucherRateLimited");
    const at = new Date(Date.now() + 40_000).toUTCString();
    const { client } = open(() => json(body, status, { "Retry-After": at }));

    const error = await caught(client.validateVoucher({ code: "WELCOME20" }));

    expect((error as RateLimitedError).retryAfterSeconds).toBeGreaterThanOrEqual(39);
    expect((error as RateLimitedError).retryAfterSeconds).toBeLessThanOrEqual(40);
  });

  test("a delay of 0 is a delay", async () => {
    const { status, body } = refusal("voucherRateLimited");
    const { client } = open(() => json(body, status, { "Retry-After": "0" }));

    const error = await caught(client.validateVoucher({ code: "WELCOME20" }));

    expect((error as RateLimitedError).retryAfterSeconds).toBe(0);
  });

  test("a built error says 60 unless it is told otherwise", () => {
    const apiError = { title: "Too Many Requests", status: 429 };

    expect(new RateLimitedError(apiError).retryAfterSeconds).toBe(60);
    expect(new RateLimitedError(apiError, { retryAfterSeconds: 7 }).retryAfterSeconds).toBe(7);
    expect(new BoundaryPendingError(apiError).retryAfterSeconds).toBe(60);
    expect(new ProviderUnavailableError(apiError, { retryAfterSeconds: 0 }).retryAfterSeconds).toBe(
      0,
    );
  });
});

describe("a handler written for KaitenError", () => {
  // The classes are KaitenErrors for the type checker as well: a `catch` that
  // switches on `kind` stays exhaustive, and reads what a KaitenError carries.
  function describeFailure(error: KaitenThrownError): string {
    switch (error.kind) {
      case "api":
        return `${error.status} ${error.code ?? ""} ${error.retryAfterSeconds ?? "-"}`.trim();
      case "network":
        return "network";
    }
  }

  test("reads every class through KaitenThrownError", () => {
    const problem = (status: number, code: string): KaitenApiError => ({
      title: "Refused",
      status,
      code,
    });

    expect(describeFailure(new QuotaExceededError(problem(422, "A.QuotaExceeded")))).toBe(
      "422 A.QuotaExceeded -",
    );
    expect(
      describeFailure(
        new RateLimitedError(problem(429, "A.RateLimited"), { retryAfterSeconds: 12 }),
      ),
    ).toBe("429 A.RateLimited 12");
    expect(describeFailure(new BoundaryPendingError(problem(409, "A.BoundaryPending")))).toBe(
      "409 A.BoundaryPending 60",
    );
    expect(
      describeFailure(
        new ProviderUnavailableError(problem(503, "A.ProviderUnavailable"), {
          retryAfterSeconds: 30,
        }),
      ),
    ).toBe("503 A.ProviderUnavailable 30");
  });
});
