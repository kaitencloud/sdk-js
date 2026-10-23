// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What a refused anonymous checkout is called, from the class the client threw or the status and the
// code the API answered with. The code is `<UseCase>.<Reason>`, and the use case (the start, the
// confirm, the read) is not part of what a refusal means. Anything with no word of its own is `other`,
// and `error` says more.

import { expect, test } from "vite-plus/test";
import {
  CheckoutSessionClosedError,
  CheckoutTokenMissingError,
  DueTodayChangedError,
  KaitenError,
  KaitenNetworkError,
  ProviderUnavailableError,
  RateLimitedError,
  TurnstileFailedError,
  TurnstileUnavailableError,
} from "@kaitencloud/client";

import { anonymousCheckoutProblem } from "../src/hooks/billing/anonymous-refusals.ts";

const api = (status: number, code?: string) => ({
  title: "refused",
  status,
  code,
  detail: "refused",
});
const refused = (status: number, code: string | undefined) => new KaitenError(api(status, code));

test("no error is no problem", () => {
  expect(anonymousCheckoutProblem(null)).toBeNull();
  expect(anonymousCheckoutProblem(undefined)).toBeNull();
});

test.each([
  [403, "AnonymousCheckoutDisabled", "not_available"],
  [422, "TurnstileNotConfigured", "not_available"],
  [422, "NotSelfServe", "not_self_serve"],
  [422, "PriceNotPublic", "plan_not_available"],
  [422, "PriceNotFlatFee", "plan_not_available"],
  [422, "InvalidPriceSelection", "plan_not_available"],
  [422, "FallbackRequired", "plan_not_available"],
  [422, "ProviderCannotCapturePayment", "not_payable_online"],
  [422, "AddonNotPublic", "addon_refused"],
  [422, "QuantityExceedsMax", "addon_refused"],
  [422, "CurrencyMismatch", "addon_refused"],
  [422, "VoucherInvalid", "voucher_invalid"],
  [422, "InvalidEmail", "invalid_email"],
  [422, "InvalidReturnUrl", "not_available"],
  [409, "EntitlementLimitReached", "quota_reached"],
] as const)("%i .%s is %s, under the start and the confirm alike", (status, reason, kind) => {
  for (const useCase of ["CreateCheckoutSession", "ConfirmCheckoutSession", "Something.New"]) {
    expect(anonymousCheckoutProblem(refused(status, `${useCase}.${reason}`))).toEqual({ kind });
  }
});

test("a code has to end in the reason, whole, and carry the status of the refusal", () => {
  expect(anonymousCheckoutProblem(refused(422, "CreateCheckoutSession.NotNotSelfServe"))).toEqual({
    kind: "other",
  });
  expect(anonymousCheckoutProblem(refused(422, "NotSelfServe"))).toEqual({ kind: "other" });
  expect(anonymousCheckoutProblem(refused(409, "CreateCheckoutSession.NotSelfServe"))).toEqual({
    kind: "other",
  });
  expect(
    anonymousCheckoutProblem(refused(422, "ConfirmCheckoutSession.EntitlementLimitReached")),
  ).toEqual({
    kind: "other",
  });
});

test("a 429 is too many calls, whoever said so and whatever its code", () => {
  // The API's own refusal is the client's `RateLimitedError`; a gateway in front of it answers a bare
  // 429, or a code the client does not know, and the wait is the one it gave else a minute.
  const bare = (code: string | undefined, retryAfterSeconds?: number) =>
    new KaitenError(
      api(429, code),
      retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
    );
  for (const operation of ["start", "session"] as const) {
    expect(anonymousCheckoutProblem(bare(undefined), operation)).toEqual({
      kind: "rate_limited",
      retryAfterSeconds: 60,
    });
    expect(anonymousCheckoutProblem(bare("Gateway.Throttled", 12), operation)).toEqual({
      kind: "rate_limited",
      retryAfterSeconds: 12,
    });
  }
  // Another status with the same words is not.
  expect(anonymousCheckoutProblem(refused(503, "CreateCheckoutSession.RateLimited"))).toEqual({
    kind: "other",
  });
});

test("the classes the client tells apart carry what a screen needs of them", () => {
  expect(
    anonymousCheckoutProblem(
      new TurnstileFailedError(api(422, "CreateCheckoutSession.TurnstileFailed")),
    ),
  ).toEqual({ kind: "turnstile_failed" });
  expect(
    anonymousCheckoutProblem(
      new TurnstileUnavailableError(api(503, "CreateCheckoutSession.TurnstileUnavailable"), {
        retryAfterSeconds: 30,
      }),
    ),
  ).toEqual({ kind: "turnstile_unavailable", retryAfterSeconds: 30 });
  expect(
    anonymousCheckoutProblem(
      new RateLimitedError(api(429, "CreateCheckoutSession.RateLimited"), {
        retryAfterSeconds: 45,
      }),
    ),
  ).toEqual({ kind: "rate_limited", retryAfterSeconds: 45 });
  expect(
    anonymousCheckoutProblem(
      new ProviderUnavailableError(api(503, "ConfirmCheckoutSession.ProviderUnavailable"), {
        retryAfterSeconds: 30,
      }),
    ),
  ).toEqual({ kind: "unavailable", retryAfterSeconds: 30 });
  expect(
    anonymousCheckoutProblem(
      new DueTodayChangedError(api(409, "ConfirmCheckoutSession.DueTodayChanged")),
    ),
  ).toEqual({ kind: "due_today_changed" });
  expect(anonymousCheckoutProblem(new CheckoutTokenMissingError("chk_1"))).toEqual({
    kind: "session_lost",
  });
  expect(anonymousCheckoutProblem(new KaitenNetworkError("offline"))).toEqual({ kind: "network" });
});

test("a session closed says how it closed, when the API said", () => {
  const closed = (value?: unknown) =>
    new CheckoutSessionClosedError({
      ...api(409, "ConfirmCheckoutSession.SessionClosed"),
      errors: value === undefined ? undefined : [{ location: "session", message: "closed", value }],
    });
  expect(anonymousCheckoutProblem(closed({ status: "EXPIRED" }))).toEqual({
    kind: "session_closed",
    status: "EXPIRED",
  });
  expect(anonymousCheckoutProblem(closed())).toEqual({ kind: "session_closed", status: null });
});

test("a token the API refuses is a session this browser lost, on a confirm or a read", () => {
  expect(anonymousCheckoutProblem(refused(401, "PublicAuth.InvalidCredential"), "session")).toEqual(
    {
      kind: "session_lost",
    },
  );
  // The operation defaults to a call about a session.
  expect(anonymousCheckoutProblem(refused(401, "PublicAuth.InvalidCredential"))).toEqual({
    kind: "session_lost",
  });
});

test("a publishable key the API refuses on the start is a configuration, not a lost session", () => {
  expect(anonymousCheckoutProblem(refused(401, "PublicAuth.InvalidCredential"), "start")).toEqual({
    kind: "not_available",
  });
  expect(anonymousCheckoutProblem(refused(403, "Auth.WrongCredentialKind"), "start")).toEqual({
    kind: "not_available",
  });
  // The reasons a start is refused for are the same whichever operation names them.
  expect(
    anonymousCheckoutProblem(refused(422, "CreateCheckoutSession.InvalidReturnUrl"), "start"),
  ).toEqual({ kind: "not_available" });
  expect(
    anonymousCheckoutProblem(refused(422, "CreateCheckoutSession.InvalidEmail"), "start"),
  ).toEqual({
    kind: "invalid_email",
  });
});

test("an unavailable quota check is unavailable, with the wait the API gave", () => {
  const error = new KaitenError(api(503, "Entitlement.VerificationUnavailable"), {
    retryAfterSeconds: 30,
  });
  expect(anonymousCheckoutProblem(error)).toEqual({ kind: "unavailable", retryAfterSeconds: 30 });
  expect(anonymousCheckoutProblem(refused(503, "Entitlement.VerificationUnavailable"))).toEqual({
    kind: "unavailable",
    retryAfterSeconds: null,
  });
});

test("anything else, an error of the page's own included, is other", () => {
  expect(anonymousCheckoutProblem(refused(500, "Whatever.Broke"))).toEqual({ kind: "other" });
  expect(anonymousCheckoutProblem(refused(400, undefined))).toEqual({ kind: "other" });
  expect(anonymousCheckoutProblem(new TypeError("a start the client refused"))).toEqual({
    kind: "other",
  });
  expect(anonymousCheckoutProblem("not even an error")).toEqual({ kind: "other" });
});
