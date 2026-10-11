import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient, KaitenError, RateLimitedError, retry } from "../src/index.ts";
import { answer, refusal } from "./support/session-answers.ts";
import { json, open, T0 } from "./support/session-harness.ts";

// A call the client already replays (a read, a usage report under a key) waits
// for the `Retry-After` of the refusal before it does, up to a cap. A call it
// never replays is not touched, and its error says how long the API asked.

const CAP_MS = 30_000;

beforeEach(() => {
  // Timers are faked too: the delay between two attempts is what is measured.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

const unavailable = (headers: Record<string, string> = {}) =>
  json({ title: "Service Unavailable", status: 503, code: "Test.503" }, 503, headers);

/** How many requests a server has seen after letting `ms` of fake time pass. */
async function after(ms: number, requests: readonly unknown[]): Promise<number> {
  await vi.advanceTimersByTimeAsync(ms);
  return requests.length;
}

describe("a customer session read waits for Retry-After", () => {
  test("for as long as it says, not for the backoff", async () => {
    const { client, requests } = open((_request, index) =>
      index === 0 ? unavailable({ "Retry-After": "7" }) : json(answer("portalCustomerWide")),
    );

    const portal = client.getPortal();

    expect(await after(6_999, requests)).toBe(1);
    expect(await after(1, requests)).toBe(2);
    expect((await portal).customer.slug).toBe("initech");
  });

  test("an HTTP date counts from now", async () => {
    const at = new Date(T0 + 12_000).toUTCString();
    const { client, requests } = open((_request, index) =>
      index === 0 ? unavailable({ "Retry-After": at }) : json(answer("portalCustomerWide")),
    );

    const portal = client.getPortal();

    expect(await after(11_999, requests)).toBe(1);
    expect(await after(1, requests)).toBe(2);
    await portal;
  });

  test("0 sends it again at once", async () => {
    const { client, requests } = open((_request, index) =>
      index === 0 ? unavailable({ "Retry-After": "0" }) : json(answer("portalCustomerWide")),
    );

    const portal = client.getPortal();

    expect(await after(0, requests)).toBe(2);
    await portal;
  });

  test("never for more than the cap", async () => {
    const { client, requests } = open((_request, index) =>
      index === 0 ? unavailable({ "Retry-After": "3600" }) : json(answer("portalCustomerWide")),
    );

    const portal = client.getPortal();

    expect(await after(CAP_MS - 1, requests)).toBe(1);
    expect(await after(1, requests)).toBe(2);
    await portal;
  });

  test("each retry has its own wait, and a third failure is thrown with the last one", async () => {
    const { client, requests } = open((_request, index) =>
      unavailable({ "Retry-After": index === 0 ? "2" : "5" }),
    );

    const portal = client.getPortal().catch((thrown: unknown) => thrown);

    expect(await after(1_999, requests)).toBe(1);
    expect(await after(1, requests)).toBe(2);
    expect(await after(4_999, requests)).toBe(2);
    expect(await after(1, requests)).toBe(3);
    const error = await portal;
    expect(error).toMatchObject({ status: 503, retryAfterSeconds: 5 });
    expect(requests).toHaveLength(3);
  });

  test("without one, it backs off as it did", async () => {
    const { client, requests } = open((_request, index) =>
      index === 0 ? unavailable() : json(answer("portalCustomerWide")),
    );

    const portal = client.getPortal();

    // The first retry waits about 100 ms, up to twice that with its jitter.
    expect(await after(250, requests)).toBe(2);
    await portal;
  });

  test("a provider that is down, with no header to read, backs off as it did", async () => {
    const { body } = refusal("checkoutProviderUnavailable");
    const { client, requests } = open((_request, index) =>
      index === 0
        ? json({ ...body, code: "GetSessionPortal.ProviderUnavailable" }, 503)
        : json(answer("portalCustomerWide")),
    );

    const portal = client.getPortal();

    // The error reports 60 seconds, a default and not what the API said, so the
    // retry does not wait for it.
    expect(await after(250, requests)).toBe(2);
    await portal;
  });

  test("a read refused 429 is not sent again, however short the wait", async () => {
    const { body } = refusal("voucherRateLimited");
    const { client, requests } = open(() =>
      json({ ...body, code: "PublicAuth.RateLimited" }, 429, { "Retry-After": "1" }),
    );

    const portal = client.getPortal().catch((thrown: unknown) => thrown);
    await vi.advanceTimersByTimeAsync(CAP_MS);

    expect(await portal).toBeInstanceOf(RateLimitedError);
    expect(requests).toHaveLength(1);
  });
});

describe("a write is never sent again, whatever the wait", () => {
  test.each([
    [409, "CancelSessionSubscription.BoundaryPending", "60"],
    [422, "CreateSessionCheckout.QuotaExceeded", "0"],
    [429, "ValidateSessionVoucher.RateLimited", "1"],
    [503, "CreateSessionCheckout.ProviderUnavailable", "0"],
  ])("%i %s, Retry-After %s", async (status, code, wait) => {
    const { client, requests } = open(() =>
      json({ title: "Refused", status, code }, status, { "Retry-After": wait }),
    );

    const cancelled = client.cancelSubscription().catch((thrown: unknown) => thrown);
    await vi.advanceTimersByTimeAsync(2 * CAP_MS);

    expect(await cancelled).toBeInstanceOf(KaitenError);
    expect(requests).toHaveLength(1);
  });
});

describe("KaitenClient waits too, for the calls it already sends again", () => {
  const USAGE = {
    entitlementId: "0b6d0c1e-4f5c-4c8e-9d61-0f6a8d7f7a01",
    entitlementSlug: "tokens",
    licenseId: "6f1f9a54-2a4b-4d0e-8c1d-5b0a2f3e4d02",
    licenseSlug: "pro",
    value: { type: "number", value: 500, eventCount: 1 },
    limit: { type: "number", value: 1000 },
    currentPeriodStart: "2026-10-01T00:00:00Z",
    currentPeriodEnd: "2026-11-01T00:00:00Z",
  };
  const CATALOG = {
    plans: [],
    addOns: [],
    capabilities: { checkout: false, paymentMethods: false },
  };

  /** A client over a fetch double that records each request and answers with `reply`. */
  function server(
    config: ConstructorParameters<typeof KaitenClient>[0],
    reply: (index: number) => Response,
  ) {
    const requests: Request[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(input instanceof Request ? input : new Request(input, init));
      return reply(requests.length - 1);
    });
    return { client: new KaitenClient({ ...config, fetch, timeoutMs: 0 }), requests };
  }

  const report = {
    value: { type: "number", value: 500 },
    behavior: "append",
  } as const;

  test("a usage report under a key, refused 503, goes again after the wait with the same key", async () => {
    const { client, requests } = server(
      { apiUrl: "https://api.test", authScheme: "none" },
      (index) => (index === 0 ? unavailable({ "Retry-After": "5" }) : json(USAGE)),
    );

    const sent = client.reportUsage("acme-prod", "tokens", {
      ...report,
      transactionId: "llm:9f2c:tokens",
    });

    expect(await after(4_999, requests)).toBe(1);
    expect(await after(1, requests)).toBe(2);
    await sent;
    const bodies = await Promise.all(requests.map((request) => request.clone().json()));
    expect(bodies.map((body) => (body as { transactionId: string }).transactionId)).toEqual([
      "llm:9f2c:tokens",
      "llm:9f2c:tokens",
    ]);
  });

  test("a usage report without a key is sent once, whatever the wait", async () => {
    const { client, requests } = server({ apiUrl: "https://api.test", authScheme: "none" }, () =>
      unavailable({ "Retry-After": "0" }),
    );

    const sent = client
      .reportUsage("acme-prod", "tokens", report)
      .catch((thrown: unknown) => thrown);
    await vi.advanceTimersByTimeAsync(2 * CAP_MS);

    expect(await sent).toMatchObject({ status: 503, retryAfterSeconds: 0 });
    expect(requests).toHaveLength(1);
  });

  test("a catalogue read with a publishable key waits for the provider", async () => {
    const { body } = refusal("checkoutProviderUnavailable");
    const { client, requests } = server(
      {
        apiUrl: "https://api.test",
        authScheme: "publishable",
        tokenProvider: () => `pk_${"a".repeat(43)}`,
      },
      (index) =>
        index === 0
          ? json({ ...body, code: "GetPublicCatalog.ProviderUnavailable" }, 503, {
              "Retry-After": "9",
            })
          : json(CATALOG),
    );

    const catalog = client.getCatalog();

    expect(await after(8_999, requests)).toBe(1);
    expect(await after(1, requests)).toBe(2);
    await catalog;
  });
});

describe("retry() with delayOf", () => {
  const failing = (failures: number) => {
    let calls = 0;
    return vi.fn(async () => {
      if (calls++ < failures) throw new Error("again");
      return calls;
    });
  };

  test("waits as long as the error asks, instead of the first quick retry", async () => {
    const callback = failing(1);
    const done = retry(callback, {
      retryImmediately: true,
      shouldRetry: () => true,
      delayOf: () => 5_000,
    });

    expect(await after(4_999, callback.mock.calls)).toBe(1);
    expect(await after(1, callback.mock.calls)).toBe(2);
    expect(await done).toBe(2);
  });

  test("backs off as usual where it returns undefined", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const callback = failing(2);
    const done = retry(callback, {
      shouldRetry: () => true,
      delayOf: (_error) => undefined,
    });

    // 125 ms, then 250 ms.
    expect(await after(124, callback.mock.calls)).toBe(1);
    expect(await after(1, callback.mock.calls)).toBe(2);
    expect(await after(249, callback.mock.calls)).toBe(2);
    expect(await after(1, callback.mock.calls)).toBe(3);
    await done;
  });
});
