// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { expect, test, vi, afterEach } from "vite-plus/test";

import { kaitenClientMock } from "./support/kaiten-client-double.ts";
import { PricingTable, FeatureComparison, type Plan } from "../src/index.ts";
import { KaitenProvider } from "./support/styled-provider.tsx";

vi.mock("@kaitencloud/client", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/client")>();
  const { createKaitenClientDouble } = await import("./support/kaiten-client-double.ts");
  return { ...actual, KaitenClient: createKaitenClientDouble() };
});

// Each test overrides `getCatalog`, and `clearAllMocks` clears calls but keeps
// implementations — so restore the double's own behaviour explicitly. NOT
// `restoreAllMocks`, which strips the implementation and leaves every later test
// with a client that silently resolves `undefined`.
const catalogBehaviour = kaitenClientMock.getCatalog.getMockImplementation();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  kaitenClientMock.getCatalog.mockImplementation(catalogBehaviour!);
  kaitenClientMock.resetScopes();
});

// The SWR cache is global and survives `cleanup()`. In public mode the scope key
// is `public:apiUrl:publishableKey`, so two tests sharing a publishable key share
// a cache entry: the second never calls the fetcher and never sees a loading
// frame. Every test therefore gets its own key — the catalog-side version of the
// "distinct customerId per test" rule this repo already documents.
let keySeq = 0;
function Catalog({ children }: { children: React.ReactNode }) {
  keySeq += 1;
  return (
    <KaitenProvider
      mode="public"
      publishableKey={`pk_states_${keySeq}`}
      polling={{ enabled: false }}
    >
      {children}
    </KaitenProvider>
  );
}

const pro: Plan = { slug: "pro", name: "Pro", price: 7900, currencyCode: "EUR" };

// Before this, all three cases rendered `null`: a pricing page that failed to
// load was indistinguishable from an empty catalog, for the visitor AND for the
// host's monitoring. These four tests pin the distinction.

test("a catalog that fails to load renders an error with a retry, not nothing", async () => {
  kaitenClientMock.getCatalog.mockRejectedValue(new Error("boom"));

  render(
    <Catalog>
      <PricingTable showFeatureComparison={false} />
    </Catalog>,
  );

  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  expect(document.querySelector('[data-slot="section-error"]')).not.toBeNull();
});

test("a catalog still in flight renders a busy placeholder, not nothing", async () => {
  // Never resolves: holds the component in its loading frame.
  kaitenClientMock.getCatalog.mockImplementation(() => new Promise(() => {}));

  render(
    <Catalog>
      <PricingTable showFeatureComparison={false} />
    </Catalog>,
  );

  await waitFor(() =>
    expect(document.querySelector('[data-slot="pricing-table-loading"]')).not.toBeNull(),
  );
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
});

// The unstyled tree is the surface STABILITY.md calls the most stable one, so a
// serious adopter picks it. Emitting Tailwind markup there is the defect that
// every other section of the portal still has.
test("the loading placeholder honours unstyled instead of emitting styled markup", async () => {
  kaitenClientMock.getCatalog.mockImplementation(() => new Promise(() => {}));

  render(
    <Catalog>
      <PricingTable showFeatureComparison={false} unstyled />
    </Catalog>,
  );

  await waitFor(() =>
    expect(document.querySelector('[data-slot="pricing-table-loading"]')).not.toBeNull(),
  );
  expect(document.querySelector('[data-slot="card"]')).toBeNull();
});

test("an empty catalog still renders nothing — an empty shop is not a broken one", async () => {
  kaitenClientMock.getCatalog.mockResolvedValue({ plans: [], branding: { removable: false } });

  const { container } = render(
    <Catalog>
      <PricingTable showFeatureComparison={false} />
    </Catalog>,
  );

  await waitFor(() => expect(kaitenClientMock.getCatalog).toHaveBeenCalled());
  expect(container.querySelector('[data-slot="section-error"]')).toBeNull();
  expect(container.querySelector('[data-slot="pricing-table-loading"]')).toBeNull();
});

// Host-supplied plans own their own lifecycle. Surfacing our query's state over
// them would let a failed background catalog read blank out a table the host
// rendered from its own data.
test("host-supplied plans never surface the SDK's own fetch state", async () => {
  kaitenClientMock.getCatalog.mockRejectedValue(new Error("boom"));

  render(
    <Catalog>
      <PricingTable plans={[pro]} showFeatureComparison={false} />
    </Catalog>,
  );

  await waitFor(() => expect(screen.getByText("Pro")).toBeDefined());
  expect(document.querySelector('[data-slot="section-error"]')).toBeNull();
});

test("FeatureComparison reports a failed catalog too", async () => {
  kaitenClientMock.getCatalog.mockRejectedValue(new Error("boom"));

  render(
    <Catalog>
      <FeatureComparison />
    </Catalog>,
  );

  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
});

test("FeatureComparison stays silent when the host passed the plans", async () => {
  kaitenClientMock.getCatalog.mockRejectedValue(new Error("boom"));

  const { container } = render(
    <Catalog>
      <FeatureComparison plans={[pro]} />
    </Catalog>,
  );

  await waitFor(() => expect(kaitenClientMock.getCatalog).toHaveBeenCalled());
  expect(container.querySelector('[data-slot="section-error"]')).toBeNull();
});
