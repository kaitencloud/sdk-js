// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "vite-plus/test";
import { KaitenClient } from "@kaitencloud/client";
import { KaitenError } from "@kaitencloud/client";
import { kaitenKeys } from "../src/hooks/query-keys.ts";
import { formatKaitenDate } from "../src/index.ts";

test("KaitenClient constructor accepts config", () => {
  const client = new KaitenClient({
    apiUrl: "https://api.example.com/api",
    authScheme: "bearer",
    tokenProvider: () => "test-token",
  });
  expect(client).toBeDefined();
});

test("KaitenError exposes status and title", () => {
  const err = new KaitenError({
    title: "Not Found",
    status: 404,
    detail: "Customer not found",
  });
  expect(err.status).toBe(404);
  expect(err.message).toBe("Not Found");
  expect(err.detail).toBe("Customer not found");
});

test("kaitenKeys produces stable, scope-prefixed key structures", () => {
  const scope = "authenticated:/api:cust-1:inst-1";

  expect(kaitenKeys.components.snapshot(scope)).toEqual([
    "kaiten",
    scope,
    "components",
    "snapshot",
  ]);
  expect("featureFlag" in kaitenKeys).toBe(false);
});

test("formatKaitenDate formats valid inputs and preserves invalid strings", () => {
  // Date-only strings render in the host's local calendar (no UTC shift).
  expect(formatKaitenDate("2026-12-31", { locale: "en-US" })).toBe("Dec 31, 2026");
  // A full timestamp shows its instant in the requested zone; pin UTC for a
  // deterministic assertion (the default is now the host zone).
  expect(
    formatKaitenDate(new Date("2026-12-31T00:00:00.000Z"), { locale: "en-US", timeZone: "UTC" }),
  ).toBe("Dec 31, 2026");
  expect(formatKaitenDate("not-a-date")).toBe("not-a-date");
  expect(formatKaitenDate(new Date("not-a-date"), { fallback: "Unknown renewal date" })).toBe(
    "Unknown renewal date",
  );
});
