import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { KaitenTransport } from "../../src/core/transport.ts";
import type { KaitenFetch } from "../../src/core/config.ts";

/** Minimal fetch stub: records requests and replies with the queued statuses. */
function stubFetch(statuses: number[]): { fetch: KaitenFetch; requests: Request[] } {
  const requests: Request[] = [];
  let call = 0;

  const fetch: KaitenFetch = async (input, init) => {
    requests.push(new Request(input as RequestInfo, init));
    const status = statuses[Math.min(call, statuses.length - 1)];
    call += 1;
    return new Response(status === 204 ? null : JSON.stringify({ ok: true }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetch, requests };
}

describe("tokenProvider", () => {
  it("is consulted on every request, not pinned at construction", async () => {
    const { fetch, requests } = stubFetch([200]);
    let token = "first";
    const transport = new KaitenTransport({
      authScheme: "bearer",
      apiUrl: "https://example.test/api",
      fetch,
      tokenProvider: () => token,
    });

    await transport.get("/a");
    token = "second";
    await transport.get("/b");

    expect(requests[0].headers.get("Authorization")).toBe("Bearer first");
    // A host that refreshes its session mid-life must not keep sending the stale
    // credential until the provider remounts.
    expect(requests[1].headers.get("Authorization")).toBe("Bearer second");
  });

  it("awaits an async provider", async () => {
    const { fetch, requests } = stubFetch([200]);
    const transport = new KaitenTransport({
      authScheme: "bearer",
      apiUrl: "https://example.test/api",
      fetch,
      tokenProvider: async () => "awaited",
    });

    await transport.get("/a");

    expect(requests[0].headers.get("Authorization")).toBe("Bearer awaited");
  });
});

describe("onAuthError", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fires on 401 and does not retry the rejected credential", async () => {
    const { fetch, requests } = stubFetch([401]);
    const onAuthError = vi.fn();
    const transport = new KaitenTransport({
      authScheme: "bearer",
      apiUrl: "https://example.test/api",
      fetch,
      tokenProvider: () => "stale",
      onAuthError,
    });

    await expect(transport.get("/a")).rejects.toThrow();

    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(onAuthError.mock.calls[0][0]).toMatchObject({ status: 401, operation: "GET /a" });
    // Retrying a rejected credential only burns rate budget.
    expect(requests).toHaveLength(1);
  });

  it("fires on 403", async () => {
    const { fetch } = stubFetch([403]);
    const onAuthError = vi.fn();
    const transport = new KaitenTransport({
      authScheme: "bearer",
      apiUrl: "https://example.test/api",
      fetch,
      tokenProvider: () => "wrong-scope",
      onAuthError,
    });

    await expect(transport.get("/a")).rejects.toThrow();

    expect(onAuthError.mock.calls[0][0]).toMatchObject({ status: 403 });
  });

  it("stays silent on a 500", async () => {
    const { fetch } = stubFetch([500]);
    const onAuthError = vi.fn();
    const transport = new KaitenTransport({
      authScheme: "bearer",
      apiUrl: "https://example.test/api",
      fetch,
      tokenProvider: () => "fine",
      onAuthError,
    });

    await expect(transport.get("/a")).rejects.toThrow();

    expect(onAuthError).not.toHaveBeenCalled();
  });
});

describe("request deadline", () => {
  // Keeps the requests the fake fetch leaves hanging reachable, as a socket
  // would. undici forwards the deadline to a Request's signal through a WeakRef,
  // so a Request that nothing holds can be collected mid-wait, and its abort
  // never arrives.
  const hanging = new Set<Request>();

  it("aborts a hanging request instead of waiting forever", async () => {
    // Without a default, the transport would retry a hanging connection three
    // times with no ceiling — the licensing snapshot never resolving, so a
    // paywall never renders.
    const fetch: KaitenFetch = (input, init) =>
      new Promise((_resolve, reject) => {
        // The deadline rides on the Request the interceptor builds, not on `init`.
        const request = input as Request;
        const signal = init?.signal ?? request.signal;
        // A real fetch rejects on an aborted signal; a listener added after the abort never fires.
        if (signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        hanging.add(request);
        signal?.addEventListener(
          "abort",
          () => {
            hanging.delete(request);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });

    const transport = new KaitenTransport({
      authScheme: "bearer",
      apiUrl: "https://example.test/api",
      fetch,
      timeoutMs: 10,
    });

    await expect(transport.get("/a")).rejects.toThrow();
  });
});
