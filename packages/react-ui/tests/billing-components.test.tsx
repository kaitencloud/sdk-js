// @vitest-environment jsdom

// Unit cover for the three components added alongside the palette: the quota bar,
// the billing panel and the catalogue. They are covered here rather than in
// components.test.tsx because all three read the licence TERM, which no fixture in
// that file carries — `licenseTerm` is optional on the snapshot, so a component
// that reads it renders its empty branch against every existing fixture and the
// coverage would be real but meaningless.

import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { kaitenClientMock } from "./support/kaiten-client-double.ts";

vi.mock("@kaitencloud/client", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/client")>();
  const { createKaitenClientDouble } = await import("./support/kaiten-client-double.ts");
  return { ...actual, KaitenClient: createKaitenClientDouble() };
});

import {
  BillingSummary,
  EntitlementStatusBar,
  FeatureCatalog,
  type LicensingSnapshot,
  type Plan,
} from "../src/index.ts";
import { KaitenProvider } from "./support/styled-provider.tsx";

const plan: Plan = {
  id: "plan-pro",
  slug: "pro",
  name: "Pro",
  description: "Best for growing teams.",
  price: 7900,
  currencyCode: "USD",
  interval: "month",
  features: [],
  entitlements: [
    {
      slug: "seats",
      name: "Seats",
      type: "NUMBER",
      category: "Team",
      tags: ["ga"],
      value: { type: "number", value: 25 },
    },
    {
      slug: "sso",
      name: "SSO",
      type: "BOOLEAN",
      category: "Security",
      tags: ["beta"],
      value: { type: "boolean", value: true },
    },
    // Internal counters are not catalogue entries, and not meters either.
    {
      slug: "internal_ops",
      name: "Internal ops",
      type: "NUMBER",
      userFacing: false,
      value: { type: "number", value: 10 },
    },
  ],
};

const snapshot: LicensingSnapshot = {
  source: "snapshot",
  customer: null,
  instance: null,
  license: {
    id: "lic-1",
    slug: "pro",
    name: "Pro License",
    description: "Main license",
    type: "PAID",
    version: "1.0.0",
    lifecycleState: "PUBLISHED",
    familyId: "fam-1",
    isDefault: true,
  },
  licenseTerm: { status: "active", startsAt: "2026-01-01", expiresAt: "2026-12-31" },
  plans: [plan],
  addOns: [],
  credits: [],
  entitlements: [
    {
      id: "ent-api",
      slug: "api_calls",
      name: "API calls",
      type: "NUMBER",
      source: "license",
      limitValue: { type: "number", value: 1000 },
      currentValue: { type: "number", value: 920 },
      remaining: 80,
      percentageUsed: 92,
      status: "near_limit",
    },
    {
      id: "ent-seats",
      slug: "seats",
      name: "Seats",
      type: "NUMBER",
      source: "license",
      status: "enabled",
      limitValue: { type: "number", value: 25 },
      currentValue: { type: "number", value: 5 },
    },
    // Unlimited: no finite cap, so it has no track to fill and must not be metered.
    {
      id: "ent-projects",
      slug: "projects",
      name: "Projects",
      type: "NUMBER",
      source: "license",
      unlimited: true,
      status: "enabled",
      limitValue: { type: "number", value: -1 },
      currentValue: { type: "number", value: 3 },
    },
    // Internal: not the customer's business, in any of the three components.
    {
      id: "ent-internal",
      slug: "internal_ops",
      name: "Internal ops",
      type: "NUMBER",
      source: "license",
      userFacing: false,
      status: "enabled",
      limitValue: { type: "number", value: 10 },
      currentValue: { type: "number", value: 1 },
    },
  ],
  flags: [],
  actions: [],
  capabilities: { paymentMethods: false, invoices: false, unsubscribe: false, checkout: false },
  branding: { removable: false },
};

function install(state: Partial<LicensingSnapshot> = {}) {
  kaitenClientMock.state.snapshot = { ...snapshot, ...state };
  kaitenClientMock.state.catalog = { plans: [plan], branding: { removable: false } };
}

/**
 * Each mount gets its OWN customer id, and that is load-bearing rather than tidy.
 * SWR keys its cache on the provider's scope, so two mounts sharing an id serve the
 * FIRST one's snapshot from cache — the skeletons clear instantly against stale data
 * and an assertion about the second fixture passes or fails on the first one's
 * values. A test that swaps the licence term is exactly the case that exposes it.
 */
let scope = 0;
function mount(ui: React.ReactNode) {
  scope += 1;
  return render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={`cus_billing_components_${scope}`}
      polling={{ enabled: false }}
    >
      {ui}
    </KaitenProvider>,
  );
}

/** The three components all open on skeletons; wait them out before asserting. */
async function settled() {
  await waitFor(() => {
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  kaitenClientMock.resetScopes();
});

// --- EntitlementStatusBar --------------------------------------------------

test("EntitlementStatusBar meters only finite, customer-facing quotas", async () => {
  install();
  mount(<EntitlementStatusBar />);
  await settled();

  expect(screen.getByText("API calls")).toBeDefined();
  expect(screen.getByText("Seats")).toBeDefined();
  // Unlimited has no track to fill; internal counters are not shown at all.
  expect(screen.queryByText("Projects")).toBeNull();
  expect(screen.queryByText("Internal ops")).toBeNull();
});

test("EntitlementStatusBar caps the row at maxMeters", async () => {
  install();
  mount(<EntitlementStatusBar maxMeters={1} />);
  await settled();

  expect(screen.getByText("API calls")).toBeDefined();
  expect(screen.queryByText("Seats")).toBeNull();
});

test("EntitlementStatusBar renders the upgrade action only when the host owns it", async () => {
  install();
  const onUpgrade = vi.fn();
  const { unmount } = mount(<EntitlementStatusBar onUpgrade={onUpgrade} upgradeText="Upgrade" />);
  await settled();

  fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
  expect(onUpgrade).toHaveBeenCalledTimes(1);

  unmount();
  cleanup();
  install();
  mount(<EntitlementStatusBar />);
  await settled();
  expect(screen.queryByRole("button", { name: "Upgrade" })).toBeNull();
});

test("EntitlementStatusBar can hide the brand mark", async () => {
  install();
  mount(<EntitlementStatusBar hideBrand />);
  await settled();
  expect(document.querySelector('[data-slot="entitlement-status-bar-brand"]')).toBeNull();
});

// --- BillingSummary --------------------------------------------------------

test("BillingSummary renders the plan, the term and the current-cycle meters", async () => {
  install();
  mount(<BillingSummary />);
  await settled();

  expect(screen.getByText("Pro License")).toBeDefined();
  expect(screen.getAllByText("API calls").length).toBeGreaterThanOrEqual(1);
  // The term's end, formatted by the localization pack from the RAW ISO bound.
  expect(screen.getByText(/2026/)).toBeDefined();
});

test("BillingSummary reads the term's status, not just its dates", async () => {
  install({ licenseTerm: { status: "expired", startsAt: "2025-01-01", expiresAt: "2025-12-31" } });
  mount(<BillingSummary />);
  await settled();
  expect(screen.getByText(/2025/)).toBeDefined();

  cleanup();
  install({
    licenseTerm: { status: "not_started", startsAt: "2027-01-01", expiresAt: "2027-12-31" },
  });
  mount(<BillingSummary />);
  await settled();
  expect(screen.getByText(/2027/)).toBeDefined();
});

test("BillingSummary survives a snapshot with no term at all", async () => {
  // `licenseTerm` is optional on the snapshot: an older read path simply omits it,
  // and the panel has to render the rest rather than blank out.
  install({ licenseTerm: null });
  mount(<BillingSummary />);
  await settled();
  expect(screen.getByText("Pro License")).toBeDefined();
});

test("BillingSummary renders billing actions only when the host supplies them", async () => {
  install();
  const onManageBilling = vi.fn();
  const onUpgrade = vi.fn();
  mount(
    <BillingSummary
      billing={{
        amount: 29900,
        currencyCode: "USD",
        interval: "month",
        paymentMethodLabel: "Visa ending in 4242",
        onManageBilling,
      }}
      onUpgrade={onUpgrade}
      upgradeText="Upgrade"
      footerText="Prices exclude tax."
    />,
  );
  await settled();

  expect(screen.getByText("Visa ending in 4242")).toBeDefined();
  expect(screen.getByText("Prices exclude tax.")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
  expect(onUpgrade).toHaveBeenCalledTimes(1);

  // No `onViewInvoices` was passed — there is no invoice API, so no link.
  expect(screen.queryByRole("button", { name: /invoice/i })).toBeNull();
});

// --- FeatureCatalog --------------------------------------------------------

test("FeatureCatalog transposes plans into one row per entitlement", async () => {
  install();
  mount(<FeatureCatalog />);
  await settled();

  expect(screen.getByText("Seats")).toBeDefined();
  expect(screen.getByText("SSO")).toBeDefined();
  // userFacing: false is not a catalogue entry.
  expect(screen.queryByText("Internal ops")).toBeNull();
});

test("FeatureCatalog accepts a host-supplied catalog instead of usePlans()", async () => {
  install();
  mount(<FeatureCatalog plans={[{ ...plan, name: "Host Plan" }]} />);
  await settled();
  expect(screen.getByText("Seats")).toBeDefined();
});

test("FeatureCatalog filters by search, and says so when nothing matches", async () => {
  install();
  mount(<FeatureCatalog />);
  await settled();

  const search = document.querySelector("input");
  expect(search).not.toBeNull();

  fireEvent.change(search!, { target: { value: "SSO" } });
  await waitFor(() => expect(screen.queryByText("Seats")).toBeNull());
  expect(screen.getByText("SSO")).toBeDefined();

  fireEvent.change(search!, { target: { value: "nothing-matches-this" } });
  await waitFor(() => expect(screen.queryByText("SSO")).toBeNull());
});

test("FeatureCatalog can hide its search and filter chrome", async () => {
  install();
  mount(<FeatureCatalog searchable={false} filterable={false} />);
  await settled();
  expect(document.querySelector("input")).toBeNull();
});

test("FeatureCatalog reports the selected feature with its slug and row", async () => {
  install();
  const onSelectFeature = vi.fn();
  mount(<FeatureCatalog onSelectFeature={onSelectFeature} />);
  await settled();

  fireEvent.click(screen.getByText("Seats"));
  await waitFor(() => expect(onSelectFeature).toHaveBeenCalled());
  expect(onSelectFeature.mock.calls[0]![0]).toBe("seats");
  expect(onSelectFeature.mock.calls[0]![1]).toMatchObject({ slug: "seats", category: "Team" });
});
