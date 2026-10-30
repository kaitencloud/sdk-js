// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Current management consumer. The historical 1.0 consumer stays unchanged.
import { KaitenClient, KaitenApi } from "@kaitencloud/client";
import type {
  BillingInterval,
  KaitenClientLike,
  KaitenCatalog,
  LicensingSnapshot,
  PlanPrice,
} from "@kaitencloud/client";

const price: PlanPrice = { amount: 4900, currencyCode: "EUR", interval: "month" };
const snapshot: LicensingSnapshot = {
  source: "snapshot",
  customer: null,
  instance: null,
  license: null,
  plans: [],
  addOns: [],
  credits: [],
  entitlements: [],
  flags: [],
  actions: [],
  capabilities: { paymentMethods: false, invoices: false, unsubscribe: false, checkout: false },
};
export const double: KaitenClientLike = {
  getCatalog: async (): Promise<KaitenCatalog> => ({
    plans: [{ slug: "pro", name: "Pro", prices: [price] }],
  }),
  getLicensingSnapshot: async () => snapshot,
  reportUsage: async () => ({
    entitlementId: "e",
    entitlementSlug: "seats",
    licenseId: "l",
    licenseSlug: "pro",
    value: { type: "number", value: 1 },
  }),
};
export function intervalName(interval: BillingInterval): string {
  switch (interval) {
    case "month":
      return "monthly";
    case "year":
      return "annual";
    case "one_time":
      return "once";
    default: {
      const unreachable: never = interval;
      return unreachable;
    }
  }
}
export async function management(client: KaitenClient) {
  await client.customers.get("acme");
  await client.instances.get("prod");
  await client.licenses.list();
  await client.components.getSnapshot("acme", "prod");
  return KaitenApi.getFeatureFlags();
}
