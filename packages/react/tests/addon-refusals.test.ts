// What a refused change to the quantity of an add-on is called, from the status and the code the
// API answered `PUT /public/session/addons/{addonSlug}` with.
//
// As for a checkout, the code is `<UseCase>.<Reason>` and the use case is not part of what a
// refusal means: a screen reads the status and the end of the code. Anything it has no word for
// is `other`, and `error` says more.

import { expect, test } from "vite-plus/test";
import {
  BoundaryPendingError,
  KaitenError,
  ProviderUnavailableError,
  QuotaExceededError,
} from "@kaitencloud/client";

import { addonQuantityProblem } from "../src/hooks/billing/refusals.ts";

const refused = (status: number, code: string | undefined) =>
  new KaitenError({ title: "refused", status, code, detail: "refused" });

test.each([
  [422, "CurrencyMismatch", "currency_mismatch"],
  [422, "Incompatible", "incompatible"],
  [422, "QuantityExceedsMax", "quantity_exceeds_max"],
  [409, "OtherVersionAttached", "other_version_attached"],
  [409, "SubscriptionIncomplete", "subscription_incomplete"],
] as const)("%i .%s is %s whatever use case answers it", (status, reason, kind) => {
  for (const useCase of ["SetSessionAddonQuantity", "AttachInstanceAddon", "SomethingNew", "A.B"]) {
    expect(addonQuantityProblem(refused(status, `${useCase}.${reason}`))).toEqual({ kind });
  }
});

test("a code has to end in the reason, whole: a longer name that ends alike is not it", () => {
  // The vendor's own refusal of a scheduled plan is answered as `.Incompatible` on this route.
  expect(
    addonQuantityProblem(refused(422, "AttachInstanceAddon.IncompatibleWithScheduledPlan")),
  ).toEqual({ kind: "other" });
  expect(addonQuantityProblem(refused(422, "SetSessionAddonQuantity.NotIncompatible"))).toEqual({
    kind: "other",
  });
  expect(addonQuantityProblem(refused(422, "CurrencyMismatch"))).toEqual({ kind: "other" });
});

test("the status has to be the one of the refusal, as well as the reason", () => {
  expect(addonQuantityProblem(refused(409, "SetSessionAddonQuantity.CurrencyMismatch"))).toEqual({
    kind: "other",
  });
  expect(
    addonQuantityProblem(refused(422, "SetSessionAddonQuantity.OtherVersionAttached")),
  ).toEqual({ kind: "other" });
  expect(
    addonQuantityProblem(refused(500, "SetSessionAddonQuantity.SubscriptionIncomplete")),
  ).toEqual({ kind: "other" });
});

test("a period being closed and a provider that is down keep the wait their class carries", () => {
  const detail = { title: "refused", detail: "refused" };
  expect(
    addonQuantityProblem(
      new BoundaryPendingError(
        { ...detail, status: 409, code: "SetSessionAddonQuantity.BoundaryPending" },
        { retryAfterSeconds: 60 },
      ),
    ),
  ).toEqual({ kind: "boundary_pending", retryAfterSeconds: 60 });
  expect(
    addonQuantityProblem(
      new ProviderUnavailableError(
        { ...detail, status: 503, code: "SetSessionAddonQuantity.ProviderUnavailable" },
        { retryAfterSeconds: 30 },
      ),
    ),
  ).toEqual({ kind: "unavailable", retryAfterSeconds: 30 });
});

// What the route refuses with a code the kinds above have no word for: an add-on the catalogue
// should not have offered, a session that has no instance, and what the SDK never heard of.
test.each([
  [422, "SetSessionAddonQuantity.AddonNotPublic"],
  [422, "SetSessionAddonQuantity.InstanceRequired"],
  [404, "SetSessionAddonQuantity.NotFound"],
  [500, "SetSessionAddonQuantity.Internal"],
  [422, undefined],
])("%i %s has no kind of its own, and is other", (status, code) => {
  expect(addonQuantityProblem(refused(status, code))).toEqual({ kind: "other" });
});

test("no error is no problem, and something that is not a refusal of the API is other", () => {
  expect(addonQuantityProblem(null)).toBeNull();
  expect(addonQuantityProblem(undefined)).toBeNull();
  expect(addonQuantityProblem(new TypeError("network"))).toEqual({ kind: "other" });
  expect(addonQuantityProblem("Incompatible")).toEqual({ kind: "other" });
  // A refusal of a checkout's own is none of an add-on's.
  expect(
    addonQuantityProblem(
      new QuotaExceededError({
        title: "refused",
        status: 422,
        code: "CreateSessionCheckout.QuotaExceeded",
      }),
    ),
  ).toEqual({ kind: "other" });
});
