import { readFileSync } from "node:fs";

import { expect, test } from "vite-plus/test";

import * as Billing from "../src/billing.ts";
import * as Core from "../src/index.ts";

// `@kaitencloud/react/billing` is its own entry so that a host that offers no checkout bundles
// none of it. That is only true while the root does not reach for it, and while what the entry
// exports is what the documents say it exports.

const BILLING_SURFACE = [
  "isPlausibleEmail",
  "useBillingPortal",
  "useCancelSubscription",
  "useCheckout",
  "useCheckoutPreview",
  "useInvoiceSettlement",
  "useInvoices",
  "usePaymentMethodSession",
  "useReactivateSubscription",
  "useSetAddonQuantity",
  "useValidateVoucher",
] as const;

test("the billing entry exports exactly the billing hooks", () => {
  expect(Object.keys(Billing).sort()).toEqual([...BILLING_SURFACE].sort());
});

test("the root exports none of them, and none of what they are made of", () => {
  const leaked = [...BILLING_SURFACE, "kaitenInvoicesKey", "useSetupReturn"].filter(
    (name) => name in Core,
  );
  expect(leaked).toEqual([]);
});

const STABILITY = ["packages/react/STABILITY.md", "STABILITY.md"]
  .map((path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  })
  .find((text) => text !== undefined)!;

test("STABILITY.md names every export of the billing entry, and says it is stable", () => {
  const unnamed = BILLING_SURFACE.filter((name) => !new RegExp(`\\b${name}\\b`).test(STABILITY));
  expect(unnamed).toEqual([]);
  expect(STABILITY).toContain("`@kaitencloud/react/billing` is stable");
  // The unions a minor release may add a member to are named, with the rules they grow by.
  const growing = [
    "CheckoutProblem",
    "AddonQuantityProblem",
    "CheckoutStep",
    "CheckoutVoucherState",
  ];
  const section = STABILITY.slice(STABILITY.indexOf("### Unions that grow"));
  expect(growing.filter((name) => !section.includes(`\`${name}\``))).toEqual([]);
});
