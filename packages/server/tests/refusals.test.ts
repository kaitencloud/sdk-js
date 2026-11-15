// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import {
  Customers,
  createKaitenClient,
  isBoundaryPending,
  isProviderUnavailable,
  isQuotaExceeded,
  isRateLimited,
  KaitenError,
  KaitenNetworkError,
} from "../src/index.ts";

// The refusals are the ones Kaiten serves, recorded for the client package
// (packages/client/tests/fixtures/README.md), with the Retry-After they came
// with. Each predicate names one of them and no other; the rest stay readable
// by `status` and `code`.

interface Refusal {
  status: number;
  body: Record<string, unknown>;
  retryAfter?: number;
}

const RECORDED = JSON.parse(
  readFileSync(
    new URL("../../client/tests/fixtures/session.initech.json", import.meta.url),
    "utf8",
  ),
) as { errors: Record<string, Refusal> };

/** The problem a checkout renders for an instance that uses more than the plan allows. */
const QUOTA_EXCEEDED: Refusal = {
  status: 422,
  body: {
    title: "Unprocessable Entity",
    status: 422,
    detail:
      "the instance already uses more than this plan allows: choose a larger plan, or add-ons",
    instance: "/api/public/session/checkout",
    code: "CreateSessionCheckout.QuotaExceeded",
    errors: [
      {
        message: "entitlements over the plan's limit",
        location: "body.basePriceId",
        value: { entitlementSlugs: ["seats", "api-calls"] },
      },
    ],
  },
};

const refusal = (key: string): Refusal => structuredClone(RECORDED.errors[key]!);

/** The error a call throws when the API answers with `reply`. */
async function thrownFor(
  reply: Response | { status: number; body: unknown; retryAfter?: number | string },
) {
  const response =
    reply instanceof Response
      ? reply
      : new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), {
          status: reply.status,
          headers: {
            "content-type": "application/problem+json",
            ...(reply.retryAfter === undefined ? {} : { "retry-after": `${reply.retryAfter}` }),
          },
        });
  const client = createKaitenClient({
    token: "ksh_vendor",
    baseUrl: "https://example.test",
    fetch: async () => response,
  });
  return Customers.listCustomers({ client }).catch((caught: unknown) => caught);
}

const PREDICATES = {
  isQuotaExceeded,
  isRateLimited,
  isBoundaryPending,
  isProviderUnavailable,
};

/** Which predicates say yes to an error, by name. */
const recognizedBy = (error: unknown) =>
  Object.entries(PREDICATES)
    .filter(([, predicate]) => predicate(error))
    .map(([name]) => name);

describe("the refusals a host acts on", () => {
  test("isQuotaExceeded recognizes a checkout over the plan's quota, and the slugs are readable", async () => {
    const error = await thrownFor(QUOTA_EXCEEDED);

    expect(isQuotaExceeded(error)).toBe(true);
    expect(recognizedBy(error)).toEqual(["isQuotaExceeded"]);
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).errors?.[0]?.value).toEqual({
      entitlementSlugs: ["seats", "api-calls"],
    });
  });

  test("isRateLimited recognizes a 429 and says how long to wait", async () => {
    const error = await thrownFor(refusal("voucherRateLimited"));

    expect(isRateLimited(error)).toBe(true);
    expect(recognizedBy(error)).toEqual(["isRateLimited"]);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 90 });
  });

  test("isBoundaryPending recognizes a period still being closed and says how long", async () => {
    const error = await thrownFor(refusal("cancelBoundaryPending"));

    expect(isBoundaryPending(error)).toBe(true);
    expect(recognizedBy(error)).toEqual(["isBoundaryPending"]);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 409, retryAfterSeconds: 60 });
  });

  test("isProviderUnavailable recognizes a provider that is down and says how long", async () => {
    const error = await thrownFor(refusal("checkoutProviderUnavailable"));

    expect(isProviderUnavailable(error)).toBe(true);
    expect(recognizedBy(error)).toEqual(["isProviderUnavailable"]);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 503, retryAfterSeconds: 30 });
  });

  test("the other refusals are none of them, and stay readable by code", async () => {
    for (const key of ["addonIncompatible", "cancelNotActive", "checkoutAlreadySubscribed"]) {
      const { status, body } = refusal(key);

      const error = await thrownFor(refusal(key));

      expect(recognizedBy(error)).toEqual([]);
      expect(error).toMatchObject({ status, code: body.code });
      expect((error as KaitenError).retryAfterSeconds).toBeUndefined();
    }
  });

  test("the status has to be the API's, not only the end of the code", () => {
    const refused = (status: number, code?: string) =>
      new KaitenError({ title: "Refused", status, code });

    expect(recognizedBy(refused(409, "CreateSessionCheckout.QuotaExceeded"))).toEqual([]);
    expect(recognizedBy(refused(422, "ValidateSessionVoucher.RateLimited"))).toEqual([]);
    expect(recognizedBy(refused(503, "CancelSessionSubscription.BoundaryPending"))).toEqual([]);
    expect(recognizedBy(refused(500, "CreateSessionCheckout.ProviderUnavailable"))).toEqual([]);
    expect(recognizedBy(refused(429))).toEqual([]);
    expect(recognizedBy(refused(429, "RateLimited"))).toEqual([]);
    expect(recognizedBy(refused(409, "BoundaryPendingFor.Nothing"))).toEqual([]);
  });

  test("nothing that is not a KaitenError is one", () => {
    expect(recognizedBy(new Error("boom"))).toEqual([]);
    expect(recognizedBy(new KaitenNetworkError("offline"))).toEqual([]);
    expect(recognizedBy({ status: 429, code: "Anything.RateLimited" })).toEqual([]);
    expect(recognizedBy(undefined)).toEqual([]);
    expect(recognizedBy("RateLimited")).toEqual([]);
  });
});

describe("retryAfterSeconds", () => {
  const rateLimited = refusal("voucherRateLimited");

  test.each([
    ["30", 30],
    ["0", 0],
    [" 7 ", 7],
  ])("a Retry-After of %j is %i seconds", async (header, seconds) => {
    const error = await thrownFor({ ...rateLimited, retryAfter: header });

    expect((error as KaitenError).retryAfterSeconds).toBe(seconds);
  });

  test("an HTTP date is read as seconds from now", async () => {
    const at = new Date(Date.now() + 40_000).toUTCString();

    const error = await thrownFor({ ...rateLimited, retryAfter: at });

    expect((error as KaitenError).retryAfterSeconds).toBeGreaterThanOrEqual(39);
    expect((error as KaitenError).retryAfterSeconds).toBeLessThanOrEqual(40);
  });

  test("a date already past is 0", async () => {
    const error = await thrownFor({ ...rateLimited, retryAfter: "Sun, 06 Nov 1994 08:49:37 GMT" });

    expect((error as KaitenError).retryAfterSeconds).toBe(0);
  });

  test.each(["soon", "-5", "1.5", "12 seconds", ""])(
    "a Retry-After of %j is not read",
    async (header) => {
      const error = await thrownFor({ ...rateLimited, retryAfter: header });

      expect((error as KaitenError).retryAfterSeconds).toBeUndefined();
    },
  );

  test("it is absent when the API sent none", async () => {
    const error = await thrownFor({ status: 429, body: rateLimited.body });

    expect(isRateLimited(error)).toBe(true);
    expect((error as KaitenError).retryAfterSeconds).toBeUndefined();
  });

  test("a proxy's page that is not a problem still carries it", async () => {
    const error = await thrownFor(
      new Response("slow down", { status: 429, headers: { "retry-after": "11" } }),
    );

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 11 });
  });
});
