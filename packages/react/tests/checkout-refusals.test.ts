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
