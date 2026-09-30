/**
 * `@kaitencloud/client/testing` — a fake client and licensing fixtures.
 *
 * Build and test a Kaiten integration with no Kaiten account and no reachable
 * API. Anything that takes a `KaitenClientLike` accepts the fake.
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
