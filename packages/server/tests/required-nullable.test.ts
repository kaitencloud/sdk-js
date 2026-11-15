// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, expectTypeOf, test } from "vite-plus/test";
import { createKaitenClient, Customers } from "../src/index.ts";
import type {
  Addon,
  AddonFamily,
  AddonEntitlement,
  BillingProvider,
  InstanceAddon,
  InvoiceHandoff,
  PublicPrice,
  Voucher,
} from "../src/index.ts";

test("generated readers require nullable members instead of optional guesses", () => {
  expectTypeOf<Addon["maxQuantity"]>().toEqualTypeOf<number | null>();
  expectTypeOf<AddonFamily["currentVersion"]>().toEqualTypeOf<Addon | null>();
  expectTypeOf<AddonEntitlement["limitCapExceededOveragePercent"]>().toEqualTypeOf<number | null>();
  expectTypeOf<InstanceAddon["removedAt"]>().toEqualTypeOf<string | null>();
  expectTypeOf<BillingProvider["livemode"]>().toEqualTypeOf<boolean | null>();
  expectTypeOf<BillingProvider["unavailableReason"]>().toEqualTypeOf<
    "NOT_ENTITLED" | "VAULT_NOT_CONFIGURED" | null
  >();
  expectTypeOf<InvoiceHandoff["leaseId"]>().toEqualTypeOf<string | null>();
  expectTypeOf<PublicPrice["unitAmount"]>().toEqualTypeOf<number | null>();
  expectTypeOf<Voucher["durationInPeriods"]>().toEqualTypeOf<number | null>();
});

test("a nullable PUT input reaches the API unchanged: null is not client-side erasure", async () => {
  let sent: Request | undefined;
  const client = createKaitenClient({
    token: "ksh_test",
    baseUrl: "https://example.test",
    fetch: async (input, init) => {
      sent = input instanceof Request ? input.clone() : new Request(input, init);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    },
  });
  const body = { name: "Acme", billingEmail: null, externalCustomerId: null };
  await Customers.updateCustomer({ client, path: { customerSlug: "acme" }, body });
  expect(sent?.method).toBe("PUT");
  expect(await sent!.json()).toEqual(body);
});
