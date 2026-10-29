// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Gate } from "../src/components/control/gate.tsx";
import { KaitenProvider } from "../src/providers/kaiten-provider.tsx";
import { useKaitenAvailable } from "../src/providers/kaiten-provider.tsx";
import type { LicensingSnapshot } from "../src/types.ts";

afterEach(cleanup);

/** Snapshot with a single numeric entitlement at `current` of `limit`. */
function snapshotWith(current: number, limit: number): LicensingSnapshot {
  return {
    customer: { id: "c1", slug: "acme", name: "Acme" },
    instance: { id: "i1", slug: "prod", name: "Prod" },
    license: { id: "l1", slug: "starter", name: "Starter" },
    entitlements: [
      {
        id: "e1",
        slug: "seats",
        name: "Seats",
        type: "NUMBER",
        limitValue: { type: "number", value: limit },
        currentValue: { type: "number", value: current },
        unlimited: false,
        remaining: Math.max(limit - current, 0),
        percentageUsed: limit > 0 ? (current / limit) * 100 : 0,
      },
    ],
    flags: [],
    plans: [],
    addOns: [],
    credits: [],
    actions: [],
  } as unknown as LicensingSnapshot;
}

// SWR's cache is global and keyed on (mode, customerId, instanceId), so tests
// sharing a customer id read each other's snapshots. Each test gets its own.
function withProvider(customerId: string, snapshot: LicensingSnapshot, children: ReactNode) {
  const client = {
    getCatalog: vi.fn(async () => ({ plans: [], entitlements: [] })),
    getLicensingSnapshot: vi.fn(async () => snapshot),
  } as never;

  return (
    <KaitenProvider mode="authenticated" accessToken="t" customerId={customerId} client={client}>
      {children}
    </KaitenProvider>
  );
}

test("reports the quota so a host can render its own badge", async () => {
  render(
    withProvider(
      "gate-warning",
      snapshotWith(28, 30),
      <Gate entitlement="seats">
        {({ blocked, warning, current, limit, metered }) => (
          <div>
            <span data-testid="label">{`${current}/${limit}`}</span>
            <span data-testid="state">{blocked ? "blocked" : warning ? "warning" : "ok"}</span>
            <span data-testid="metered">{String(metered)}</span>
          </div>
        )}
      </Gate>,
    ),
  );

  // 28/30 is past the 0.8 threshold but still under the cap: warn, don't block.
  await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("warning"));
  expect(screen.getByTestId("label").textContent).toBe("28/30");
  expect(screen.getByTestId("metered").textContent).toBe("true");
});

test("blocks once the quota is exhausted", async () => {
  render(
    withProvider(
      "gate-blocked",
      snapshotWith(30, 30),
      <Gate entitlement="seats">
        {({ blocked, allowed }) => <span data-testid="state">{`${blocked}:${allowed}`}</span>}
      </Gate>,
    ),
  );

  await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("true:false"));
});

test("stays open while the snapshot is still loading", async () => {
  // A spinner on every guarded button is worse than a call the API rejects.
  render(
    withProvider(
      "gate-loading",
      snapshotWith(30, 30),
      <Gate entitlement="seats">
        {({ allowed, isLoading }) => <span data-testid="state">{`${allowed}:${isLoading}`}</span>}
      </Gate>,
    ),
  );

  expect(screen.getByTestId("state").textContent).toBe("true:true");
});

test("renders everything as allowed with no provider at all", () => {
  // The regression this exists for: every other hook throws here, so a host
  // rolling Kaiten out behind a flag would have to fork each call site.
  render(
    <Gate entitlement="seats">
      {({ allowed, blocked, metered }) => (
        <span data-testid="state">{`${allowed}:${blocked}:${metered}`}</span>
      )}
    </Gate>,
  );

  expect(screen.getByTestId("state").textContent).toBe("true:false:false");
});

test("useKaitenAvailable reports whether a provider is mounted", async () => {
  function Probe() {
    return <span data-testid="available">{String(useKaitenAvailable())}</span>;
  }

  const bare = render(<Probe />);
  expect(screen.getByTestId("available").textContent).toBe("false");
  bare.unmount();

  render(withProvider("gate-probe", snapshotWith(1, 10), <Probe />));
  expect(screen.getByTestId("available").textContent).toBe("true");
});
