// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/**
 * `@kaitencloud/client/testing` — a fake client and licensing fixtures.
 *
 * Build and test a Kaiten integration with no Kaiten account and no reachable
 * API. Anything that takes a `KaitenClientLike` accepts the fake, and anything
 * that takes a `KaitenSessionClientLike` accepts the session fake, and anything that
 * takes a `KaitenAnonymousCheckoutClientLike` the anonymous checkout fake.
 *
 * ```ts
 * import { createMockKaitenClient, demoSnapshot } from "@kaitencloud/client/testing";
 *
 * const client = createMockKaitenClient({ snapshot: demoSnapshot() });
 * const snapshot = await client.getLicensingSnapshot("acme");
 * ```
 *
 * Ships in the published package rather than being test-only: an adopter's own
 * test suite needs it as much as this repo's does.
 */

export { createMockKaitenClient } from "./mock-client.ts";
export type { MockKaitenClient, MockKaitenClientOptions } from "./mock-client.ts";

export { createMockKaitenSessionClient } from "./mock-session-client.ts";
export type {
  MockKaitenSessionClient,
  MockKaitenSessionClientOptions,
  MockSessionCall,
} from "./mock-session-client.ts";

export {
  createMockKaitenAnonymousCheckoutClient,
  demoAnonymousCheckoutPlans,
} from "./mock-anonymous-checkout-client.ts";
export type {
  MockAnonymousCheckoutCall,
  MockCheckoutPlan,
  MockCheckoutScript,
  MockKaitenAnonymousCheckoutClient,
  MockKaitenAnonymousCheckoutClientOptions,
} from "./mock-anonymous-checkout-client.ts";

export {
  DEMO_SESSION_NOW,
  demoCheckoutPrices,
  demoPortal,
  demoSessionAddOns,
  demoSessionInvoices,
  demoUnsubscribedPortal,
  demoVouchers,
} from "./session-fixtures.ts";

export {
  demoAddOns,
  demoCatalog,
  demoCatalogWithoutPrices,
  demoCredits,
  demoCustomer,
  demoEntitlements,
  demoFlags,
  demoInstance,
  demoLicense,
  demoPlans,
  demoPlansWithoutPrices,
  demoSnapshot,
  demoSnapshotWithoutPrices,
} from "./fixtures.ts";
