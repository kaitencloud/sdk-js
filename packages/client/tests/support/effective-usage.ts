// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { KaitenApi } from "../../src/index.ts";

// A usage row as a current Kaiten server answers it: the instance's effective
// entitlement, with the layers that make it up. The licence grants 10,000 tokens
// with a 50% allowance; three units of an add-on add 1,000 each (13,000), and a
// voucher boost doubles that (26,000). The ids are the ones the server names the
// rows each layer comes from by.
//
// `satisfies` holds the row to the type generated from the contract snapshot, so
// a sync that moves the contract fails to compile here.
export const EFFECTIVE_TOKENS_ROW = {
  entitlementId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c10",
  entitlementSlug: "tokens",
  licenseId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c11",
  licenseSlug: "growth",
  value: { type: "number", value: 25000 },
  limit: { type: "number", value: 26000 },
  limitCapExceededOveragePercent: 50,
  source: "license",
  currentPeriodStart: "2026-10-01T00:00:00Z",
  currentPeriodEnd: "2026-11-01T00:00:00Z",
  provenance: {
    license: {
      licenseEntitlementId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c01",
      value: { type: "number", value: 10000 },
      limitCapExceededOveragePercent: 50,
    },
    addons: [
      {
        instanceAddonId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c02",
        addonId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c03",
        addonEntitlementId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c04",
        quantity: 3,
        overrideBehavior: "ADD",
        value: { type: "number", value: 1000 },
        limitCapExceededOveragePercent: null,
        attachedAt: "2026-09-05T09:00:00.123Z",
      },
    ],
    boosts: [
      {
        instanceVoucherId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c05",
        voucherId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c06",
        voucherEntitlementGrantId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c07",
        modifierType: "MULTIPLY",
        modifierValue: 2,
        redeemedAt: "2026-09-06T10:00:00Z",
        effectiveStartsAt: "2026-09-06T10:00:00Z",
        effectiveExpiresAt: null,
      },
    ],
    number: {
      license: 10000,
      afterAddons: 13000,
      boostSet: null,
      boostAdd: null,
      boostMultiply: 2,
      unlimited: false,
      effective: 26000,
    },
  },
} satisfies KaitenApi.EntitlementUsage;

/** The row of an entitlement only an add-on grants: no licence layer, a flag switched on. */
export const ADDON_ONLY_ROW = {
  entitlementId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c20",
  entitlementSlug: "sso",
  licenseId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c11",
  licenseSlug: "growth",
  value: { type: "boolean", value: true },
  limit: { type: "boolean", value: true },
  source: "addon",
  provenance: {
    license: null,
    addons: [
      {
        instanceAddonId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c22",
        addonId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c23",
        addonEntitlementId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c24",
        quantity: 1,
        overrideBehavior: "OVERRIDE",
        value: { type: "boolean", value: true },
        limitCapExceededOveragePercent: null,
        attachedAt: "2026-09-05T09:00:00Z",
      },
    ],
    boosts: [],
    number: null,
  },
} satisfies KaitenApi.EntitlementUsage;
