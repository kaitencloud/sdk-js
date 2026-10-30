// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// The primitives the core owns, tested headlessly.
//
// They used to be covered incidentally by the styled components' suite, which
// rendered them inside a portal or a paywall. That suite went with the
// components, and these are now the blessed path of a package that ships
// nothing else — so they get their own tests, against the DOM they actually
// produce: their children, and nothing of Kaiten's.

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { demoSnapshot } from "@kaitencloud/client/testing";
import type { KaitenClientLike, LicensingSnapshot } from "@kaitencloud/client";

import {
  KaitenErrorBoundary,
  KaitenFailed,
  KaitenLoaded,
  KaitenLoading,
  KaitenProvider,
  Show,
  useKaitenBranding,
} from "../src/index.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A provider whose snapshot read resolves, rejects, or never settles. */
function harness(
  children: ReactNode,
  options: { snapshot?: LicensingSnapshot; fail?: Error; pending?: boolean } = {},
) {
  const getLicensingSnapshot = vi.fn(async () => {
    if (options.fail) throw options.fail;
    if (options.pending) return await new Promise<LicensingSnapshot>(() => {});
    return options.snapshot ?? demoSnapshot();
  });
  const client = {
    getCatalog: vi.fn(async () => ({ plans: [], entitlements: [] })),
    getLicensingSnapshot,
  } as unknown as KaitenClientLike;

  return {
    getLicensingSnapshot,
    ...render(
      <KaitenProvider
        mode="authenticated"
        accessToken="t"
        // A distinct customer per render: the scope key prefixes every SWR key,
        // so this is what keeps one test's cache out of the next one's.
        customerId={`cust-${Math.random().toString(36).slice(2)}`}
        polling={{ enabled: false }}
        client={client}
      >
        {children}
      </KaitenProvider>,
    ),
  };
}

// --------------------------------------------------------------- load states

test("KaitenLoading renders while the read is in flight, KaitenLoaded after it", async () => {
  harness(
    <>
      <KaitenLoading>
        <span data-testid="loading" />
      </KaitenLoading>
      <KaitenLoaded>
        <span data-testid="loaded" />
      </KaitenLoaded>
    </>,
  );

  expect(screen.getByTestId("loading")).toBeDefined();
  expect(screen.queryByTestId("loaded")).toBeNull();

  await waitFor(() => expect(screen.getByTestId("loaded")).toBeDefined());
  expect(screen.queryByTestId("loading")).toBeNull();
});

test("KaitenLoaded stays silent on failure, and KaitenFailed takes over", async () => {
  harness(
    <>
      <KaitenLoaded>
        <span data-testid="loaded" />
      </KaitenLoaded>
      <KaitenFailed>
        <span data-testid="failed" />
      </KaitenFailed>
    </>,
    { fail: new Error("boom") },
  );

  await waitFor(() => expect(screen.getByTestId("failed")).toBeDefined());
  expect(screen.queryByTestId("loaded")).toBeNull();
});

test("KaitenFailed's render prop hands over the error and a working retry", async () => {
  const { getLicensingSnapshot } = harness(
    <KaitenFailed>
      {({ error, retry }) => (
        <button type="button" onClick={retry}>
          {error.message}
        </button>
      )}
    </KaitenFailed>,
    { fail: new Error("licensing is down") },
  );

  const retry = await screen.findByText("licensing is down");
  // The provider sets `shouldRetryOnError: false`, so this callback is the only
  // way out of a failure state short of reloading the page.
  expect(getLicensingSnapshot).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  await waitFor(() => expect(getLicensingSnapshot).toHaveBeenCalledTimes(2));
});

test("nothing renders outside a provider, and the message names the component", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() =>
    render(
      <KaitenLoaded>
        <span />
      </KaitenLoaded>,
    ),
  ).toThrow(/<KaitenLoaded> must be used within a <KaitenProvider>/);
  error.mockRestore();
});

// ---------------------------------------------------------------------- Show

test("Show renders on an entitlement the customer holds, and its fallback otherwise", async () => {
  harness(
    <>
      <Show when="entitled" entitlement="seats" fallback={<span data-testid="no-seats" />}>
        <span data-testid="seats" />
      </Show>
      <Show when="entitled" entitlement="not-in-the-plan" fallback={<span data-testid="denied" />}>
        <span data-testid="granted" />
      </Show>
    </>,
  );

  await waitFor(() => expect(screen.getByTestId("seats")).toBeDefined());
  expect(screen.queryByTestId("no-seats")).toBeNull();
  expect(screen.getByTestId("denied")).toBeDefined();
  expect(screen.queryByTestId("granted")).toBeNull();
});

test('Show when="not-entitled" is the upsell branch', async () => {
  harness(
    <Show when="not-entitled" entitlement="not-in-the-plan">
      <span data-testid="upsell" />
    </Show>,
  );

  await waitFor(() => expect(screen.getByTestId("upsell")).toBeDefined());
});

test("Show renders `loading` while the read is in flight", () => {
  harness(
    <Show when="entitled" entitlement="seats" loading={<span data-testid="pending" />}>
      <span data-testid="content" />
    </Show>,
    { pending: true },
  );

  expect(screen.getByTestId("pending")).toBeDefined();
  expect(screen.queryByTestId("content")).toBeNull();
});

test("Show fails closed on an error, and opens only when asked", async () => {
  harness(
    <>
      <Show when="entitled" entitlement="seats" fallback={<span data-testid="blocked" />}>
        <span data-testid="closed-content" />
      </Show>
      <Show when="entitled" entitlement="seats" onError="allow">
        <span data-testid="open-content" />
      </Show>
      {/* The dangerous one: `!allowed` on an error would reveal this. */}
      <Show when="not-entitled" entitlement="seats" fallback={<span data-testid="held" />}>
        <span data-testid="leaked-upsell" />
      </Show>
    </>,
    { fail: new Error("outage") },
  );

  await waitFor(() => expect(screen.getByTestId("blocked")).toBeDefined());
  expect(screen.queryByTestId("closed-content")).toBeNull();
  expect(screen.getByTestId("open-content")).toBeDefined();
  expect(screen.getByTestId("held")).toBeDefined();
  expect(screen.queryByTestId("leaked-upsell")).toBeNull();
});

// ------------------------------------------------------------ error boundary

function Boom({ throws = true }: { throws?: boolean }): React.JSX.Element {
  if (throws) throw new Error("render exploded");
  return <span data-testid="recovered" />;
}

test("KaitenErrorBoundary catches a render error and reports it once", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const onError = vi.fn();

  render(
    <KaitenErrorBoundary onError={onError} fallback={<span data-testid="fallback" />}>
      <Boom />
    </KaitenErrorBoundary>,
  );

  expect(screen.getByTestId("fallback")).toBeDefined();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
  consoleError.mockRestore();
});

test("the default fallback is a localized alert with a retry that clears the error", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  let throws = true;

  function Subject() {
    return <Boom throws={throws} />;
  }

  render(
    <KaitenErrorBoundary>
      <Subject />
    </KaitenErrorBoundary>,
  );

  // The technical message is delivered to `onError`, never to the user.
  const alert = screen.getByRole("alert");
  expect(alert.textContent).not.toContain("render exploded");

  throws = false;
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByTestId("recovered")).toBeDefined();
  consoleError.mockRestore();
});

test("resetKeys clear the error, so a route or customer change recovers on its own", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  let throws = true;

  function Tree({ routeKey }: { routeKey: string }) {
    return (
      <KaitenErrorBoundary resetKeys={[routeKey]} fallback={<span data-testid="fallback" />}>
        <Boom throws={throws} />
      </KaitenErrorBoundary>
    );
  }

  const { rerender } = render(<Tree routeKey="/billing" />);
  expect(screen.getByTestId("fallback")).toBeDefined();

  throws = false;
  rerender(<Tree routeKey="/settings" />);
  expect(screen.getByTestId("recovered")).toBeDefined();
  consoleError.mockRestore();
});

test("the render-prop fallback receives the error and a reset callback", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  let throws = true;
  // Read at render time, not captured in the element: `reset()` re-renders the
  // children the boundary already holds, so a `<Boom throws={throws} />` written
  // inline would throw again with the value it was created with.
  const Subject = () => <Boom throws={throws} />;

  render(
    <KaitenErrorBoundary
      fallback={(error, reset) => (
        <button type="button" onClick={reset}>
          {error.message}
        </button>
      )}
    >
      <Subject />
    </KaitenErrorBoundary>,
  );

  throws = false;
  fireEvent.click(screen.getByText("render exploded"));
  expect(screen.getByTestId("recovered")).toBeDefined();
  consoleError.mockRestore();
});

// ------------------------------------------------------------------ branding

function BrandingProbe() {
  const { hidden, removable } = useKaitenBranding();
  return (
    <span data-testid="branding" data-hidden={String(hidden)} data-removable={String(removable)} />
  );
}

test("useKaitenBranding: the licence decides, not the prop", async () => {
  harness(<BrandingProbe />, { snapshot: demoSnapshot({ branding: { removable: false } }) });

  await waitFor(() => expect(screen.getByTestId("branding").dataset.removable).toBe("false"));
  expect(screen.getByTestId("branding").dataset.hidden).toBe("false");
});

test("useKaitenBranding: hideBranding is granted when the licence allows removal", async () => {
  const client = {
    getCatalog: vi.fn(async () => ({ plans: [], entitlements: [] })),
    getLicensingSnapshot: vi.fn(async () => demoSnapshot({ branding: { removable: true } })),
  } as unknown as KaitenClientLike;

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="t"
      customerId="cust-branding-removable"
      polling={{ enabled: false }}
      hideBranding
      client={client}
    >
      <BrandingProbe />
    </KaitenProvider>,
  );

  await waitFor(() => expect(screen.getByTestId("branding").dataset.hidden).toBe("true"));
});

test("useKaitenBranding: a bypass attempt stays visible, warns, and is reported once", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const transport = vi.fn();
  const client = {
    getCatalog: vi.fn(async () => ({ plans: [], entitlements: [] })),
    getLicensingSnapshot: vi.fn(async () => demoSnapshot({ branding: { removable: false } })),
  } as unknown as KaitenClientLike;

  render(
    <KaitenProvider
      mode="authenticated"
      accessToken="t"
      customerId="cust-branding-bypass"
      polling={{ enabled: false }}
      hideBranding
      client={client}
      telemetry={{ transport }}
    >
      <BrandingProbe />
      <BrandingProbe />
    </KaitenProvider>,
  );

  const bypassEvents = () =>
    transport.mock.calls
      .map((call) => call[0] as { type: string; name: string })
      .filter((event) => event.name === "branding.bypass_attempted");

  await waitFor(() => expect(bypassEvents().length).toBeGreaterThan(0));
  expect(screen.getAllByTestId("branding")[0]!.dataset.hidden).toBe("false");
  // Once for the whole provider, not once per call site. (The transport also
  // receives the `hook` usage event every public hook emits, hence the filter.)
  expect(bypassEvents()).toHaveLength(1);
  expect(bypassEvents()[0]).toMatchObject({ type: "action" });
  expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
    "does not allow removal",
  );
  warn.mockRestore();
});
