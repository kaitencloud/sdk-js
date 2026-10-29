// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { createMockKaitenClient, demoCatalog } from "@kaitencloud/client/testing";
import {
  CustomerPortal,
  KaitenProvider,
  KaitenStyleRoot,
  PricingTable,
} from "@kaitencloud/react-ui";

// A pricing page needs no customer and no credential: `mode="static"` renders the
// catalog it is given, without a single request. In production the catalog is read
// server-side, as examples/node does, and passed in as plain data.
const catalog = demoCatalog();

// The portal needs a customer. A fake client stands in for the API so this runs
// without an account; a real app passes `apiUrl`, `accessToken` and `customerId`
// instead of `client`.
const client = createMockKaitenClient();

export function ComponentsPage() {
  return (
    <>
      <section>
        <h2>Pricing, from a static catalog</h2>
        <KaitenProvider mode="static" catalog={catalog}>
          <KaitenStyleRoot>
            <PricingTable showAnnualToggle />
          </KaitenStyleRoot>
        </KaitenProvider>
      </section>
      <section>
        <h2>A customer's portal</h2>
        <KaitenProvider
          mode="authenticated"
          accessToken="demo"
          customerId="acme"
          client={client}
          polling={{ enabled: false }}
        >
          <KaitenStyleRoot>
            <CustomerPortal />
          </KaitenStyleRoot>
        </KaitenProvider>
      </section>
    </>
  );
}
