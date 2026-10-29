// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, expectTypeOf, test } from "vite-plus/test";
import type { KaitenApi } from "../src/index.ts";
import { mapBillingPrice } from "../src/client/billing.ts";
import { responseProblems } from "./support/contract-schema.ts";
import { answer } from "./support/session-answers.ts";
import { json, open, useSessionClock } from "./support/session-harness.ts";

useSessionClock();

test("public lifecycle members are required and nullable in the generated contract", () => {
  expectTypeOf<KaitenApi.SessionSubscription["incompleteExpiresAt"]>().toEqualTypeOf<
    string | null
  >();
  expectTypeOf<KaitenApi.SessionSubscription["canceledAt"]>().toEqualTypeOf<string | null>();
  expectTypeOf<KaitenApi.PaymentMethodLabels["attachedAt"]>().toEqualTypeOf<string | null>();
});

test.each([null, "2026-10-24T12:34:00Z"])(
  "a supplied expiry %s stays as supplied, without a pending selection",
  async (expiry) => {
    const body = answer("portal");
    body.subscription!.status = "INCOMPLETE";
    body.subscription!.incompleteExpiresAt = expiry;
    expect(responseProblems("GET", "/public/session/portal", 200, body)).toEqual([]);
    const result = await open(() => json(body)).client.getPortal();
    expect(result.subscription?.incompleteExpiresAt).toBe(expiry);
    expect(result.subscription).not.toHaveProperty("pendingSelection");
    expect(result.instance).toEqual(body.instance);
  },
);

test("system cancellation metadata survives the mapping with the actual current licence", async () => {
  const body = answer("portal");
  Object.assign(body.subscription!, {
    status: "CANCELED",
    canceledAt: "2026-10-24T12:34:00Z",
    cancellationReason: "INCOMPLETE_EXPIRED",
  });
  const result = await open(() => json(body)).client.getPortal();
  expect(result.subscription).toMatchObject({
    canceledAt: "2026-10-24T12:34:00Z",
    cancellationReason: "INCOMPLETE_EXPIRED",
  });
  expect(result.instance).toEqual(body.instance);
});

test("a null integer amount never becomes zero or a rounded integer", () => {
  const price = answer("portal").subscription!.basePrice;
  const mapped = mapBillingPrice({ ...price, unitAmount: null, unitAmountDecimal: "0.0002" });
  expect(mapped).not.toHaveProperty("amount");
  expect(mapped.unitAmountDecimal).toBe("0.0002");
});
