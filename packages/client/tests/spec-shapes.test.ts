// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

// `src/client/session-spec-shapes.ts` holds, by hand, the shapes the specification gives and the
// contract snapshot does not carry yet. This file is the reminder to throw them out: it fails the
// day `contracts/openapi.yaml` serves one, and says which.

const CONTRACT = readFileSync(new URL("../../../contracts/openapi.yaml", import.meta.url), "utf8");

describe("the shapes written by hand from the specification", () => {
  test("are not in the contract snapshot: the day they are, use the generated types", () => {
    // The redemption of a code on a live subscription (`redeemVoucher`). The trial block of the
    // portal was in this list until the contract served it (`PortalTrial`).
    expect(CONTRACT, "POST /public/session/vouchers/redeem is in the contract now").not.toContain(
      "/public/session/vouchers/redeem:",
    );
  });
});
