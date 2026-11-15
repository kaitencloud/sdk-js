// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// `mode="static"`: the provider is given the catalog and makes no request.
//
// The marketing-site path. Every assertion here is about what the mode
// promises — data on the first render, no network under any circumstance, an
// honest answer from every hook that needs an API — so that a host can build a
// pricing page on it today and swap in `mode="public"` when the platform
// serves one.

import type { ReactNode } from "react";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { demoCatalog, demoSnapshot } from "@kaitencloud/client/testing";

import { kaitenClientMock } from "./support/kaiten-client-double.ts";
import {
  Gate,
  KaitenLoaded,
  KaitenLoading,
  KaitenProvider,
  KaitenScopeProvider,
  useEntitlements,
  useKaitenScopeKey,
  useLicense,
  useLicensingSnapshot,
  usePlans,
  useReportUsage,
  type KaitenCatalog,
} from "../src/index.ts";

// The session-switch test needs an authenticated scope, which builds a real
// `KaitenClient`; the shared double answers it a fixture. Static mode itself
// never constructs one — the assertions on `fetch` are what prove that.
vi.mock("@kaitencloud/client", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/client")>();
  const { createKaitenClientDouble } = await import("./support/kaiten-client-double.ts");
  return { ...actual, KaitenClient: createKaitenClientDouble() };
});

// Hoisted, as the docs tell hosts to: the provider's consumers follow the
// object's identity, and the scope key follows its plan slugs.
const catalog: KaitenCatalog = demoCatalog();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  kaitenClientMock.resetScopes();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <KaitenProvider mode="static" catalog={catalog}>
      {children}
    </KaitenProvider>
  );
}

function PlansProbe() {
  const plans = usePlans();
  return (
    <div
      data-testid="plans"
      data-loading={String(plans.isLoading)}
      data-same={String(plans.data === catalog.plans)}
    >
      {plans.data?.map((plan) => plan.name).join("|")}
    </div>
  );
}

test("renders the host's catalog on the first render, and makes no request", () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);

  render(
    <KaitenProvider mode="static" catalog={catalog}>
      <PlansProbe />
    </KaitenProvider>,
  );

  // Synchronous on purpose — no `waitFor`. There is no loading state to wait
  // out, and the data is the host's own object, not a copy.
  const probe = screen.getByTestId("plans");
  expect(probe.dataset.loading).toBe("false");
  expect(probe.dataset.same).toBe("true");
  for (const plan of catalog.plans) {
    expect(probe.textContent).toContain(plan.name);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("is loaded from the start: KaitenLoaded renders, KaitenLoading never does", () => {
  render(
    <KaitenProvider mode="static" catalog={catalog}>
      <KaitenLoading>
        <span data-testid="loading" />
      </KaitenLoading>
      <KaitenLoaded>
        <span data-testid="loaded" />
      </KaitenLoaded>
    </KaitenProvider>,
  );

  expect(screen.queryByTestId("loading")).toBeNull();
  expect(screen.getByTestId("loaded")).toBeDefined();
});

test("has no snapshot: customer-scoped hooks answer empty, not loading", () => {
  const { result } = renderHook(
    () => ({
      snapshot: useLicensingSnapshot(),
      entitlements: useEntitlements(),
      license: useLicense(),
    }),
    { wrapper },
  );

  // "Nothing to load" and "still loading" must not look alike: a portal
  // section mounted here by mistake shows its empty state, not a skeleton.
  expect(result.current.snapshot).toMatchObject({ data: undefined, isLoading: false, error: null });
  expect(result.current.entitlements.data).toEqual([]);
  expect(result.current.entitlements.isLoading).toBe(false);
  expect(result.current.license.data).toBeUndefined();
});

test("fails open on gating, and names the mode it is in", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  render(
    <KaitenProvider mode="static" catalog={catalog}>
      <Gate entitlement="seats">
        {(state) => (state.allowed ? <span data-testid="gated">visible</span> : null)}
      </Gate>
    </KaitenProvider>,
  );

  // Same policy as public mode: there is no customer to deny, so the gate opens
  // and development says why. `Paywall` sits on the same hook.
  expect(screen.getByTestId("gated")).toBeDefined();
  const messages = warn.mock.calls.map((call) => String(call[0]));
  expect(messages.join("\n")).toContain('mode="static"');
  // And no second warning about an "unknown" slug — an empty list from a scope
  // with no customer says nothing about the slug.
  expect(messages.some((message) => message.includes("no entitlement with that slug"))).toBe(false);
});

test("refuses writes and live reads, naming the mode", async () => {
  const { result } = renderHook(
    () => ({
      report: useReportUsage(),
    }),
    { wrapper },
  );

  await expect(
    result.current.report.mutateAsync({
      entitlementSlug: "seats",
      input: { value: { type: "number", value: 1 }, behavior: "append" },
    }),
  ).rejects.toThrow(/authenticated mode/);
});

test("scope: the same catalog nested is a pass-through, a different one is its own root", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const other: KaitenCatalog = { plans: [{ slug: "solo", name: "Solo" }] };

  function ScopeProbe({ id }: { id: string }) {
    return <span data-testid={id}>{useKaitenScopeKey()}</span>;
  }

  render(
    <KaitenProvider mode="static" catalog={catalog}>
      <ScopeProbe id="outer" />
      <KaitenProvider mode="static" catalog={catalog}>
        <ScopeProbe id="same" />
      </KaitenProvider>
      <KaitenProvider mode="static" catalog={other}>
        <ScopeProbe id="other" />
      </KaitenProvider>
    </KaitenProvider>,
  );

  const outer = screen.getByTestId("outer").textContent;
  expect(outer).toMatch(/^static:/);
  // The redundant wrapper is a pass-through onto the outer scope, and says so;
  // the different catalog is a scope of its own.
  expect(screen.getByTestId("same").textContent).toBe(outer);
  expect(screen.getByTestId("other").textContent).toBe("static:solo");
  expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain("Redundant nested");
});

test("KaitenScopeProvider renders a static catalog before login, and the snapshot after", async () => {
  const snapshot = demoSnapshot();
  kaitenClientMock.state.snapshot = snapshot;
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);

  function LicenseProbe() {
    const license = useLicense();
    return <span data-testid="license">{license.data?.name ?? "none"}</span>;
  }

  function Shell({ signedIn }: { signedIn: boolean }) {
    return (
      <KaitenScopeProvider
        publicConfig={{ mode: "static", catalog }}
        authenticatedConfig={
          signedIn
            ? {
                mode: "authenticated",
                accessToken: "tmp_session",
                customerId: snapshot.customer!.slug,
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

  const { rerender } = render(<Shell signedIn={false} />);

  // Signed out: the static catalog, immediately, and nothing on the wire.
  expect(screen.getByTestId("plans").dataset.loading).toBe("false");
  expect(screen.getByTestId("plans").textContent).toContain(catalog.plans[0]!.name);
  expect(screen.getByTestId("license").textContent).toBe("none");
  expect(fetchSpy).not.toHaveBeenCalled();

  rerender(<Shell signedIn />);

  // Signed in: the scope remounted onto the customer's snapshot.
  await waitFor(() => {
    expect(screen.getByTestId("license").textContent).toBe(snapshot.license!.name);
  });
});
