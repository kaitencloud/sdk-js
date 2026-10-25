// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";
import type { KaitenApi } from "../src/index.ts";
import { createMockKaitenSessionClient } from "../src/testing/index.ts";
import { responseProblems } from "./support/contract-schema.ts";
import { answer } from "./support/session-answers.ts";
import { json, open, useSessionClock } from "./support/session-harness.ts";

useSessionClock();

const exception = {
  instanceEntitlementExceptionId: "00000000-0000-4000-8000-000000000f01",
  kind: "ADD",
  value: { type: "number", value: 50000 },
  startsAt: "2026-10-01T00:00:00Z",
  endsAt: null,
} satisfies KaitenApi.ProvenanceException;

function portalWithException() {
  const body = answer("portal");
  const entitlement = body.entitlements.find(({ slug }) => slug === "api-calls")!;
  entitlement.source = "exception";
  entitlement.limitValue = { type: "number", value: 250000 };
  entitlement.maximumAllowedUsage = 300000;
  entitlement.percentageUsed = 12;
  entitlement.provenance!.exception = structuredClone(exception);
  entitlement.provenance!.number!.effective = 250000;
  return body;
}

const read = async (body: unknown) => open(() => json(body)).client.getPortal();
const calls = (portal: Awaited<ReturnType<typeof read>>) =>
  portal.entitlements.find(({ slug }) => slug === "api-calls")!;

describe("the last entitlement layer of a public portal", () => {
  test("keeps the exception and the before/after figures without recomputing access", async () => {
    const body = portalWithException();
    expect(responseProblems("GET", "/public/session/portal", 200, body)).toEqual([]);
    const entitlement = calls(await read(body));
    expect(entitlement).toMatchObject({
      source: "license", // The 1.0 closed union; the actual source is separate.
      effectiveSource: "exception",
      limitValue: { type: "number", value: 250000 },
      maximumAllowedUsage: 300000,
      percentageUsed: 12,
      provenance: {
        exception,
        number: { afterBoosts: 200000, effective: 250000 },
      },
    });
    const double = createMockKaitenSessionClient({ portal: await read(body) });
    expect(calls(await double.getPortal())).toEqual(entitlement);
  });

  test.each([
    ["SET", { type: "boolean", value: false }],
    ["SET", { type: "object", value: { theme: "light" } }],
    ["UNLIMITED", null],
  ] as const)("keeps a %s exception's tagged value, including null", async (kind, value) => {
    const body = portalWithException();
    const entry = body.entitlements.find(({ slug }) => slug === "api-calls")!;
    entry.provenance!.exception = { ...exception, kind, value };
    expect(responseProblems("GET", "/public/session/portal", 200, body)).toEqual([]);
    expect(calls(await read(body)).provenance?.exception).toEqual({ ...exception, kind, value });
  });

  test("distinguishes a current null from absence on an older server", async () => {
    const body = answer("portal");
    expect(calls(await read(body)).provenance?.exception).toBeNull();
    const entry = body.entitlements.find(({ slug }) => slug === "api-calls")!;
    const { exception: _, ...provenance } = entry.provenance!;
    const { afterBoosts: __, ...number } = provenance.number!;
    const boosts = provenance.boosts.map(({ value: ___, ...boost }) => boost);
    const older = {
      ...body,
      entitlements: [{ ...entry, provenance: { ...provenance, number, boosts } }],
    };
    const mapped = calls(await read(older));
    expect(mapped.provenance).not.toHaveProperty("exception");
    expect(mapped.provenance?.number).not.toHaveProperty("afterBoosts");
    expect(mapped.provenance?.boosts[0]).not.toHaveProperty("value");
  });

  test("preserves an unknown source and exception kind in their open members", async () => {
    const body = portalWithException();
    const entry = body.entitlements.find(({ slug }) => slug === "api-calls")!;
    const newer = {
      ...body,
      entitlements: [
        {
          ...entry,
          source: "bundle",
          provenance: { ...entry.provenance, exception: { ...exception, kind: "CLAMP" } },
        },
      ],
    };
    expect(calls(await read(newer))).toMatchObject({
      effectiveSource: "bundle",
      provenance: { exception: { kind: "CLAMP" } },
    });
  });

  test("maps a BOOLEAN/CONFIG provenance boost without turning null or false into a number", async () => {
    for (const value of [
      null,
      { type: "boolean", value: false },
      { type: "object", value: { logo: "custom" } },
    ] as const) {
      const body = answer("portal");
      const boost = body.entitlements.find(({ slug }) => slug === "api-calls")!.provenance!
        .boosts[0]!;
      boost.value = value;
      expect(responseProblems("GET", "/public/session/portal", 200, body)).toEqual([]);
      expect(calls(await read(body)).provenance?.boosts[0]?.value).toEqual(value);
    }
  });
});

describe("all the parts of a voucher check", () => {
  const voucher = {
    name: "Launch bundle",
    voucherType: "COMPOSITE",
    duration: "REPEATING",
    durationInPeriods: 3,
    discount: { type: "PERCENTAGE", value: "20", appliesTo: "LICENSE_BASE" },
    boosts: [
      { entitlementSlug: "sso", modifierType: "SET", value: false },
      { entitlementSlug: "branding", modifierType: "SET", value: { logo: "launch" } },
      { entitlementSlug: "api-calls", modifierType: "MULTIPLY", modifierValue: "2.5" },
    ],
    flagGrants: [{ flagSlug: "new-dashboard", variant: "enabled" }],
  } satisfies KaitenApi.SessionVoucher;

  test("retains the discount, bare boolean/config values, decimal modifier and flag grants together", async () => {
    const body = { valid: true, voucher };
    expect(responseProblems("POST", "/public/session/vouchers/validate", 200, body)).toEqual([]);
    const result = await open(() => json(body)).client.validateVoucher({ code: "LAUNCH" });
    expect(result).toMatchObject({
      valid: true,
      voucher: {
        ...voucher,
        boosts: voucher.boosts.map((boost) => ({ modifierValue: null, ...boost })),
      },
    });
    if (!result.valid) throw new Error("expected a valid voucher");
    expect(result.voucher.boosts?.[2]).not.toHaveProperty("value");
    const double = createMockKaitenSessionClient({ vouchers: { LAUNCH: result.voucher } });
    expect(await double.validateVoucher({ code: "LAUNCH" })).toEqual(result);
    expect(await double.redeemVoucher({ code: "LAUNCH", dryRun: true })).toMatchObject({
      voucherType: "COMPOSITE",
      appliesFromInvoice: "next",
      applicationsMax: 3,
    });
  });

  test("keeps null flag grants and a null boost value distinct from omitted parts", async () => {
    const body = {
      valid: true,
      voucher: { ...voucher, flagGrants: null, boosts: [{ ...voucher.boosts[0], value: null }] },
    };
    expect(responseProblems("POST", "/public/session/vouchers/validate", 200, body)).toEqual([]);
    const result = await open(() => json(body)).client.validateVoucher({ code: "LAUNCH" });
    expect(result).toMatchObject({ voucher: { flagGrants: null, boosts: [{ value: null }] } });
    const older = await open(() => json(answer("voucherBoost"))).client.validateVoucher({
      code: "DOUBLE",
    });
    expect(older).not.toHaveProperty("voucher.flagGrants");
    expect(older).not.toHaveProperty("voucher.boosts.0.value");
  });
});

test("INCOMPLETE keeps the lifecycle members the contract serves, but invents no pending selection", async () => {
  const body = answer("portal");
  body.subscription!.status = "INCOMPLETE";
  const portal = await read(body);
  expect(portal.subscription?.status).toBe("INCOMPLETE");
  expect(portal.instance).toEqual(body.instance);
  expect(portal.subscription).toMatchObject({
    incompleteExpiresAt: null,
    canceledAt: null,
    cancellationReason: null,
  });
  for (const member of ["pendingLicenseSlug", "pendingSelection"]) {
    expect(portal.subscription).not.toHaveProperty(member);
  }
  const double = createMockKaitenSessionClient({ portal });
  await expect(double.setAddonQuantity("extra-seats-v1", 1)).rejects.toMatchObject({
    status: 409,
    code: "SetSessionAddonQuantity.SubscriptionIncomplete",
  });
  expect(await double.getPortal()).toEqual(portal);
});
