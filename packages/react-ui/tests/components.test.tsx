// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { act, render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { useReducer } from "react";
import { useSWRConfig } from "swr";
import { expect, test, vi, afterEach } from "vite-plus/test";

import { kaitenClientMock } from "./support/kaiten-client-double.ts";
import { useKaitenDataContext } from "@kaitencloud/react/internal";

import {
  CustomerPortal,
  FeatureComparison,
  formatKaitenDate,
  formatKaitenMoney,
  KaitenBranding,
  KaitenErrorBoundary,
  KaitenFailed,
  Show,
  Paywall,
  PlanBadge,
  UpgradeButton,
  PricingTable,
  emitKaitenEvent,
  usePlans,
  useEntitlementCheck,
  useLicense,
  useReportUsage,
  CurrentPlan,
  IncludedFeatures,
  UsageMeters,
  AddOns,
  FlagsSummary,
  pluralize,
  type LicensingSnapshot,
  type Plan,
} from "../src/index.ts";
import { en as defaultLocalization } from "@kaitencloud/react/locales";
import { KaitenProvider, KaitenScopeProvider } from "./support/styled-provider.tsx";

// --- Option A test seam ------------------------------------------------------
// The live v1 client composes catalog/snapshot from existing endpoints and can
// only produce a MINIMAL snapshot. The React components support a richer
// snapshot, so to keep verifying their rendering we mock KaitenClient and feed
// fixtures directly — decoupling component tests from the SDK's data path.
// The double lives in tests/support/kaiten-client-double.ts, shared with
// hooks.test.tsx. It captures the constructor config and the call arguments, so
// assertions about which provider asked for which customer can actually fail —
// see `kaitenClientMock.register()` for per-scope fixtures.
vi.mock("@kaitencloud/client", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/client")>();
  const { createKaitenClientDouble } = await import("./support/kaiten-client-double.ts");
  return { ...actual, KaitenClient: createKaitenClientDouble() };
});

const basePlan: Plan = {
  id: "plan-pro",
  slug: "pro",
  name: "Pro",
  description: "Best for growing teams.",
  price: 7900,
  annualPrice: 79000,
  currencyCode: "USD",
  interval: "month",
  features: ["Priority support"],
};

const baseSnapshot: LicensingSnapshot = {
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
    versionName: "2026.04",
    lifecycleState: "PUBLISHED",
    familyId: "fam-1",
    isDefault: true,
  },
  plans: [basePlan],
  addOns: [],
  credits: [
    {
      id: "credit-api",
      slug: "api-credits",
      name: "API credits",
      unit: "calls",
      included: 1000,
      consumed: 950,
      available: 50,
    },
  ],
  entitlements: [
    {
      id: "ent-api",
      slug: "api_calls",
      name: "API calls",
      type: "NUMBER",
      source: "license",
      limitValue: { type: "number", value: 1000 },
      currentValue: { type: "number", value: 950 },
      remaining: 50,
      percentageUsed: 95,
      status: "near_limit",
      actions: [
        {
          type: "add_quota",
          label: "Add quota",
          eventName: "kaiten:quota-added",
        },
      ],
    },
  ],
  flags: [
    {
      key: "premium-feature",
      enabled: false,
      value: false,
      reason: "rule",
    },
  ],
  actions: [
    {
      type: "upgrade_plan",
      label: "Upgrade version",
      eventName: "kaiten:plan-changed",
    },
  ],
  capabilities: {
    paymentMethods: false,
    invoices: false,
    unsubscribe: false,
    checkout: false,
  },
  branding: {
    removable: false,
  },
};

/** Snapshot shaped to hit rarely-covered branches in portal section components */
const portalRichSnapshot: LicensingSnapshot = {
  ...baseSnapshot,
  license: {
    ...baseSnapshot.license!,
    type: "TRIAL",
    renewalDate: "2026-12-31",
  },
  entitlements: [
    baseSnapshot.entitlements[0]!,
    {
      id: "ent-sso-portal",
      slug: "sso",
      name: "SSO",
      type: "BOOLEAN",
      source: "license",
      limitValue: { type: "boolean", value: true },
      currentValue: { type: "boolean", value: false },
      status: "disabled",
    },
    {
      id: "ent-ws-portal",
      slug: "workspace",
      name: "Workspace",
      type: "CONFIG",
      category: "Core",
      source: "addon",
      limitValue: { type: "object", value: {} },
      configLabel: "Enterprise",
      currentValue: { type: "object", value: {} },
      status: "enabled",
    },
    {
      id: "ent-storage",
      slug: "storage_gb",
      name: "Storage GB",
      type: "NUMBER",
      source: "license",
      limitValue: { type: "number", value: 100 },
      currentValue: { type: "number", value: 110 },
      remaining: 0,
      percentageUsed: 110,
      status: "over_limit",
    },
  ],
  addOns: [
    {
      id: "addon-1",
      slug: "priority",
      name: "Priority support",
      description: "24/7 support line",
      active: true,
      price: 4900,
      currencyCode: "USD",
      interval: "month",
    },
    {
      id: "addon-2",
      slug: "extra-seats",
      name: "Extra seats",
      active: false,
      prices: [{ amount: 1200, currencyCode: "EUR", interval: "month", label: "Per seat" }],
    },
  ],
  flags: [
    ...baseSnapshot.flags,
    {
      key: "gradual-rollout",
      enabled: true,
      value: true,
      variant: "experiment-a",
      percentage: 25,
      reason: "rule_match",
    },
  ],
};

/** Use a dedicated customer id so SWR does not reuse `cust-1` snapshot from other tests */
const CUSTOMER_PORTAL_RICH = "cust-portal-rich";

// Seeds the mocked KaitenClient (see vi.mock) with the fixtures for a test.
function installFetchMock(options?: {
  snapshot?: LicensingSnapshot;
  catalog?: { plans: Plan[]; branding?: { removable: boolean } };
}) {
  kaitenClientMock.state.snapshot = options?.snapshot ?? baseSnapshot;
  kaitenClientMock.state.catalog = options?.catalog ?? {
    plans: [basePlan],
    branding: { removable: false },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  kaitenClientMock.resetScopes();
});

function PlansProbe() {
  const plans = usePlans();
  return <div>{plans.data?.[0]?.name ?? "loading"}</div>;
}

function LicenseProbe() {
  const license = useLicense();
  return <div>{license.data?.name ?? "loading"}</div>;
}

test("KaitenProvider supports public mode plan loading", async () => {
  installFetchMock();

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PlansProbe />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Pro")).toBeDefined();
  });
});

test("KaitenProvider supports authenticated mode snapshot loading", async () => {
  installFetchMock();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-1"
      polling={{ enabled: false }}
    >
      <LicenseProbe />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Pro License")).toBeDefined();
  });
});

function SessionSwitchProbe({ authenticated }: { authenticated: boolean }) {
  return (
    <KaitenScopeProvider
      publicConfig={{
        mode: "public",
        publishableKey: "pk_switch",
        polling: { enabled: false },
      }}
      authenticatedConfig={
        authenticated
          ? {
              mode: "authenticated",
              accessToken: "tmp_switch",
              customerId: "cust-switch",
              polling: { enabled: false },
            }
          : null
      }
    >
      <PlansProbe />
      <LicenseProbe />
    </KaitenScopeProvider>
  );
}

test("KaitenScopeProvider switches from public catalog to authenticated snapshot", async () => {
  installFetchMock();

  const { rerender } = render(<SessionSwitchProbe authenticated={false} />);

  await waitFor(() => {
    expect(screen.getByText("Pro")).toBeDefined();
  });

  // Public mode loads the catalog only — never the (authenticated) snapshot.
  expect(kaitenClientMock.getLicensingSnapshot).not.toHaveBeenCalled();

  rerender(<SessionSwitchProbe authenticated />);

  await waitFor(() => {
    expect(screen.getByText("Pro License")).toBeDefined();
  });

  expect(document.querySelectorAll("[data-slot='kaiten-portal-host']")).toHaveLength(1);
});

test("CustomerPortal resolves snapshot and renders sections (no stuck skeletons)", async () => {
  installFetchMock();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-1"
      polling={{ enabled: false }}
    >
      <CustomerPortal />
    </KaitenProvider>,
  );

  await waitFor(
    () => {
      expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    },
    { timeout: 3000 },
  );

  expect(screen.getByText("Current plan")).toBeDefined();
  expect(screen.getByText("Pro License")).toBeDefined();
  expect(screen.getByText("Included features")).toBeDefined();
  expect(screen.getByText("Usage meters")).toBeDefined();
  expect(screen.getByText("Add-ons")).toBeDefined();
  // FlagsSummary is intentionally NOT a default element (flag plumbing isn't
  // customer-facing billing data) — it must not appear unless opted in.
  expect(screen.queryByText("Feature flags")).toBeNull();
});

test("CustomerPortal renders an error + retry (not a blank) when the snapshot fails", async () => {
  installFetchMock();
  // The whole snapshot fails to load: the portal must show a recoverable error
  // card instead of silently rendering nothing.
  kaitenClientMock.getLicensingSnapshot.mockRejectedValueOnce(new Error("backend down"));

  render(
    // Unique customerId → a fresh SWR cache key, so the snapshot is actually fetched
    // (and rejected) rather than served from another test's cached success.
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-error-state"
      polling={{ enabled: false }}
    >
      <CustomerPortal />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText(defaultLocalization.states.failed)).toBeDefined();
  });
  expect(screen.getByText(defaultLocalization.states.retry)).toBeDefined();
  // Sections are not rendered behind the error card.
  expect(screen.queryByText("Current plan")).toBeNull();
});

test("emitKaitenEvent dispatches window events", async () => {
  const listener = vi.fn();
  window.addEventListener("kaiten:quota-added", listener as EventListener);

  emitKaitenEvent("kaiten:quota-added", { amount: 10, creditSlug: "api-credits" });

  await waitFor(() => {
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

test("PricingTable supports annual toggle and selection", () => {
  installFetchMock();
  const onSelectPlan = vi.fn();

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable
        plans={[basePlan]}
        showAnnualToggle
        onSelectPlan={onSelectPlan}
        highlightPlan="pro"
      />
    </KaitenProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Choose plan" }));
  expect(onSelectPlan).toHaveBeenCalledWith("pro", expect.objectContaining({ slug: "pro" }));
});

test("Paywall reacts to quota state from snapshot cache", async () => {
  installFetchMock();
  const onThresholdReached = vi.fn();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-1"
      polling={{ enabled: false }}
    >
      <Paywall
        entitlement="api_calls"
        onThresholdReached={onThresholdReached}
        children={<div>Protected content</div>}
      />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Approaching limit")).toBeDefined();
    expect(onThresholdReached).toHaveBeenCalled();
  });
});

test("Paywall fails OPEN under public mode (does not block anonymous visitors)", async () => {
  installFetchMock();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <Paywall entitlement="api_calls">
        <div>Marketing content</div>
      </Paywall>
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Marketing content")).toBeDefined();
  });
  // No wall in public mode, and a dev warning points the adopter at authenticated mode.
  expect(screen.queryByText("Feature unavailable")).toBeNull();
  expect(screen.queryByText("Not available")).toBeNull();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('mode="public"'));
  warn.mockRestore();
});

test("Paywall on a denied boolean entitlement shows no 0% meter", async () => {
  installFetchMock({
    snapshot: {
      ...baseSnapshot,
      entitlements: [
        {
          id: "ent-sso",
          slug: "sso",
          name: "SSO",
          type: "BOOLEAN",
          source: "license",
          limitValue: { type: "boolean", value: false },
          currentValue: { type: "boolean", value: false },
          status: "disabled",
        },
      ],
    },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-bool-denied"
      polling={{ enabled: false }}
    >
      <Paywall entitlement="sso">
        <div>SSO settings</div>
      </Paywall>
    </KaitenProvider>,
  );

  // The wall shows (feature not in plan) but with NO percentage badge and NO meter.
  await waitFor(() => {
    expect(screen.getByText("Not available")).toBeDefined();
  });
  expect(screen.queryByText("0%")).toBeNull();
  expect(document.querySelector('[role="progressbar"]')).toBeNull();
});

// `data-slot="paywall"` said a wall is up; it did not say why. A host asking the
// two questions that matter — a quota that ran out, or a feature the plan never
// included? an outage? — had to re-run `usePaywallTrigger` beside the component
// that already knew. `data-reason` carries that verdict into the DOM, on every
// branch that renders a wall.
test("Paywall states its reason in the DOM: a quota that ran out", async () => {
  installFetchMock();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-reason-over"
      polling={{ enabled: false }}
    >
      <Paywall entitlement="api_calls" threshold={0}>
        <div>metered content</div>
      </Paywall>
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(document.querySelector('[data-slot="paywall"][data-reason]')).not.toBeNull();
  });
  const wall = document.querySelector('[data-slot="paywall"]') as HTMLElement;
  expect(wall.dataset.reason).toBe("near_limit");
});

test("Paywall states its reason in the DOM: not in the plan, and unstyled too", async () => {
  installFetchMock({
    snapshot: {
      ...baseSnapshot,
      entitlements: [
        {
          id: "ent-sso",
          slug: "sso",
          name: "SSO",
          type: "BOOLEAN",
          source: "license",
          limitValue: { type: "boolean", value: false },
          currentValue: { type: "boolean", value: false },
          status: "disabled",
        },
      ],
    },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-reason-denied"
      polling={{ enabled: false }}
    >
      <Paywall entitlement="sso" unstyled>
        <div>SSO settings</div>
      </Paywall>
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(document.querySelector('[data-slot="paywall"][data-reason]')).not.toBeNull();
  });
  expect((document.querySelector('[data-slot="paywall"]') as HTMLElement).dataset.reason).toBe(
    "not_entitled",
  );
});

// The one worth naming: the wall is the fail-closed policy talking, not a
// decision about this customer. A host that greys out a feature on
// `not_entitled` and shows "try again" on `error` needs to tell them apart.
test("Paywall marks a wall raised by an outage as `error`", async () => {
  renderWithFailingSnapshot(
    <Paywall entitlement="api_calls">
      <div>paid content</div>
    </Paywall>,
    "cust-reason-error",
  );

  await waitFor(() => {
    expect(document.querySelector('[data-slot="paywall"][data-reason]')).not.toBeNull();
  });
  expect((document.querySelector('[data-slot="paywall"]') as HTMLElement).dataset.reason).toBe(
    "error",
  );
});

test("KaitenProvider rejects secret keys in public mode", () => {
  expect(() =>
    render(
      <KaitenProvider mode="public" publishableKey="sk_demo" polling={{ enabled: false }}>
        <div>hello</div>
      </KaitenProvider>,
    ),
  ).toThrow(/secret key/i);
});

test("KaitenProvider rejects a platform credential in public mode", () => {
  // `ksm_` reaches every organization, not one, and until the prefix was
  // listed here it fell through to "invalid publishable key format" — a
  // message that names the wrong problem for the worst credential to leak.
  expect(() =>
    render(
      <KaitenProvider mode="public" publishableKey="ksm_demo" polling={{ enabled: false }}>
        <div>hello</div>
      </KaitenProvider>,
    ),
  ).toThrow(/secret key/i);
});

test("hideBranding only hides removable branding", async () => {
  installFetchMock();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-removable"
      hideBranding
      polling={{ enabled: false }}
    >
      <LicenseProbe />
      <KaitenBranding />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Pro License")).toBeDefined();
  });

  expect(screen.getByRole("link", { name: "Powered by Kaiten" })).toBeDefined();

  cleanup();
  vi.unstubAllGlobals();

  installFetchMock({
    snapshot: {
      ...baseSnapshot,
      branding: { removable: true },
    },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-removable-true"
      hideBranding
      polling={{ enabled: false }}
    >
      <LicenseProbe />
      <KaitenBranding />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Pro License")).toBeDefined();
  });

  await waitFor(() => {
    expect(screen.queryByRole("link", { name: "Powered by Kaiten" })).toBeNull();
  });
});

test("hideBranding bypass attempt emits telemetry and dev warning", async () => {
  installFetchMock();
  const transport = vi.fn();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-bypass"
      hideBranding
      polling={{ enabled: false }}
      telemetry={{ transport }}
    >
      <KaitenBranding />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByRole("link", { name: "Powered by Kaiten" })).toBeDefined();
  });

  await waitFor(() => {
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "action",
        name: "branding.bypass_attempted",
      }),
    );
  });

  expect(warn).toHaveBeenCalledWith(expect.stringMatching(/license does not allow removal/));
  warn.mockRestore();
});

test("redundant nested KaitenProvider (identical config) is deduped and warns", async () => {
  installFetchMock();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-outer"
      polling={{ enabled: false }}
    >
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_demo"
        customerId="cust-outer"
        polling={{ enabled: false }}
      >
        <LicenseProbe />
      </KaitenProvider>
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Pro License")).toBeDefined();
  });

  // Identical scope → the inner provider is a no-op pass-through, and a dev
  // warning flags the redundant double-wrap. (The provider renders no element of
  // its own to count here; the scope-key pass-through is pinned in the core's
  // static-mode suite.)
  expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Redundant nested <KaitenProvider>/));

  warn.mockRestore();
});

test("nested KaitenProvider with a different config gets its own independent scope", async () => {
  installFetchMock();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-outer"
      polling={{ enabled: false }}
    >
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_demo"
        customerId="cust-inner"
        polling={{ enabled: false }}
      >
        <LicenseProbe />
      </KaitenProvider>
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Pro License")).toBeDefined();
  });

  // A different scope is intentional multi-scope: each provider gets its own
  // scope (and, in this harness, its own style root) and there is NO "redundant"
  // warning.
  expect(
    document.querySelectorAll("[data-slot='kaiten-portal-host']").length,
  ).toBeGreaterThanOrEqual(2);
  expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/Redundant nested/));

  warn.mockRestore();
});

// The test above proves the two providers mount separate roots, but both
// read the same fixture, so it cannot tell a correctly-scoped provider from one
// that sends every request to the same customer. These do.

test("each provider reads the customer it was configured with, not a shared fixture", async () => {
  installFetchMock();
  kaitenClientMock.register(
    { customerId: "cust-iso-outer" },
    { snapshot: { ...baseSnapshot, license: { ...baseSnapshot.license!, name: "Outer License" } } },
  );
  kaitenClientMock.register(
    { customerId: "cust-iso-inner" },
    { snapshot: { ...baseSnapshot, license: { ...baseSnapshot.license!, name: "Inner License" } } },
  );

  render(
    <>
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_demo"
        customerId="cust-iso-outer"
        polling={{ enabled: false }}
      >
        <LicenseProbe />
      </KaitenProvider>
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_demo"
        customerId="cust-iso-inner"
        polling={{ enabled: false }}
      >
        <LicenseProbe />
      </KaitenProvider>
    </>,
  );

  await waitFor(() => {
    expect(screen.getByText("Outer License")).toBeDefined();
    expect(screen.getByText("Inner License")).toBeDefined();
  });
});

test("the provider forwards its customerId and instanceId to the snapshot read", async () => {
  installFetchMock();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-routed"
      instanceId="inst-routed"
      polling={{ enabled: false }}
    >
      <LicenseProbe />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(kaitenClientMock.getLicensingSnapshot).toHaveBeenCalledWith(
      "cust-routed",
      "inst-routed",
    );
  });
});

test("a public and an authenticated provider each build their own client", async () => {
  installFetchMock();

  render(
    <>
      <KaitenProvider mode="public" publishableKey="pk_scoped" polling={{ enabled: false }}>
        <PlansProbe />
      </KaitenProvider>
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_scoped"
        customerId="cust-iso-mode"
        polling={{ enabled: false }}
      >
        <LicenseProbe />
      </KaitenProvider>
    </>,
  );

  await waitFor(() => {
    expect(kaitenClientMock.state.constructions.length).toBeGreaterThanOrEqual(2);
  });

  // Asserted on the constructions rather than on rendered data: SWR keys are
  // scoped per provider but the cache itself is still the shared one, and an
  // entry outlives the test that created it — an earlier test in this file using
  // the same scope would answer this one.
  const scopes = kaitenClientMock.state.constructions;
  expect(scopes.map((scope) => scope.mode)).toContain("public");
  expect(scopes.map((scope) => scope.mode)).toContain("authenticated");
  expect(scopes.find((scope) => scope.mode === "public")?.token).toBe("pk_scoped");
  expect(scopes.find((scope) => scope.mode === "authenticated")?.token).toBe("tmp_scoped");
});

test("KaitenStyleRoot exposes portal stacking through appearance.zIndex", () => {
  installFetchMock();

  render(
    <KaitenProvider
      mode="public"
      publishableKey="pk_demo"
      polling={{ enabled: false }}
      appearance={{ zIndex: 240 }}
    >
      <div>Scoped content</div>
    </KaitenProvider>,
  );

  const portalHost = document.querySelector('[data-slot="kaiten-portal-host"]') as HTMLElement;
  const root = portalHost.parentElement as HTMLElement;

  expect(portalHost).toBeTruthy();
  expect(portalHost.className).not.toContain("z-[100]");
  expect(portalHost.style.zIndex).toBe("var(--ktn-z-portal)");
  expect(root.style.getPropertyValue("--ktn-z-portal")).toBe("240");
});

test("Show + useEntitlementCheck support numeric remaining thresholds", async () => {
  installFetchMock();

  // The render-prop / rich-state use case (formerly EntitlementGate) is served by
  // the useEntitlementCheck hook; Show is the declarative gate.
  function GateProbe() {
    const { allowed, remaining, percentageUsed } = useEntitlementCheck("api_calls", { min: 100 });
    return (
      <div>
        {allowed
          ? "render prop allowed"
          : `render prop blocked: ${remaining} remaining, ${percentageUsed}% used`}
      </div>
    );
  }

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-1"
      polling={{ enabled: false }}
    >
      <Show
        when="entitled"
        entitlement="api_calls"
        min={100}
        fallback={<div>quota gate fallback</div>}
      >
        <div>quota gate open</div>
      </Show>
      <GateProbe />
      <Show when="entitled" entitlement="api_calls" min={100} fallback={<div>show fallback</div>}>
        <div>show open</div>
      </Show>
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("quota gate fallback")).toBeDefined();
    expect(screen.getByText("render prop blocked: 50 remaining, 95% used")).toBeDefined();
    expect(screen.getByText("show fallback")).toBeDefined();
  });
});

test("CustomerPortal sections render rich entitlement, add-on, and flag variants", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      {/* Opt FlagsSummary back in (not a default) to exercise flag variants. */}
      <CustomerPortal
        elements={["CurrentPlan", "IncludedFeatures", "UsageMeters", "AddOns", "FlagsSummary"]}
      />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  expect(screen.getByText(`Renews on ${formatKaitenDate("2026-12-31")}`)).toBeDefined();
  expect(screen.getByText("TRIAL")).toBeDefined();
  // IncludedFeatures shows the group/category subtitle ("Core"), not the constant
  // `source` ("addon - Core") which read as noise on every row.
  expect(screen.getByText("Core")).toBeDefined();
  expect(screen.getAllByText("Storage GB").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("110%")).toBeDefined();
  expect(screen.getByText("Priority support")).toBeDefined();
  expect(screen.getByText("24/7 support line")).toBeDefined();
  expect(screen.getByText("gradual-rollout")).toBeDefined();
  expect(screen.getByText("25% rollout")).toBeDefined();
});

test("CurrentPlan emits component events from action buttons", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });
  const planListener = vi.fn();
  window.addEventListener("kaiten:plan-changed", planListener as EventListener);

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      {/* The action only renders when the host owns it — see CurrentPlanProps. */}
      <CurrentPlan onUpgradeVersion={() => {}} />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Upgrade version" })).toBeDefined();
  });

  fireEvent.click(screen.getByRole("button", { name: "Upgrade version" }));

  await waitFor(() => {
    expect(planListener).toHaveBeenCalled();
  });

  window.removeEventListener("kaiten:plan-changed", planListener as EventListener);
});

test("CurrentPlan renders no action button the host has not wired", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      <CurrentPlan onAddQuota={() => {}} />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Add quota" })).toBeDefined();
  });

  // Rendering all three unconditionally shipped dead CTAs to every host that had
  // not built its billing flow yet: the click ran `await undefined`, flickered
  // aria-busy, and emitted an event nobody listened to.
  expect(screen.queryByRole("button", { name: "Upgrade version" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add add-ons" })).toBeNull();
});

test("CurrentPlan unstyled renders no action button the host has not wired", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      <CurrentPlan unstyled onAddQuota={() => {}} />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Add quota" })).toBeDefined();
  });

  // The guard was added to the styled branch only, so `unstyled` — the rendering
  // STABILITY.md points adopters at as the stable path — kept shipping the dead
  // CTAs the styled one had stopped shipping. Two renderings of one component
  // cannot disagree about which actions exist.
  expect(screen.queryByRole("button", { name: "Upgrade version" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add add-ons" })).toBeNull();
});

test("AddOns invokes onManageAddon before emitting kaiten:addon-added", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });
  const onManageAddon = vi.fn();
  const addonListener = vi.fn();
  window.addEventListener("kaiten:addon-added", addonListener as EventListener);

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      <AddOns onManageAddon={onManageAddon} />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Add" })).toBeDefined();
  });

  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() => {
    expect(onManageAddon).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "extra-seats", name: "Extra seats" }),
    );
    expect(addonListener).toHaveBeenCalled();
  });

  window.removeEventListener("kaiten:addon-added", addonListener as EventListener);
});

test("IncludedFeatures and UsageMeters support unstyled layout", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      <IncludedFeatures unstyled />
      <UsageMeters unstyled />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(document.querySelector('[data-slot="included-features"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="usage-meters"]')).toBeTruthy();
  });

  expect(screen.getByText(/SSO:/)).toBeDefined();
  expect(screen.getAllByText(/Storage GB:/).length).toBeGreaterThanOrEqual(1);
});

test("LicenseSection wrapper delegates to CurrentPlan", async () => {
  const { LicenseSection } =
    await import("../src/components/customer-portal/sections/license-section.tsx");
  installFetchMock({ snapshot: portalRichSnapshot });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      <LicenseSection />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Current plan")).toBeDefined();
  });
});

test("CurrentPlan invokes all three action callbacks and emits matching events", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });
  const planListener = vi.fn();
  const quotaListener = vi.fn();
  const addonListener = vi.fn();
  window.addEventListener("kaiten:plan-changed", planListener as EventListener);
  window.addEventListener("kaiten:quota-added", quotaListener as EventListener);
  window.addEventListener("kaiten:addon-added", addonListener as EventListener);

  const onUpgradeVersion = vi.fn();
  const onAddQuota = vi.fn();
  const onAddAddOn = vi.fn();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      <CurrentPlan
        onUpgradeVersion={onUpgradeVersion}
        onAddQuota={onAddQuota}
        onAddAddOn={onAddAddOn}
      />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Upgrade version" })).toBeDefined();
  });

  fireEvent.click(screen.getByRole("button", { name: "Upgrade version" }));
  fireEvent.click(screen.getByRole("button", { name: "Add quota" }));
  fireEvent.click(screen.getByRole("button", { name: "Add add-ons" }));

  await waitFor(() => {
    expect(onUpgradeVersion).toHaveBeenCalledTimes(1);
    expect(onAddQuota).toHaveBeenCalledTimes(1);
    expect(onAddAddOn).toHaveBeenCalledTimes(1);
    expect(planListener).toHaveBeenCalled();
    expect(quotaListener).toHaveBeenCalled();
    expect(addonListener).toHaveBeenCalled();
  });

  window.removeEventListener("kaiten:plan-changed", planListener as EventListener);
  window.removeEventListener("kaiten:quota-added", quotaListener as EventListener);
  window.removeEventListener("kaiten:addon-added", addonListener as EventListener);
});

test("CurrentPlan unstyled renders renewal date, credits and reacts to action buttons", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });
  const onUpgradeVersion = vi.fn();
  const onAddQuota = vi.fn();
  const onAddAddOn = vi.fn();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      <CurrentPlan
        unstyled
        onUpgradeVersion={onUpgradeVersion}
        onAddQuota={onAddQuota}
        onAddAddOn={onAddAddOn}
      />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(document.querySelector('[data-slot="current-plan"]')).toBeTruthy();
  });

  expect(screen.getByText("Pro License")).toBeDefined();
  expect(screen.getByText("TRIAL")).toBeDefined();
  expect(screen.getByText(`Renews on ${formatKaitenDate("2026-12-31")}`)).toBeDefined();
  expect(screen.getByText(/API credits:/)).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: "Upgrade version" }));
  fireEvent.click(screen.getByRole("button", { name: "Add quota" }));
  fireEvent.click(screen.getByRole("button", { name: "Add add-ons" }));

  await waitFor(() => {
    expect(onUpgradeVersion).toHaveBeenCalledTimes(1);
    expect(onAddQuota).toHaveBeenCalledTimes(1);
    expect(onAddAddOn).toHaveBeenCalledTimes(1);
  });
});

// The portal shows what the customer holds and never what they pay for it: the
// price lives on `Plan`, the section reads `License`. Both travel in the same
// snapshot, so the join is `license.slug → plan.slug`. Asserted on both trees —
// they are independent markup and parity is not automatic.
test("CurrentPlan renders the price of the license's plan (styled tree)", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-plan-price-styled"
      polling={{ enabled: false }}
    >
      <CurrentPlan />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(document.querySelector('[data-slot="current-plan-price"]')).toBeTruthy();
  });

  const priceLine = document.querySelector('[data-slot="current-plan-price"]');
  expect(priceLine?.textContent).toContain(formatKaitenMoney(7900, "USD"));
  expect(priceLine?.textContent).toContain("/month");
});

test("CurrentPlan renders the price of the license's plan (unstyled tree)", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-plan-price-unstyled"
      polling={{ enabled: false }}
    >
      <CurrentPlan unstyled />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(document.querySelector('[data-slot="current-plan-price"]')).toBeTruthy();
  });

  const priceLine = document.querySelector('[data-slot="current-plan-price"]');
  expect(priceLine?.textContent).toContain(formatKaitenMoney(7900, "USD"));
  expect(priceLine?.textContent).toContain("/month");
});

// The normal case today: Kaiten models no prices server-side, so the joined plan
// carries no amount. Nothing is rendered — no zero, no placeholder. An invented
// amount on a billing screen is worse than an absent line.
test("CurrentPlan renders no price line when the plan carries no amount", async () => {
  const priceless: LicensingSnapshot = {
    ...portalRichSnapshot,
    plans: [{ slug: "pro", name: "Pro" }],
  };

  for (const [customerId, unstyled] of [
    ["cust-plan-priceless-styled", false],
    ["cust-plan-priceless-unstyled", true],
  ] as const) {
    installFetchMock({ snapshot: priceless });

    render(
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_demo"
        customerId={customerId}
        polling={{ enabled: false }}
      >
        <CurrentPlan unstyled={unstyled} />
      </KaitenProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Pro License")).toBeDefined();
    });
    expect(document.querySelector('[data-slot="current-plan-price"]')).toBeNull();

    cleanup();
  }
});

test("CurrentPlan shows the loading skeleton before snapshot resolves", () => {
  installFetchMock({ snapshot: portalRichSnapshot });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-current-plan-loading"
      polling={{ enabled: false }}
    >
      <CurrentPlan />
    </KaitenProvider>,
  );

  expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
});

test("FlagsSummary supports unstyled layout for snapshot flags", async () => {
  installFetchMock({ snapshot: portalRichSnapshot });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={CUSTOMER_PORTAL_RICH}
      polling={{ enabled: false }}
    >
      <FlagsSummary unstyled />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(document.querySelector('[data-slot="flags-summary"]')).toBeTruthy();
  });

  expect(screen.getByText(/gradual-rollout:/)).toBeDefined();
});

// ---------------------------------------------------------------------------
// 4.54 Entitlement presentation (userFacing filter + unit labels)
// ---------------------------------------------------------------------------

test("IncludedFeatures hides userFacing=false counters and shows unit labels", async () => {
  installFetchMock({
    snapshot: {
      ...baseSnapshot,
      entitlements: [
        {
          id: "ent-seats",
          slug: "seats",
          name: "Seats",
          type: "NUMBER",
          source: "license",
          limitValue: { type: "number", value: 120 },
          currentValue: { type: "number", value: 68 },
          status: "enabled",
          unitSingular: "seat",
          unitPlural: "seats",
          userFacing: true,
          displayOrder: 10,
        },
        {
          id: "ent-internal",
          slug: "seats-read",
          name: "Seats Read",
          type: "NUMBER",
          source: "license",
          limitValue: { type: "number", value: 1000 },
          currentValue: { type: "number", value: 3 },
          status: "enabled",
          userFacing: false,
        },
      ],
    },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-presentation"
      polling={{ enabled: false }}
    >
      <IncludedFeatures />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getAllByText("Seats").length).toBeGreaterThan(0);
  });
  // Unit label rides the limit cell ("120 seats"); internal counter is hidden.
  expect(screen.getAllByText(/120\s+seats/).length).toBeGreaterThan(0);
  expect(screen.queryByText("Seats Read")).toBeNull();
});

test("UsageMeters appends the unit label and hides internal counters", async () => {
  installFetchMock({
    snapshot: {
      ...baseSnapshot,
      entitlements: [
        {
          id: "ent-seats",
          slug: "seats",
          name: "Seats",
          type: "NUMBER",
          source: "license",
          limitValue: { type: "number", value: 120 },
          currentValue: { type: "number", value: 68 },
          status: "enabled",
          unitSingular: "seat",
          unitPlural: "seats",
          userFacing: true,
        },
        {
          id: "ent-internal",
          slug: "seats-read",
          name: "Seats Read",
          type: "NUMBER",
          source: "license",
          limitValue: { type: "number", value: 1000 },
          currentValue: { type: "number", value: 3 },
          status: "enabled",
          userFacing: false,
        },
      ],
    },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-presentation-meters"
      polling={{ enabled: false }}
    >
      <UsageMeters />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Seats")).toBeDefined();
  });
  expect(screen.getByText(/68 \/ 120 seats/)).toBeDefined();
  expect(screen.queryByText("Seats Read")).toBeNull();
});

test("UsageMeters trusts the server unlimited flag over the raw sentinel", async () => {
  installFetchMock({
    snapshot: {
      ...baseSnapshot,
      entitlements: [
        // True unlimited grant (server flag): no finite cap, so no meter.
        {
          id: "ent-api",
          slug: "api-calls",
          name: "API calls",
          type: "NUMBER",
          source: "license",
          limitValue: { type: "number", value: -1 },
          currentValue: { type: "number", value: 4200 },
          status: "enabled",
          unlimited: true,
          userFacing: true,
        },
        // Negative-but-enforced grant (unlimited: false — only the exact
        // sentinel disables the cap server-side): must stay a metered quota,
        // where the legacy value-sign heuristic would have collapsed it.
        {
          id: "ent-weird",
          slug: "legacy-cap",
          name: "Legacy cap",
          type: "NUMBER",
          source: "license",
          limitValue: { type: "number", value: -5 },
          currentValue: { type: "number", value: 0 },
          status: "over_limit",
          unlimited: false,
          userFacing: true,
        },
      ],
    },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-unlimited-flag"
      polling={{ enabled: false }}
    >
      <UsageMeters />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Legacy cap")).toBeDefined();
  });
  expect(screen.queryByText("API calls")).toBeNull();
});

// ---------------------------------------------------------------------------
// 4.55 New primitives + report-usage
// ---------------------------------------------------------------------------

test("PlanBadge renders the current plan name", async () => {
  installFetchMock();
  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-1"
      polling={{ enabled: false }}
    >
      <PlanBadge />
    </KaitenProvider>,
  );
  await waitFor(() => {
    expect(screen.getByText("Pro License")).toBeDefined();
  });
});

test("UpgradeButton emits the plan-changed intent and calls onUpgrade", async () => {
  installFetchMock();
  const onUpgrade = vi.fn();
  const onIntent = vi.fn();
  window.addEventListener("kaiten:plan-changed", onIntent as EventListener);

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-1"
      polling={{ enabled: false }}
    >
      <UpgradeButton onUpgrade={onUpgrade} label="Upgrade now" />
    </KaitenProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Upgrade now" }));
  expect(onUpgrade).toHaveBeenCalledTimes(1);
  expect(onIntent).toHaveBeenCalledTimes(1);
  window.removeEventListener("kaiten:plan-changed", onIntent as EventListener);
});

test("useReportUsage posts to the resolved instance slug (authenticated)", async () => {
  installFetchMock({
    snapshot: {
      ...baseSnapshot,
      instance: { slug: "inst-1" } as LicensingSnapshot["instance"],
    },
  });

  function ReportProbe() {
    const report = useReportUsage();
    const license = useLicense();
    return (
      <>
        <span>{license.data?.name ?? "loading"}</span>
        <button
          type="button"
          onClick={() =>
            void report.mutateAsync({
              entitlementSlug: "api_calls",
              input: { value: { type: "number", value: 5 }, behavior: "append" },
            })
          }
        >
          report
        </button>
      </>
    );
  }

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-report"
      polling={{ enabled: false }}
    >
      <ReportProbe />
    </KaitenProvider>,
  );

  // Wait for the snapshot (so the instance slug resolves) before reporting.
  await waitFor(() => expect(screen.getByText("Pro License")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "report" }));
  await waitFor(() => {
    expect(kaitenClientMock.reportUsage).toHaveBeenCalledWith(
      "inst-1",
      "api_calls",
      expect.objectContaining({ behavior: "append" }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4.6 i18n — plurals
// ---------------------------------------------------------------------------

test("pluralize selects correct form for English singular and plural", () => {
  expect(pluralize(1, { one: "1 period", other: "{n} periods" })).toBe("1 period");
  expect(pluralize(0, { one: "1 period", other: "{n} periods" })).toBe("0 periods");
  expect(pluralize(5, { one: "1 period", other: "{n} periods" })).toBe("5 periods");
});

test("pluralize falls back to other when a plural category is missing", () => {
  // Arabic has 6 plural forms; if only other is supplied every count falls back to it.
  expect(pluralize(1, { other: "{n} شيء" }, "ar")).toBe("1 شيء");
  expect(pluralize(11, { other: "{n} شيء" }, "ar")).toBe("11 شيء");
});

test("pluralize uses all supplied Arabic plural forms", () => {
  const forms = {
    zero: "لا شيء",
    one: "شيء واحد",
    two: "شيئان",
    few: "{n} أشياء",
    many: "{n} شيئًا",
    other: "{n} شيء",
  };
  // Arabic: 0 → zero, 1 → one, 2 → two, 3-10 → few, 11-99 → many
  expect(pluralize(0, forms, "ar")).toBe("لا شيء");
  expect(pluralize(1, forms, "ar")).toBe("شيء واحد");
  expect(pluralize(2, forms, "ar")).toBe("شيئان");
  expect(pluralize(5, forms, "ar")).toBe("5 أشياء");
  expect(pluralize(15, forms, "ar")).toBe("15 شيئًا");
});

// ---------------------------------------------------------------------------
// 5. Tests — couverture étendue : edge cases, fuzz API, SSR/hydration
// ---------------------------------------------------------------------------

// ===========================================================================
// 5.1 PricingTable — edge cases
// ===========================================================================

function makePlan(overrides: Partial<Plan> & { slug: string; name: string }): Plan {
  return {
    id: overrides.slug,
    price: 0,
    currencyCode: "USD",
    interval: "month",
    features: [],
    ...overrides,
  };
}

test("PricingTable renders a single plan without crashing or showing the annual toggle", () => {
  installFetchMock();

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={[basePlan]} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  expect(screen.getByText("Pro")).toBeDefined();
  // Exactly one pricing card rendered for a single plan
  expect(document.querySelectorAll('[data-slot="card"]').length).toBe(1);

  // Switch to a monthly-only plan to verify the toggle goes away.
  cleanup();
  vi.unstubAllGlobals();
  installFetchMock();

  const monthlyOnly = makePlan({
    slug: "solo",
    name: "Solo",
    price: 9,
    interval: "month",
    features: ["1 seat"],
  });

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={[monthlyOnly]} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  expect(screen.queryByRole("radiogroup", { name: /billing interval/i })).toBeNull();
});

// `published: false` is what `planFromLicense` produces for a license that is not
// `PUBLISHED` — a draft, or an archived version. Before this filter
// the pricing table rendered them, i.e. an adopter wiring the SDK published its
// own internal licenses on a public page. Both render trees are asserted: the
// filter is shared, but they are independent markup and parity is not automatic.
test("PricingTable hides plans marked published: false (styled tree)", () => {
  installFetchMock();

  const plans: Plan[] = [
    makePlan({ slug: "pro", name: "Pro", price: 7900 }),
    makePlan({ slug: "internal", name: "Internal QA", price: 0, published: false }),
  ];

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={plans} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  expect(screen.getByText("Pro")).toBeDefined();
  expect(screen.queryByText("Internal QA")).toBeNull();
  expect(document.querySelectorAll('[data-slot="card"]').length).toBe(1);
});

test("PricingTable hides plans marked published: false (unstyled tree)", () => {
  installFetchMock();

  const plans: Plan[] = [
    makePlan({ slug: "pro", name: "Pro", price: 7900 }),
    makePlan({ slug: "internal", name: "Internal QA", price: 0, published: false }),
  ];

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={plans} showFeatureComparison={false} unstyled />
    </KaitenProvider>,
  );

  expect(screen.getByText("Pro")).toBeDefined();
  expect(screen.queryByText("Internal QA")).toBeNull();
  expect(document.querySelectorAll('[data-slot="pricing-table"] article').length).toBe(1);
});

// The filter must be `!== false`, not a truthiness test: host-supplied plans and
// the REST read path leave `published` undefined, and treating that as "not
// published" would empty the table outright.
test("PricingTable keeps plans whose published flag is absent", () => {
  installFetchMock();

  const plans: Plan[] = [
    makePlan({ slug: "pro", name: "Pro", price: 7900 }),
    makePlan({ slug: "starter", name: "Starter", price: 900, published: true }),
  ];

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={plans} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  expect(screen.getByText("Pro")).toBeDefined();
  expect(screen.getByText("Starter")).toBeDefined();
});

// The real-world path: no `plans` prop, the catalog comes from the client. This
// is the case the adopter actually hits, and the one the prop-driven tests above
// cannot prove. A dedicated publishable key keeps this scope out of the shared
// SWR catalog cache.
test("PricingTable hides unpublished plans arriving from the catalog", async () => {
  installFetchMock({
    catalog: {
      plans: [
        makePlan({ slug: "pro", name: "Pro", price: 7900 }),
        makePlan({ slug: "internal", name: "Internal QA", price: 0, published: false }),
      ],
      branding: { removable: false },
    },
  });

  render(
    <KaitenProvider mode="public" publishableKey="pk_published_filter" polling={{ enabled: false }}>
      <PricingTable showFeatureComparison={false} />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Pro")).toBeDefined();
  });
  expect(screen.queryByText("Internal QA")).toBeNull();
});

test("PricingTable renders 5+ plans across the chosen number of columns", () => {
  installFetchMock();

  const plans: Plan[] = Array.from({ length: 6 }).map((_, idx) =>
    makePlan({
      slug: `plan-${idx}`,
      name: `Plan ${idx}`,
      price: 10 * (idx + 1),
      features: [`Feature for plan ${idx}`],
    }),
  );

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={plans} numberOfColumns={4} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  for (const plan of plans) {
    expect(screen.getByText(plan.name)).toBeDefined();
  }

  // One card per plan
  expect(document.querySelectorAll('[data-slot="card"]').length).toBe(plans.length);

  // The grid caps at the requested column count without a viewport breakpoint.
  //
  // `numberOfColumns` used to pick a pair of media-query classes; it now picks the
  // divisor in an `auto-fit` track floor, so the count follows the component's own
  // box instead of the browser window (see `resolveColumns`). Asserted on those two
  // properties rather than on the whole class string: the exact arbitrary value is an
  // implementation detail that should be free to change, but "caps at four" and
  // "reads no viewport" are the contract.
  const grid = document.querySelector('[data-slot="pricing-table"] > .grid') as HTMLElement;
  expect(grid?.className).toContain("repeat(auto-fit,");
  expect(grid?.className).toContain("/4)");
  expect(grid?.className).not.toMatch(/\b(sm|md|lg|xl|2xl):/);
});

test("PricingTable handles very long feature labels without throwing", () => {
  installFetchMock();

  const longFeature =
    "Unlimited concurrent API calls with adaptive rate limiting, regional failover, and per-tenant audit log retention for compliance-grade workloads (SOC2, HIPAA, ISO 27001).";

  const plan = makePlan({
    slug: "growth",
    name: "Growth",
    price: 199,
    features: [longFeature, "Standard SLA"],
  });

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={[plan]} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  expect(screen.getByText(longFeature)).toBeDefined();
});

test("PricingTable renders without amounts when prices are missing (no NaN, no undefined leak)", () => {
  installFetchMock();

  const plan: Plan = {
    slug: "free",
    name: "Free",
    features: ["Basic support"],
  };

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={[plan]} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  const body = document.body.textContent ?? "";
  expect(body).not.toContain("undefined");
  expect(body).not.toContain("NaN");
  // A plan with no amount shows the localized "Custom" label — NOT a silent,
  // misleading "$0.00" (which used to be published on real public pricing pages).
  expect(body).toContain(defaultLocalization.pricingTable.customPrice);
  expect(body).not.toContain(formatKaitenMoney(0, "USD"));
});

test("PricingTable preserves per-plan currency when mixing currencies across plans", () => {
  installFetchMock();

  const plans: Plan[] = [
    makePlan({ slug: "usd", name: "USD plan", price: 4900, currencyCode: "USD" }),
    makePlan({ slug: "eur", name: "EUR plan", price: 4500, currencyCode: "EUR" }),
    makePlan({ slug: "gbp", name: "GBP plan", price: 3900, currencyCode: "GBP" }),
  ];

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={plans} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  const body = document.body.textContent ?? "";
  expect(body).toContain(formatKaitenMoney(4900, "USD"));
  expect(body).toContain(formatKaitenMoney(4500, "EUR"));
  expect(body).toContain(formatKaitenMoney(3900, "GBP"));
});

test("PricingTable annual toggle is hidden when no plan exposes an annual price", () => {
  installFetchMock();

  const plan = makePlan({
    slug: "monthly-only",
    name: "Monthly only",
    price: 12,
    interval: "month",
  });

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={[plan]} showAnnualToggle />
    </KaitenProvider>,
  );

  expect(screen.queryByRole("radio", { name: defaultLocalization.pricingTable.annual })).toBeNull();
});

test("PricingTable annual toggle switches the displayed price using prices[]", () => {
  installFetchMock();

  const plan: Plan = {
    slug: "scale",
    name: "Scale",
    currencyCode: "USD",
    interval: "month",
    prices: [
      { amount: 10000, interval: "month", label: "month" },
      { amount: 100000, interval: "year", label: "year" },
    ],
    features: [],
  };

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={[plan]} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  // Default month
  expect(document.body.textContent ?? "").toContain(formatKaitenMoney(10000, "USD"));
  fireEvent.click(screen.getByRole("radio", { name: defaultLocalization.pricingTable.annual }));
  expect(document.body.textContent ?? "").toContain(formatKaitenMoney(100000, "USD"));
});

// ===========================================================================
// 5.2 FeatureComparison — edge cases
// ===========================================================================

test("FeatureComparison renders a header column per plan even with many plans", () => {
  installFetchMock();

  const plans: Plan[] = Array.from({ length: 7 }).map((_, idx) =>
    makePlan({
      slug: `plan-${idx}`,
      name: `Plan ${idx}`,
      features: [`Feature ${idx}`, "Shared feature"],
    }),
  );

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <FeatureComparison plans={plans} />
    </KaitenProvider>,
  );

  const headers = document.querySelectorAll('[data-slot="feature-comparison"] thead th');
  // 1 "Feature" column + one per plan
  expect(headers.length).toBe(plans.length + 1);
});

test("FeatureComparison names its icon-only cells", () => {
  installFetchMock();

  // Two plans that differ on one feature, so the table renders both an
  // "included" cell and an "unavailable" one for the same row.
  const plans: Plan[] = [
    makePlan({ slug: "starter", name: "Starter", features: ["Audit log"] }),
    makePlan({ slug: "pro", name: "Pro", features: ["Audit log", "SSO"] }),
  ];

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <FeatureComparison plans={plans} />
    </KaitenProvider>,
  );

  // The regression this guards: a bare <svg> has no accessible name, so both
  // cells read as empty and the row is identical whether the feature is in the
  // plan or not — in the one component whose whole purpose is comparison.
  const cells = document.querySelectorAll('[data-slot="feature-comparison"] tbody [role="img"]');
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    expect(cell.getAttribute("aria-label")?.trim()).toBeTruthy();
  }

  // The name is the same string the unstyled rendering prints, so the two
  // renderings cannot drift apart.
  for (const cell of cells) {
    expect(cell.getAttribute("aria-label")).toBe("Included");
  }
});

test("FeatureComparison keeps the first column sticky on horizontal scroll layouts", () => {
  installFetchMock();

  const plans: Plan[] = Array.from({ length: 5 }).map((_, idx) =>
    makePlan({
      slug: `plan-${idx}`,
      name: `Plan ${idx}`,
      features: ["Shared"],
    }),
  );

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <FeatureComparison plans={plans} />
    </KaitenProvider>,
  );

  const firstHeader = document.querySelector(
    '[data-slot="feature-comparison"] thead th:first-child',
  ) as HTMLElement;
  const firstBodyCell = document.querySelector(
    '[data-slot="feature-comparison"] tbody td:first-child',
  ) as HTMLElement;

  expect(firstHeader.className).toContain("sticky");
  expect(firstHeader.className).toContain("left-0");
  expect(firstBodyCell.className).toContain("sticky");
  expect(firstBodyCell.className).toContain("left-0");

  // Horizontally scrollable wrapper enables the sticky behaviour to be useful
  const scrollWrapper = document.querySelector('[data-slot="feature-comparison"] .overflow-x-auto');
  expect(scrollWrapper).toBeTruthy();
});

test("FeatureComparison returns null when no plans are provided", () => {
  installFetchMock();

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <FeatureComparison plans={[]} />
    </KaitenProvider>,
  );

  expect(document.querySelector('[data-slot="feature-comparison"]')).toBeNull();
});

// ===========================================================================
// 5.3 Fuzz API — /snapshot null, entitlements undefined, types invalides
// ===========================================================================

// Under Option A the client always hands components a well-formed snapshot
// (it builds it from typed endpoints). We emulate that guarantee here: normalize
// the (possibly degenerate) payload into a valid snapshot, then feed the mock.
function installFuzzyFetch(snapshotPayload: unknown) {
  const wrapped = snapshotPayload as { snapshot?: unknown } | null;
  const raw = (
    wrapped && typeof wrapped === "object" && "snapshot" in wrapped
      ? wrapped.snapshot
      : snapshotPayload
  ) as Record<string, unknown> | null;
  const get = (key: string) => (raw && typeof raw === "object" ? raw[key] : undefined);
  const arr = (key: string) => {
    const value = get(key);
    return Array.isArray(value) ? value : [];
  };

  const snapshot: LicensingSnapshot = {
    source: "snapshot",
    customer: (get("customer") as LicensingSnapshot["customer"]) ?? null,
    instance: (get("instance") as LicensingSnapshot["instance"]) ?? null,
    license: (get("license") as LicensingSnapshot["license"]) ?? null,
    plans: arr("plans") as LicensingSnapshot["plans"],
    addOns: arr("addOns") as LicensingSnapshot["addOns"],
    credits: arr("credits") as LicensingSnapshot["credits"],
    entitlements: arr("entitlements") as LicensingSnapshot["entitlements"],
    flags: arr("flags") as LicensingSnapshot["flags"],
    actions: (arr("actions").length
      ? arr("actions")
      : [
          { type: "upgrade_plan", label: "Upgrade version", eventName: "kaiten:plan-changed" },
        ]) as LicensingSnapshot["actions"],
    capabilities: (get("capabilities") as LicensingSnapshot["capabilities"]) ?? {
      paymentMethods: false,
      invoices: false,
      unsubscribe: false,
      checkout: false,
    },
    branding: (get("branding") as LicensingSnapshot["branding"]) ?? { removable: false },
  };

  kaitenClientMock.state.snapshot = snapshot;
  kaitenClientMock.state.catalog = { plans: [], branding: { removable: false } };
}

test("client normalizes a snapshot returned as a completely empty object", async () => {
  installFuzzyFetch({});

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-fuzz-empty"
      polling={{ enabled: false }}
    >
      <CustomerPortal />
    </KaitenProvider>,
  );

  await waitFor(
    () => {
      expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    },
    { timeout: 3000 },
  );

  // Should NOT throw; sections gracefully render their empty states.
  expect(document.body.textContent ?? "").not.toContain("undefined");
});

test("client normalizes a snapshot with explicitly null collections", async () => {
  installFuzzyFetch({
    source: "snapshot",
    customer: null,
    instance: null,
    license: null,
    plans: null,
    addOns: null,
    credits: null,
    entitlements: null,
    flags: null,
    actions: null,
    capabilities: null,
    branding: null,
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-fuzz-null"
      polling={{ enabled: false }}
    >
      <Show when="entitled" entitlement="api_calls" fallback={<div>blocked</div>}>
        <div>allowed</div>
      </Show>
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("blocked")).toBeDefined();
  });
});

test("client normalizes a snapshot wrapped in a top-level { snapshot: ... } envelope", async () => {
  installFuzzyFetch({
    snapshot: {
      source: "snapshot",
      license: baseSnapshot.license,
      plans: [basePlan],
      addOns: [],
      credits: [],
      entitlements: baseSnapshot.entitlements,
      flags: baseSnapshot.flags,
      actions: baseSnapshot.actions,
      capabilities: baseSnapshot.capabilities,
      branding: { removable: false },
    },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-fuzz-envelope"
      polling={{ enabled: false }}
    >
      <LicenseProbe />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Pro License")).toBeDefined();
  });
});

test("client survives plans returned with the wrong type (string instead of array)", async () => {
  // Wire format pollution: backend returns `plans: "oops"` instead of an array
  installFuzzyFetch({
    source: "snapshot",
    license: baseSnapshot.license,
    plans: "oops",
    entitlements: baseSnapshot.entitlements,
    flags: [],
    addOns: [],
    credits: [],
    actions: [],
    capabilities: baseSnapshot.capabilities,
    branding: { removable: false },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-fuzz-types"
      polling={{ enabled: false }}
    >
      <LicenseProbe />
    </KaitenProvider>,
  );

  // Should not throw — license still resolves from the rest of the snapshot.
  await waitFor(() => {
    expect(screen.getByText("Pro License")).toBeDefined();
  });
});

test("client falls back to default actions when snapshot.actions is missing", async () => {
  installFuzzyFetch({
    source: "snapshot",
    license: baseSnapshot.license,
    plans: [basePlan],
    entitlements: baseSnapshot.entitlements,
    flags: [],
    addOns: [],
    credits: [],
    capabilities: baseSnapshot.capabilities,
    branding: { removable: false },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-fuzz-actions"
      polling={{ enabled: false }}
    >
      <CurrentPlan onUpgradeVersion={() => {}} />
    </KaitenProvider>,
  );

  // Default actions include "Upgrade version" — see client.defaultActions().
  // The handler is what makes the button render at all; the point here is that
  // the snapshot still resolves without an `actions` array.
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Upgrade version" })).toBeDefined();
  });
});

test("hooks survive snapshot returning missing entitlements without throwing", async () => {
  installFuzzyFetch({
    source: "snapshot",
    license: baseSnapshot.license,
    plans: [basePlan],
    // entitlements omitted entirely — client must default to [] so downstream
    // `entitlements.map(...)` calls do not throw on null.
    flags: [],
    addOns: [],
    credits: [],
    actions: [],
    capabilities: baseSnapshot.capabilities,
    branding: { removable: false },
  });

  const { useUsage } = await import("@kaitencloud/react");

  function UsageProbe() {
    const usage = useUsage();
    const data = usage.data;
    const count = Array.isArray(data) ? data.length : 0;
    return <div>usage:{count}</div>;
  }

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-fuzz-usage"
      polling={{ enabled: false }}
    >
      <UsageProbe />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("usage:0")).toBeDefined();
  });
});

// ===========================================================================
// 5.4 SSR / hydration
// ===========================================================================

// The "no React warnings during SSR" test lives in `tests/ssr.test.tsx`, which runs
// in a node environment. Asserting on SSR warnings under jsdom is not meaningful:
// `window` exists there, so SWR picks `useLayoutEffect` and React 18 warns about it
// during `renderToString` — a warning a real SSR runtime never emits.

test("PricingTable SSR output already contains plan content (no flash of empty state)", async () => {
  const { renderToString } = await import("react-dom/server");

  const html = renderToString(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={[basePlan]} showFeatureComparison={false} />
    </KaitenProvider>,
  );

  expect(html).toContain("Pro");
  // React inserts <!-- --> between sibling text nodes during SSR; strip them
  // before matching the rendered price.
  const stripped = html.replace(/<!---->|<!-- -->/g, "");
  expect(stripped).toContain(formatKaitenMoney(7900, "USD"));
  expect(stripped).toContain("/month");
  expect(html).not.toContain('data-slot="skeleton"');
});

test("Server-rendered markup hydrates without a content mismatch warning", async () => {
  installFetchMock();
  const { renderToString } = await import("react-dom/server");
  const { hydrateRoot } = await import("react-dom/client");

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const tree = (
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <PricingTable plans={[basePlan]} showFeatureComparison={false} />
    </KaitenProvider>
  );

  const container = document.createElement("div");
  container.innerHTML = renderToString(tree);
  document.body.appendChild(container);

  const root = hydrateRoot(container, tree);

  await waitFor(() => {
    expect(container.textContent ?? "").toContain("Pro");
  });

  // No React hydration mismatch should be reported.
  //
  // Match React's actual mismatch wording rather than a bare /hydrat/: React 18's
  // `useLayoutEffect`-on-the-server advisory (emitted here because jsdom makes SWR
  // take the browser branch) contains the words "non-hydrated UI" and was being
  // reported as a mismatch it is not.
  const hydrationMismatch = errorSpy.mock.calls.find((call) =>
    String(call[0] ?? "").match(
      /did not match|hydration failed|hydration mismatch|error occurred during hydration|Text content/i,
    ),
  );
  expect(hydrationMismatch).toBeUndefined();

  // Likewise no warning about server/client divergence
  const hydrationWarn = warnSpy.mock.calls.find((call) =>
    String(call[0] ?? "").match(/hydrat|did not match/i),
  );
  expect(hydrationWarn).toBeUndefined();

  root.unmount();
  container.remove();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

// ===========================================================================
// Fail-closed gating policy (`onError`)
//
// On a snapshot/flag data error, gating primitives must default to fail-CLOSED
// (never reveal gated/paid content) and accept `onError="allow"` to opt back
// into fail-open. Before the fail policy, EntitlementGate/Show fail-closed but Paywall
// fail-open — opposite decisions during one outage.
// ===========================================================================

function renderWithFailingSnapshot(ui: Parameters<typeof render>[0], customerId: string) {
  installFetchMock();
  // First (deduped) snapshot fetch for this fresh SWR key rejects → error state.
  kaitenClientMock.getLicensingSnapshot.mockRejectedValueOnce(new Error("backend down"));
  return render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={customerId}
      polling={{ enabled: false }}
    >
      {ui}
    </KaitenProvider>,
  );
}

// The provider sets `shouldRetryOnError: false` on purpose — an outage should
// not turn every mounted gate into a retry loop against an API already
// struggling. The cost was that nothing retried at all: a dead-end failure
// screen whose only escape was reloading the page.
test("KaitenFailed hands the host a retry that actually recovers", async () => {
  renderWithFailingSnapshot(
    <KaitenFailed>
      {({ retry, error }) => (
        <div>
          <span>failed: {error.message}</span>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    </KaitenFailed>,
    "cust-failed-retry",
  );

  await waitFor(() => expect(screen.getByText("failed: backend down")).toBeDefined());

  // Only the first snapshot read rejects, so a retry is the difference between
  // a dead end and a recovered screen.
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  await waitFor(() => expect(screen.queryByRole("button", { name: "Try again" })).toBeNull());
});

// Blessed-path surface: every existing `<KaitenFailed><Banner /></KaitenFailed>`
// has to keep working untouched.
test("KaitenFailed still accepts plain children", async () => {
  renderWithFailingSnapshot(
    <KaitenFailed>
      <div>something went wrong</div>
    </KaitenFailed>,
    "cust-failed-static",
  );

  await waitFor(() => expect(screen.getByText("something went wrong")).toBeDefined());
});

test("KaitenFailed renders nothing while the data is healthy", async () => {
  installFetchMock();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-failed-healthy"
      polling={{ enabled: false }}
    >
      <KaitenFailed>{() => <div>should not appear</div>}</KaitenFailed>
    </KaitenProvider>,
  );

  await waitFor(() => expect(kaitenClientMock.getLicensingSnapshot).toHaveBeenCalled());
  expect(screen.queryByText("should not appear")).toBeNull();
});

test("Show (when=entitled) fails closed by default on a snapshot error (hides gated content)", async () => {
  renderWithFailingSnapshot(
    <Show when="entitled" entitlement="api_calls" fallback={<div>locked</div>}>
      <div>secret</div>
    </Show>,
    "cust-r05-gate-block",
  );

  await waitFor(() => expect(screen.getByText("locked")).toBeDefined());
  expect(screen.queryByText("secret")).toBeNull();
});

test('Show onError="allow" reveals gated content on a snapshot error', async () => {
  renderWithFailingSnapshot(
    <Show when="entitled" entitlement="api_calls" fallback={<div>locked</div>} onError="allow">
      <div>secret</div>
    </Show>,
    "cust-r05-gate-allow",
  );

  await waitFor(() => expect(screen.getByText("secret")).toBeDefined());
  expect(screen.queryByText("locked")).toBeNull();
});

test("Paywall fails closed by default on a snapshot error (shows the wall)", async () => {
  renderWithFailingSnapshot(
    <Paywall entitlement="api_calls">
      <div>paid content</div>
    </Paywall>,
    "cust-r05-paywall-block",
  );

  // A distinct error message (not a usage/limit message) blocks the content.
  await waitFor(() =>
    expect(screen.getByText(defaultLocalization.paywall.errorDescription)).toBeDefined(),
  );
});

// The fail policy covered the *error* window. The loading window was the hole: Paywall
// rendered `children` outright until access resolved, so the protected content
// was in the DOM on every first mount — and on every remount the provider does
// when its scope key changes.
test("Paywall does not reveal protected content while access is still loading", async () => {
  installFetchMock();
  let releaseSnapshot: (snapshot: unknown) => void = () => {};
  kaitenClientMock.getLicensingSnapshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseSnapshot = resolve;
      }),
  );

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-paywall-loading"
      polling={{ enabled: false }}
    >
      <Paywall entitlement="api_calls" loading={<div>checking access</div>}>
        <div>paid content</div>
      </Paywall>
    </KaitenProvider>,
  );

  await waitFor(() => expect(screen.getByText("checking access")).toBeDefined());
  expect(screen.queryByText("paid content")).toBeNull();

  // Once access resolves and the entitlement allows it, the content appears.
  await act(async () => {
    releaseSnapshot(baseSnapshot);
  });
  await waitFor(() => expect(screen.getByText("paid content")).toBeDefined());
});

test('Paywall onError="allow" reveals content while access is loading', async () => {
  installFetchMock();
  kaitenClientMock.getLicensingSnapshot.mockImplementationOnce(() => new Promise(() => {}));

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-paywall-loading-allow"
      polling={{ enabled: false }}
    >
      <Paywall entitlement="api_calls" onError="allow">
        <div>paid content</div>
      </Paywall>
    </KaitenProvider>,
  );

  await waitFor(() => expect(screen.getByText("paid content")).toBeDefined());
});

test('Paywall onError="allow" reveals content on a snapshot error (no wall)', async () => {
  renderWithFailingSnapshot(
    <Paywall entitlement="api_calls" onError="allow">
      <div>paid content</div>
    </Paywall>,
    "cust-r05-paywall-allow",
  );

  await waitFor(() => expect(screen.getByText("paid content")).toBeDefined());
  expect(screen.queryByText(defaultLocalization.paywall.errorDescription)).toBeNull();
});

test('Show when="not-entitled" fails closed on a snapshot error (does not leak content)', async () => {
  // Regression: previously `!allowed` on error revealed the not-entitled branch.
  renderWithFailingSnapshot(
    <Show when="not-entitled" entitlement="api_calls" fallback={<div>fallback</div>}>
      <div>upsell</div>
    </Show>,
    "cust-r05-show-block",
  );

  await waitFor(() => expect(screen.getByText("fallback")).toBeDefined());
  expect(screen.queryByText("upsell")).toBeNull();
});

// ===========================================================================
// Re-render hygiene: the data context value must be referentially
// stable across provider re-renders when the underlying data hasn't changed,
// so consumers don't re-render on every poll tick / unrelated host re-render.
// ===========================================================================

test("data context value is referentially stable across re-renders", async () => {
  installFetchMock();

  const seen: Array<ReturnType<typeof useKaitenDataContext>> = [];

  function Probe() {
    seen.push(useKaitenDataContext());
    return null;
  }

  function Harness() {
    const [, bump] = useReducer((x: number) => x + 1, 0);
    return (
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_demo"
        customerId="cust-r06-stable"
        polling={{ enabled: false }}
      >
        <button type="button" onClick={bump}>
          bump
        </button>
        <Probe />
      </KaitenProvider>
    );
  }

  render(<Harness />);

  // Wait until the snapshot has loaded (data settled).
  await waitFor(() => expect(seen.at(-1)?.isLoaded).toBe(true));
  const stable = seen.at(-1);

  // Force two unrelated host re-renders of the provider subtree. Data hasn't
  // changed, so the context value must keep the same identity (before the fix, the
  // inline toQueryResult wrappers produced a new object every render).
  fireEvent.click(screen.getByText("bump"));
  fireEvent.click(screen.getByText("bump"));

  expect(seen.length).toBeGreaterThan(1);
  expect(seen.at(-1)).toBe(stable);
});

test("FeatureComparison renders 'included' (not a fabricated 0) for a valueless number entitlement", () => {
  installFetchMock();

  const plan = makePlan({
    slug: "pro",
    name: "Pro",
    // A number entitlement listed on the plan but with no explicit cap — the
    // feature IS included; it must not render as "0".
    entitlements: [{ slug: "api_calls", name: "API calls", type: "number", category: "Quota" }],
  });

  render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      {/* unstyled renders the value as text (styled mode shows a ✓ icon for "included") */}
      <FeatureComparison plans={[plan]} unstyled />
    </KaitenProvider>,
  );

  expect(screen.getByText(defaultLocalization.featureComparison.included)).toBeDefined();
  const cells = [...document.querySelectorAll('[data-slot="feature-comparison"] tbody td')];
  expect(cells.some((c) => c.textContent?.trim() === "0")).toBe(false);
});

test("Paywall marks masked content inert and drops the wrong role=status", async () => {
  // Force the wall via the fail-closed error path (deterministic) and check the
  // masked content can't be tabbed into and the panel isn't a live status.
  renderWithFailingSnapshot(
    <Paywall entitlement="api_calls">
      <button type="button">hidden action</button>
    </Paywall>,
    "cust-r11-inert",
  );

  await waitFor(() =>
    expect(screen.getByText(defaultLocalization.paywall.errorDescription)).toBeDefined(),
  );

  // The masked content lives inside an `inert` subtree (not focusable / hidden from AT).
  expect(screen.getByText("hidden action").closest("[inert]")).not.toBeNull();
  // The blocking panel must not be a `role="status"` live region.
  expect(document.querySelector('[data-slot="paywall"] [role="status"]')).toBeNull();
  expect(document.querySelector('[data-slot="paywall"] [role="group"]')).not.toBeNull();
});

test("KaitenErrorBoundary shows a localized fallback (no raw leak) and recovers via resetKeys", () => {
  let shouldThrow = true;
  function Boom() {
    if (shouldThrow) throw new Error("SECRET internal server detail 500");
    return <div>recovered</div>;
  }
  function Harness({ k }: { k: number }) {
    return (
      <KaitenErrorBoundary resetKeys={[k]}>
        <Boom />
      </KaitenErrorBoundary>
    );
  }

  // React logs the caught error; silence it for a clean test run.
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const { rerender } = render(<Harness k={0} />);

  // Localized message is shown; the raw technical error is NOT leaked to the user.
  expect(screen.getByText(defaultLocalization.states.failed)).toBeDefined();
  expect(screen.queryByText(/SECRET internal server detail/)).toBeNull();

  // Fix the underlying condition and change a reset key → the boundary retries.
  shouldThrow = false;
  rerender(<Harness k={1} />);
  expect(screen.getByText("recovered")).toBeDefined();

  errorSpy.mockRestore();
});

// ===========================================================================
// 5.5 @kaitencloud/client/testing — the fake client against real components
// ===========================================================================

// This is the claim the subpath exists to make: an adopter with no Kaiten
// account and no reachable API renders the real components with real data.
//
// It also exercises the seam itself. Every other test in this file goes through
// a `vi.mock` of the whole `@kaitencloud/client` module — the fixtures never
// touch `props.client`, so nothing proved a plain object could be passed there
// at all. Before `KaitenClientLike` it could not: the class has a private field,
// so TypeScript typed it nominally and every double needed
// `as unknown as KaitenClient`.
test("createMockKaitenClient drives PricingTable with no plans prop", async () => {
  const { createMockKaitenClient } = await import("@kaitencloud/client/testing");

  render(
    <KaitenProvider
      mode="public"
      publishableKey="pk_mock_client"
      polling={{ enabled: false }}
      client={createMockKaitenClient()}
    >
      <PricingTable showFeatureComparison={false} />
    </KaitenProvider>,
  );

  await waitFor(() => expect(screen.getByText("Growth")).toBeDefined());

  // $79.00 from the fixture's minor-unit amount, formatted by the SDK.
  expect(screen.getByText(formatKaitenMoney(7900, "USD"))).toBeDefined();
  expect(screen.getByText("Starter")).toBeDefined();
  expect(screen.getByText("Enterprise")).toBeDefined();
  // The fixtures carry an unpublished internal license precisely so this holds.
  expect(screen.queryByText("Internal QA")).toBeNull();
});

test("createMockKaitenClient drives the authenticated portal", async () => {
  const { createMockKaitenClient } = await import("@kaitencloud/client/testing");

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="test"
      customerId="cust-mock-portal"
      polling={{ enabled: false }}
      client={createMockKaitenClient()}
    >
      <CurrentPlan />
    </KaitenProvider>,
  );

  await waitFor(() => expect(screen.getByText("Growth")).toBeDefined());

  // The fixture license's slug matches a priced plan, so the portal's join
  // resolves end to end — through the built package, not through source.
  const priceLine = document.querySelector('[data-slot="current-plan-price"]');
  expect(priceLine?.textContent).toContain(formatKaitenMoney(7900, "USD"));
});

test("the fake's error option drives the failure state", async () => {
  const { createMockKaitenClient } = await import("@kaitencloud/client/testing");

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="test"
      customerId="cust-mock-error"
      polling={{ enabled: false }}
      client={createMockKaitenClient({ error: new Error("fixture outage") })}
    >
      <KaitenFailed>{({ error }) => <div>failed: {error.message}</div>}</KaitenFailed>
    </KaitenProvider>,
  );

  await waitFor(() => expect(screen.getByText("failed: fixture outage")).toBeDefined());
});

// The provider used to wrap its children in a <SWRConfig> carrying its own read
// policy. Those children include the HOST's components, so any `useSWR` the app
// wrote inside <KaitenProvider> silently lost focus revalidation and error
// retries. The SDK's own reads set their policy per hook, so the cascade only
// ever changed other people's.
function HostSwrConfigProbe() {
  const config = useSWRConfig();
  return (
    <div>
      {`host:${String(config.revalidateOnFocus)}:${String(config.shouldRetryOnError)}:${String(
        config.refreshInterval ?? 0,
      )}`}
    </div>
  );
}

test("the provider does not impose its SWR policy on the host's own hooks", () => {
  installFetchMock();

  const { unmount } = render(<HostSwrConfigProbe />);
  const outside = screen.getByText(/^host:/).textContent;
  unmount();

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-swr-config"
      polling={{ enabled: true, interval: 1234 }}
    >
      <HostSwrConfigProbe />
    </KaitenProvider>,
  );

  // Identical inside and outside: wrapping a subtree in <KaitenProvider> is not
  // a reason for the host's data layer to behave differently.
  expect(screen.getByText(/^host:/).textContent).toBe(outside);
});

// --- WCAG 2.1.2: the hard wall must not be a keyboard trap -------------------
// `mode="hard"` rendered `<Dialog open>` with no `onOpenChange`, no close button,
// and Escape / outside-click / pointer-down-outside all prevented. Radix traps
// focus in a modal, so with no `onUpgrade` the card rendered no button at all and
// a keyboard user could leave neither the dialog nor the page. The only
// mitigation was a dev-mode console.warn.

function hardWallSnapshot(): LicensingSnapshot {
  return {
    ...baseSnapshot,
    entitlements: baseSnapshot.entitlements.map((entitlement) =>
      entitlement.slug === "api_calls"
        ? {
            ...entitlement,
            limitValue: { type: "number", value: 10 },
            currentValue: { type: "number", value: 10 },
            remaining: 0,
            percentageUsed: 100,
            status: "over_limit",
          }
        : entitlement,
    ),
  };
}

async function renderHardWall(customerId: string, extra?: { onUpgrade?: () => void }) {
  installFetchMock({ snapshot: hardWallSnapshot() });
  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={customerId}
      polling={{ enabled: false }}
    >
      <Paywall entitlement="api_calls" mode="hard" {...extra}>
        <div>paid content</div>
      </Paywall>
    </KaitenProvider>,
  );
  await waitFor(() => expect(document.querySelector("[role='dialog']")).not.toBeNull());
}

test("the hard wall offers a keyboard exit even with no onUpgrade (WCAG 2.1.2)", async () => {
  await renderHardWall("cust-hard-trap");

  // A focusable control inside the dialog is what makes the trap escapable at
  // all: previously the only element was non-interactive branding.
  const dialog = document.querySelector("[role='dialog']") as HTMLElement;
  expect(
    dialog.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])").length,
  ).toBeGreaterThan(0);
});

test("the hard wall's dialog carries the reason too", async () => {
  await renderHardWall("cust-hard-reason");

  // Hard mode's wall IS the dialog, so the attribute has to ride on it rather
  // than on an overlay that does not exist in this branch.
  const dialog = document.querySelector("[role='dialog']") as HTMLElement;
  expect(dialog.dataset.reason).toBe("over_limit");
});

test("Escape closes the hard wall's dialog, and the paid content stays walled", async () => {
  await renderHardWall("cust-hard-escape");
  expect(screen.queryByText("paid content")).toBeDefined();

  fireEvent.keyDown(document.querySelector("[role='dialog']")!, { key: "Escape", code: "Escape" });

  // The modal goes…
  await waitFor(() => expect(document.querySelector("[role='dialog']")).toBeNull());

  // …but the wall does not: the content is still inert, and hard mode still
  // renders no dismiss control. Closing the dialog frees the focus, not the feature.
  const masked = document.querySelector("[data-slot='paywall']");
  expect(masked).not.toBeNull();
  expect(masked?.querySelector("[inert]")).not.toBeNull();
  expect(screen.queryByText(defaultLocalization.paywall.dismiss)).toBeNull();
});

test("the hard wall still blocks when an upgrade action exists", async () => {
  const onUpgrade = vi.fn();
  await renderHardWall("cust-hard-upgrade", { onUpgrade });

  // The CTA label follows the recommended action (addQuota for an exhausted
  // numeric limit), so match on any of them rather than on "upgrade".
  const labels = [
    defaultLocalization.paywall.upgrade,
    defaultLocalization.paywall.addQuota,
    defaultLocalization.paywall.addAddOn,
    defaultLocalization.paywall.contactSales,
  ];
  const dialog = document.querySelector("[role='dialog']") as HTMLElement;
  const cta = [...dialog.querySelectorAll("button")].find((button) =>
    labels.some((label) => button.textContent?.includes(label)),
  );
  expect(cta).toBeDefined();
  fireEvent.click(cta!);
  expect(onUpgrade).toHaveBeenCalled();
});

// The "per bar, never per card" guard. Two meters on one instance rarely share
// bounds — each entitlement carries its own cadence, and a LICENSE_START anchor
// phases the window off the instance's own license start date — so a single
// caption on the card would be right for at most one of them. Asserting two
// DIFFERENT strings in the SAME render is what makes a hoisted caption fail.
test("each usage meter announces its own window", async () => {
  installFetchMock({
    snapshot: {
      ...baseSnapshot,
      entitlements: [
        {
          id: "ent-tokens",
          slug: "tokens",
          name: "Tokens",
          type: "NUMBER",
          source: "license",
          limitValue: { type: "number", value: 100 },
          currentValue: { type: "number", value: 40 },
          status: "enabled",
          userFacing: true,
          currentPeriodStart: "2026-03-01T00:00:00Z",
          currentPeriodEnd: "2026-04-01T00:00:00Z",
        },
        {
          id: "ent-seats",
          slug: "seats",
          name: "Seats",
          type: "NUMBER",
          source: "license",
          limitValue: { type: "number", value: 120 },
          currentValue: { type: "number", value: 68 },
          status: "enabled",
          userFacing: true,
        },
      ],
    },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-usage-windows"
      polling={{ enabled: false }}
    >
      <UsageMeters />
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Tokens")).toBeDefined();
  });

  expect(screen.getByText(/This period/)).toBeDefined();
  expect(screen.getByText("All time")).toBeDefined();
});

// A wall at 100% is two different situations wearing the same number: a lifetime
// counter needs a purchase, a periodic one empties on its own. Without the
// window the CTA is the only thing left to believe, and it is wrong half the
// time.
test("the paywall says whether the quota frees itself", async () => {
  installFetchMock({
    snapshot: {
      ...baseSnapshot,
      entitlements: [
        {
          id: "ent-api",
          slug: "api_calls",
          name: "API calls",
          type: "NUMBER",
          source: "license",
          limitValue: { type: "number", value: 100 },
          currentValue: { type: "number", value: 100 },
          status: "over_limit",
          userFacing: true,
          currentPeriodStart: "2026-03-01T00:00:00Z",
          currentPeriodEnd: "2026-04-01T00:00:00Z",
        },
      ],
    },
  });

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId="cust-paywall-window"
      polling={{ enabled: false }}
    >
      <Paywall entitlement="api_calls" onUpgrade={() => {}}>
        <div>metered content</div>
      </Paywall>
    </KaitenProvider>,
  );

  await waitFor(() => {
    expect(document.querySelector(".ktn-paywall-usage-window")).not.toBeNull();
  });
  expect(document.querySelector(".ktn-paywall-usage-window")?.textContent).toMatch(/This period/);
});
