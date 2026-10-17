// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { useReducer } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { KaitenProvider } from "../src/providers/kaiten-provider.tsx";

afterEach(cleanup);

/**
 * Captures the Authorization header of every request the SDK makes, and answers
 * with empty-but-valid payloads so the provider settles instead of retrying.
 */
function installFetchSpy() {
  const authHeaders: (string | null)[] = [];
  const urls: string[] = [];

  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    authHeaders.push(request.headers.get("Authorization"));
    urls.push(request.url);

    const body = request.url.includes("/graphql")
      ? { data: { licenses: [], customer: null } }
      : { flags: [] };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchSpy);
  return { authHeaders, urls, fetchSpy };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a function accessToken is resolved per request", async () => {
  const { authHeaders } = installFetchSpy();

  render(
    <KaitenProvider
      mode="authenticated"
      apiUrl="https://example.test/api"
      accessToken={() => "from-provider"}
      customerId="acme"
    >
      <span />
    </KaitenProvider>,
  );

  await waitFor(() => expect(authHeaders.length).toBeGreaterThan(0));
  expect(authHeaders.every((header) => header === "Bearer from-provider")).toBe(true);
});

test("an async function accessToken is awaited", async () => {
  const { authHeaders } = installFetchSpy();

  render(
    <KaitenProvider
      mode="authenticated"
      apiUrl="https://example.test/api"
      accessToken={async () => "awaited-token"}
      customerId="acme"
    >
      <span />
    </KaitenProvider>,
  );

  await waitFor(() => expect(authHeaders.length).toBeGreaterThan(0));
  expect(authHeaders.every((header) => header === "Bearer awaited-token")).toBe(true);
});

test("a fresh inline arrow on every render does not restart the data layer", async () => {
  // Hosts write `accessToken={() => getToken()}` inline. Memoizing the client on
  // that identity would rebuild it — and refetch everything — on every render.
  const { fetchSpy } = installFetchSpy();

  const view = render(
    <KaitenProvider
      mode="authenticated"
      apiUrl="https://example.test/api"
      accessToken={() => "stable"}
      customerId="acme"
    >
      <span />
    </KaitenProvider>,
  );

  await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(0));
  const afterMount = fetchSpy.mock.calls.length;

  for (let index = 0; index < 5; index += 1) {
    view.rerender(
      <KaitenProvider
        mode="authenticated"
        apiUrl="https://example.test/api"
        accessToken={() => "stable"}
        customerId="acme"
      >
        <span />
      </KaitenProvider>,
    );
  }

  await Promise.resolve();
  expect(fetchSpy.mock.calls.length).toBe(afterMount);
});

// Token rotation across requests is covered at the transport level, where a
// second request can actually be provoked — see
// packages/client/tests/core/transport-auth.test.ts.

test("onAuthError fires when the API rejects the credential", async () => {
  const onAuthError = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ title: "Unauthorized", status: 401 }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );

  render(
    <KaitenProvider
      mode="authenticated"
      apiUrl="https://example.test/api"
      accessToken="expired"
      customerId="acme"
      onAuthError={onAuthError}
    >
      <span />
    </KaitenProvider>,
  );

  await waitFor(() => expect(onAuthError).toHaveBeenCalled());
  expect(onAuthError.mock.calls[0][0]).toMatchObject({ status: 401 });
});

/**
 * Answers the GraphQL endpoint with an error envelope and everything else with
 * an empty-but-valid payload, so the SDK completes over the REST fan-out —
 * which is exactly what the silent fallback used to look like from outside.
 */
function installDegradedApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init);
      const body = request.url.includes("/graphql")
        ? { errors: [{ message: 'Cannot query field "saleUnitFactor"' }] }
        : request.url.includes("/ofrep/")
          ? { flags: [] }
          : request.url.includes("/customers/")
            ? { id: "c1", slug: "acme", name: "Acme" }
            : [];

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

// The host is the one paying for the fallback — a request per license and no
// presentation metadata — so the host is who needs to hear about it. Reaching it
// through the provider is the whole point: an adopter who never constructs a
// `KaitenClient` could not otherwise subscribe.
test("onDegraded reaches the host through the provider", async () => {
  const onDegraded = vi.fn();
  installDegradedApi();

  render(
    <KaitenProvider
      mode="authenticated"
      apiUrl="https://example.test/api"
      accessToken="tmp"
      customerId="degraded-customer"
      onDegraded={onDegraded}
    >
      <span />
    </KaitenProvider>,
  );

  await waitFor(() => expect(onDegraded).toHaveBeenCalled());
  expect(onDegraded.mock.calls[0][0]).toMatchObject({ operation: "getLicensingSnapshot" });
  expect(String(onDegraded.mock.calls[0][0].error)).toContain("saleUnitFactor");
});

// Same ref treatment as `onAuthError`: hosts pass inline arrows, and depending
// on their identity would rebuild the client — and the SWR cache with it — on
// every render, refetching forever.
test("a fresh inline onDegraded arrow does not restart the data layer", async () => {
  installDegradedApi();
  const calls: unknown[] = [];

  function Host() {
    const [, force] = useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
      const id = setTimeout(() => force(), 0);
      return () => clearTimeout(id);
    }, []);

    return (
      <KaitenProvider
        mode="authenticated"
        apiUrl="https://example.test/api"
        accessToken="tmp"
        customerId="degraded-stable"
        onDegraded={(info) => calls.push(info)}
      >
        <span />
      </KaitenProvider>
    );
  }

  render(<Host />);

  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  // One degraded read, not one per render.
  expect(calls).toHaveLength(1);
});
