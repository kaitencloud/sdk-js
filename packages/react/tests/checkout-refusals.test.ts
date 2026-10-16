// What a refused checkout is called, from the status and the code the API answered with.
//
// The code is `<UseCase>.<Reason>` and the use case is not part of what a refusal means: the
// same refusal is answered under the name of the route that runs it, so a checkout reads the
// status and the end of the code. Anything it has no word for is `other`, and `error` says more.

import { expect, test } from "vite-plus/test";
import {
  KaitenError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
} from "@kaitencloud/client";

import { checkoutProblem, isVoucherRefusal } from "../src/hooks/billing/refusals.ts";

const refused = (status: number, code: string | undefined) =>
  new KaitenError({ title: "refused", status, code, detail: "refused" });

test.each([
  [409, "AlreadySubscribed", "already_subscribed"],
  [409, "SetupSessionIncomplete", "setup_incomplete"],
  [422, "BillingEmailRequired", "billing_email_required"],
  [422, "VoucherInvalid", "voucher_invalid"],
  [422, "ProviderCannotCapturePayment", "not_payable_online"],
] as const)("%i .%s is %s whatever use case answers it", (status, reason, kind) => {
  for (const useCase of ["CreateSessionCheckout", "SubscribeInstance", "SomethingNew", "A.B"]) {
    expect(checkoutProblem(refused(status, `${useCase}.${reason}`))).toEqual({ kind });
  }
});

test("a code has to end in the reason, whole: a longer name that ends alike is not it", () => {
  expect(checkoutProblem(refused(409, "CreateSessionCheckout.NotAlreadySubscribed"))).toEqual({
    kind: "other",
  });
  expect(checkoutProblem(refused(422, "CreateSessionCheckout.AnyVoucherInvalid"))).toEqual({
    kind: "other",
  });
  expect(checkoutProblem(refused(409, "AlreadySubscribed"))).toEqual({ kind: "other" });
});

test("the status has to be the one of the refusal, as well as the reason", () => {
  expect(checkoutProblem(refused(422, "CreateSessionCheckout.AlreadySubscribed"))).toEqual({
    kind: "other",
  });
  expect(checkoutProblem(refused(409, "CreateSessionCheckout.VoucherInvalid"))).toEqual({
    kind: "other",
  });
  expect(isVoucherRefusal(refused(500, "CreateSessionCheckout.VoucherInvalid"))).toBe(false);
});

test("a voucher is refused the same way under any use case that checks one", () => {
  expect(isVoucherRefusal(refused(422, "CreateSessionCheckout.VoucherInvalid"))).toBe(true);
  expect(isVoucherRefusal(refused(422, "SubscribeInstance.VoucherInvalid"))).toBe(true);
});

// An add-on the checkout cannot bill is named, from where the refusal points: `addons.<slug>` for one
// the instance holds, which a subscribe keeps, and `body.addOns[i]` for the order's i-th. The reason
// is the code of the rule it failed, inside.
const addOnRefusal = (
  code: string,
  errors: { location: string; value?: unknown }[],
  status = 422,
) =>
  new KaitenError({
    title: "refused",
    status,
    code,
    detail: "refused",
    errors: errors.map((entry) => ({ message: "refused", ...entry })),
  });

const inner = (code: string) => ({ code: `AttachInstanceAddon.${code}` });

test("an add-on the instance holds is named by its slug, with why the price cannot bill it", () => {
  const error = addOnRefusal("CreateSessionCheckout.AddonInvalid", [
    { location: "addons.extra-seats-v1", value: inner("NoPriceForBillingPeriod") },
    { location: "addons.gpu-pack-v1", value: inner("CurrencyMismatch") },
    { location: "addons.archive-v1", value: inner("AddonNotPublished") },
  ]);
  expect(checkoutProblem(error)).toEqual({
    kind: "addon_refused",
    addOns: [
      { slug: "extra-seats-v1", held: true, reason: "no_price_for_period" },
      { slug: "gpu-pack-v1", held: true, reason: "currency_mismatch" },
      { slug: "archive-v1", held: true, reason: "other" },
    ],
  });
  // The checkout answers CurrencyMismatch when the first is in another currency: the same names.
  const currency = addOnRefusal("CreateSessionCheckout.CurrencyMismatch", [
    { location: "addons.gpu-pack-v1", value: inner("CurrencyMismatch") },
  ]);
  expect(checkoutProblem(currency)).toEqual({
    kind: "addon_refused",
    addOns: [{ slug: "gpu-pack-v1", held: true, reason: "currency_mismatch" }],
  });
});

test("an add-on of the order is named by its place in it, when the order is known", () => {
  const error = addOnRefusal("SubscribeInstance.AddonInvalid", [
    { location: "body.addOns[1]", value: inner("FamilyAlreadyAttached") },
  ]);
  const order = {
    licensePriceId: "price_growth_monthly",
    addOns: [
      { addonSlug: "extra-seats-v1", quantity: 2 },
      { addonSlug: "extra-storage-v1", quantity: 1 },
    ],
  };
  expect(checkoutProblem(error, order)).toEqual({
    kind: "addon_refused",
    addOns: [{ slug: "extra-storage-v1", held: false, reason: "family_held" }],
  });
  // Without the order, or past its end, nothing is named, and the refusal has no kind of its own.
  expect(checkoutProblem(error)).toEqual({ kind: "other" });
  expect(checkoutProblem(error, { ...order, addOns: order.addOns.slice(0, 1) })).toEqual({
    kind: "other",
  });
});

test("an add-on named twice is named once, and another status or code names none", () => {
  const twice = addOnRefusal("CreateSessionCheckout.AddonInvalid", [
    { location: "addons.extra-seats-v1", value: inner("NoPriceForBillingPeriod") },
    { location: "addons.extra-seats-v1", value: inner("CurrencyMismatch") },
    { location: "body", value: inner("NoPriceForBillingPeriod") },
  ]);
  expect(checkoutProblem(twice)).toEqual({
    kind: "addon_refused",
    addOns: [{ slug: "extra-seats-v1", held: true, reason: "no_price_for_period" }],
  });
  const errors = [{ location: "addons.extra-seats-v1", value: inner("CurrencyMismatch") }];
  expect(checkoutProblem(addOnRefusal("CreateSessionCheckout.AddonInvalid", errors, 409))).toEqual({
    kind: "other",
  });
  expect(checkoutProblem(addOnRefusal("CreateSessionCheckout.QuantityExceedsMax", errors))).toEqual(
    { kind: "other" },
  );
});

// What the checkout refuses with a code the kinds above have no word for. Each one is a
// refusal of a request the SDK itself builds, or of a catalogue that should not have offered
// the plan, and a screen words it with the generic error.
test.each([
  [422, "CreateSessionCheckout.PriceNotPublic"],
  [422, "CreateSessionCheckout.PriceNotFlatFee"],
  [422, "CreateSessionCheckout.NotSelfServe"],
  [422, "CreateSessionCheckout.AddonNotPublic"],
  [422, "CreateSessionCheckout.AddonInvalid"],
  [422, "CreateSessionCheckout.CurrencyMismatch"],
  [422, "CreateSessionCheckout.InvalidBillingEmail"],
  [422, "CreateSessionCheckout.InstanceRequired"],
  [422, "CreateSessionCheckout.QuantityExceedsMax"],
  [422, "CreateSessionCheckout.InvalidReturnUrl"],
  [422, "SubscribeInstance.UnsupportedCurrency"],
  [404, "CreateSessionCheckout.NotFound"],
  [500, "CreateSessionCheckout.Internal"],
  [418, "CreateSessionCheckout.SomethingTheSdkNeverHeardOf"],
  [422, undefined],
])("%i %s has no kind of its own, and is other", (status, code) => {
  expect(checkoutProblem(refused(status, code))).toEqual({ kind: "other" });
});

// A currency the payment provider does not take is refused with the code of a provider that
// cannot capture a payment: nothing tells the two apart, so they are one kind, and the words of
// a plan that cannot be bought here say neither which.
test("a currency the provider refuses is answered as a payment that cannot be taken online", () => {
  const unsupported = refused(422, "CreateSessionCheckout.ProviderCannotCapturePayment");
  expect(checkoutProblem(unsupported)).toEqual({ kind: "not_payable_online" });
});

test("the refusals that have a class of their own keep their kind under any prefix", () => {
  const detail = { title: "refused", detail: "refused" };
  expect(
    checkoutProblem(
      new QuotaExceededError({
        ...detail,
        status: 422,
        code: "SomeUseCase.QuotaExceeded",
        errors: [{ location: "body", message: "over", value: { entitlementSlugs: ["seats"] } }],
      }),
    ),
  ).toEqual({ kind: "quota_exceeded", entitlementSlugs: ["seats"] });
  expect(
    checkoutProblem(
      new RateLimitedError(
        { ...detail, status: 429, code: "SomeUseCase.RateLimited" },
        { retryAfterSeconds: 12 },
      ),
    ),
  ).toEqual({ kind: "rate_limited", retryAfterSeconds: 12 });
  expect(
    checkoutProblem(
      new ProviderUnavailableError(
        { ...detail, status: 503, code: "SomeUseCase.ProviderUnavailable" },
        { retryAfterSeconds: 30 },
      ),
    ),
  ).toEqual({ kind: "unavailable", retryAfterSeconds: 30 });
});

test("no error is no problem, and something that is not a refusal of the API is other", () => {
  expect(checkoutProblem(null)).toBeNull();
  expect(checkoutProblem(undefined)).toBeNull();
  expect(checkoutProblem(new TypeError("network"))).toEqual({ kind: "other" });
  expect(checkoutProblem("AlreadySubscribed")).toEqual({ kind: "other" });
});
