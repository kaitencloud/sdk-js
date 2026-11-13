// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// What the provider does once a read has failed: what the gates still decide
// on, and when it reads again.
//
// SWR skips a polling tick while its cache holds an error, and leaves it to its
// error retry to clear it. With the retry off, one failed poll was the last read
// a tab made, and every gate under it stayed shut on a snapshot it still held.

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { demoPortal, demoSnapshot } from "@kaitencloud/client/testing";
import {
  KaitenError,
  KaitenNetworkError,
  RateLimitedError,
  type KaitenClientLike,
  type KaitenSessionClientLike,
  type LicensingSnapshot,
} from "@kaitencloud/client";

import {
  Gate,
  KaitenFailed,
  KaitenLoaded,
  KaitenLoading,
  KaitenProvider,
  Show,
  useLicensingSnapshot,
  usePlans,
  type KaitenProviderProps,
} from "../src/index.ts";
import {
  DEFAULT_STALE_IF_ERROR_MS,
  READ_RETRY_FIRST_MS,
  READ_RETRY_SLOWEST_MS,
  readRetryDelay,
} from "../src/providers/provider-read.ts";
import { FAKE_TIMERS, settle } from "./support/billing.tsx";

const POLL = 60_000;
const OUTAGE = "502 from the gateway";

// A customer per provider: the scope key prefixes every SWR key, which keeps one
// test's cache out of the next one's. Counted, since `Math.random` is pinned below.
let customers = 0;

beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  // The middle of the jitter: a retry waits exactly its nominal delay.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  cleanup();
  // What a test that hid the tab or went offline left behind.
  Reflect.deleteProperty(document, "visibilityState");
  window.dispatchEvent(new Event("online"));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** An API a test takes down, brings back, and holds an answer of. */
function fakeApi(down: Error | (() => Error) | null = null) {
  let held: Promise<void> | null = null;
  const api = {
    /** What a read is refused with, or what makes the error of each read, `null` when the API answers. */
    down,
    /** Holds every read from now on, until the function it returns is called. */
    hold() {
      let release = () => {};
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        held = null;
        release();
      };
    },
    /** One read: held if the test holds them, then answered or refused as the API is by then. */
    async answer<T>(data: T): Promise<T> {
      await held;
      if (api.down) throw typeof api.down === "function" ? api.down() : api.down;
      return data;
    },
  };
  return api;
}

/** Everything a host hangs on the provider's data: the three states, two switches, a gate. */
const TREE = (
  <>
    <KaitenLoading>
      <span data-testid="loading" />
    </KaitenLoading>
    <KaitenLoaded>
      <span data-testid="loaded" />
    </KaitenLoaded>
    <KaitenFailed>
      {({ retry }) => <button type="button" data-testid="failed" onClick={retry} />}
    </KaitenFailed>
    {/* `tokens` is at 31% of its limit in the demo data: granted, and far from the wall. */}
    <Show
      when="entitled"
      entitlement="tokens"
      loading={<span data-testid="show-loading" />}
      fallback={<span data-testid="show-fallback" />}
    >
      <span data-testid="show-content" />
    </Show>
    <Show when="entitled" entitlement="tokens" onError="allow">
      <span data-testid="allowed" />
    </Show>
    <Gate entitlement="tokens">
      {(state) => (
        <span
          data-testid="gate"
          data-blocked={String(state.blocked)}
          data-reason={state.reason ?? ""}
          data-error={state.error?.message ?? ""}
        />
      )}
    </Gate>
    <Refetch />
  </>
);

function Refetch() {
  const { refetch } = useLicensingSnapshot();
  return <button type="button" data-testid="refetch" onClick={refetch} />;
}

/** What a customer sees, and what the gate reports, in one value. */
function seen() {
  const gate = screen.getByTestId("gate").dataset;
  return {
    loading: screen.queryByTestId("loading") !== null,
    loaded: screen.queryByTestId("loaded") !== null,
    failed: screen.queryByTestId("failed") !== null,
    show: screen.queryByTestId("show-content")
      ? "content"
      : screen.queryByTestId("show-loading")
        ? "loading"
        : "fallback",
    // The switch that fails open: its content, whatever the reason it shows.
    allowed: screen.queryByTestId("allowed") !== null,
    blocked: gate.blocked,
    reason: gate.reason,
    error: gate.error,
  };
}

/** Data is held and decides: nothing is in the customer's way. */
const OPEN = {
  loading: false,
  loaded: true,
  failed: false,
  show: "content",
  allowed: true,
  blocked: "false",
  reason: "",
  error: "",
};

/** Nothing to decide on: the fail policy of each gate applies. */
const CLOSED = {
  loading: false,
  loaded: false,
  failed: true,
  show: "fallback",
  allowed: true,
  blocked: "true",
  reason: "error",
  error: OUTAGE,
};

type AuthenticatedProps = Extract<KaitenProviderProps, { mode: "authenticated" }>;
type HarnessProps = Partial<Pick<AuthenticatedProps, "staleIfErrorMs" | "polling" | "initialData">>;

/** One customer over a fake API, and the authenticated providers a test mounts on it. */
function scope(down?: Error) {
  const api = fakeApi(down);
  const getLicensingSnapshot = vi.fn((): Promise<LicensingSnapshot> => api.answer(demoSnapshot()));
  const client = {
    getCatalog: vi.fn(async () => ({ plans: [], entitlements: [] })),
    getLicensingSnapshot,
  } as unknown as KaitenClientLike;
  const customerId = `cust-recovery-${customers++}`;

  return {
    api,
    reads: () => getLicensingSnapshot.mock.calls.length,
    /** A provider of that customer, which polls every minute. */
    provider: (props: HarnessProps = {}, children: ReactNode = TREE) => (
      <KaitenProvider
        mode="authenticated"
        accessToken="t"
        customerId={customerId}
        polling={{ interval: POLL }}
        client={client}
        {...props}
      >
        {children}
      </KaitenProvider>
    ),
  };
}

/** One such provider, mounted. */
function harness(options: { down?: Error; props?: HarnessProps; children?: ReactNode } = {}) {
  const { api, reads, provider } = scope(options.down);
  const view = render(provider(options.props, options.children));

  return {
    api,
    reads,
    /** The same provider, of the same customer, with other props. */
    update: (props: HarnessProps) => view.rerender(provider(props, options.children)),
    unmount: view.unmount,
  };
}

/** A provider that read once, and whose next poll then failed: two reads, and one retry owed. */
async function afterOneFailedPoll(options: Parameters<typeof harness>[0] = {}, error?: Error) {
  const view = harness(options);
  await settle();
  expect(seen()).toEqual(OPEN);

  view.api.down = error ?? new Error(OUTAGE);
  await settle(POLL);
  expect(view.reads()).toBe(2);
  return view;
}

// ---------------------------------------------------------------------------
// The data a read left still decides
// ---------------------------------------------------------------------------

describe("a read that fails after one that succeeded", () => {
  test("leaves the gates deciding on what was read", async () => {
    await afterOneFailedPoll();

    // The snapshot is still held: the customer keeps what it grants, and the
    // failure is reported beside the decision instead of replacing it.
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });
  });

  test("leaves a wall and a warning as the data has them, with the failure beside", async () => {
    // In the demo data `api_calls` is used up, and `seats` is past the warning threshold.
    const walls = ["api_calls", "seats"].map((slug) => (
      <Gate key={slug} entitlement={slug}>
        {(state) => (
          <span
            data-testid={slug}
            data-blocked={String(state.blocked)}
            data-reason={state.reason ?? ""}
            data-error={state.error?.message ?? ""}
          />
        )}
      </Gate>
    ));
    const wall = (slug: string) => {
      const { blocked, reason, error } = screen.getByTestId(slug).dataset;
      return { blocked, reason, error };
    };
    const { api } = harness({ children: walls });
    await settle();
    expect(wall("api_calls")).toEqual({ blocked: "true", reason: "over_limit", error: "" });
    expect(wall("seats")).toEqual({ blocked: "false", reason: "near_limit", error: "" });

    api.down = new Error(OUTAGE);
    await settle(POLL);

    // Neither turns into the wall of an outage: each says what the snapshot says, and why
    // the snapshot is not newer.
    expect(wall("api_calls")).toEqual({
      blocked: "true",
      reason: "over_limit",
      error: OUTAGE,
    });
    expect(wall("seats")).toEqual({ blocked: "false", reason: "near_limit", error: OUTAGE });
  });

  test("is made again on its own, and the polling carries on once one succeeds", async () => {
    const { api, reads } = await afterOneFailedPoll();

    // Five seconds, then ten: the delay grows while the API stays down.
    await settle(4_999);
    expect(reads()).toBe(2);
    await settle(1);
    expect(reads()).toBe(3);
    await settle(10_000);
    expect(reads()).toBe(4);

    // The API is back for the next one, twenty seconds later.
    api.down = null;
    await settle(20_000);
    expect(reads()).toBe(5);
    expect(seen()).toEqual(OPEN);

    // And the schedule is back with it: a read a minute.
    await settle(POLL);
    expect(reads()).toBe(6);
  });

  test("decides for an hour by default, then the gates apply their fail policy", async () => {
    const { reads } = await afterOneFailedPoll();

    // The retries of the hour: at 5 s, 15 s, 35 s, 75 s, 155 s and 315 s after the first
    // failure, then every five minutes. The eleventh of those is the last one within the hour.
    await settle(315_000 + 10 * READ_RETRY_SLOWEST_MS);
    expect(reads()).toBe(2 + 6 + 10);
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });

    // The next one fails 3,615 seconds after the first: past the hour, the data is let go.
    await settle(READ_RETRY_SLOWEST_MS);
    expect(reads()).toBe(2 + 6 + 11);
    expect(seen()).toEqual(CLOSED);
    expect(DEFAULT_STALE_IF_ERROR_MS).toBe(3_600_000);
  });

  test("decides for as long as the host says, and again as soon as a read succeeds", async () => {
    const { api, reads } = await afterOneFailedPoll({ props: { staleIfErrorMs: 30_000 } });

    // Fifteen seconds of failures: within the thirty the host allows.
    await settle(15_000);
    expect(reads()).toBe(4);
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });

    // The read that fails at thirty-five seconds is past them.
    await settle(20_000);
    expect(reads()).toBe(5);
    expect(seen()).toEqual(CLOSED);

    api.down = null;
    await settle(40_000);
    expect(reads()).toBe(6);
    expect(seen()).toEqual(OPEN);
  });

  test("applies the fail policy at once when the host allows no delay", async () => {
    await afterOneFailedPoll({ props: { staleIfErrorMs: 0 } });

    expect(seen()).toEqual(CLOSED);
  });

  test("applies the delay the host allows now, not the one it allowed at first", async () => {
    const { reads, update } = await afterOneFailedPoll({ props: { staleIfErrorMs: Infinity } });
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });

    update({ staleIfErrorMs: 0 });
    await settle(READ_RETRY_FIRST_MS);
    expect(reads()).toBe(3);
    expect(seen()).toEqual(CLOSED);
  });

  test("never applies it when the host allows any delay", async () => {
    const { reads } = await afterOneFailedPoll({ props: { staleIfErrorMs: Infinity } });

    await settle(24 * 3_600_000);
    expect(reads()).toBeGreaterThan(250);
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });
  });
});

// ---------------------------------------------------------------------------
// A first read that fails
// ---------------------------------------------------------------------------

describe("a first read that fails", () => {
  test("is made again on its own, without showing as loading while it is", async () => {
    const { api, reads } = harness({ down: new Error(OUTAGE) });
    await settle();
    expect(reads()).toBe(1);
    expect(seen()).toEqual(CLOSED);

    // The retry is in flight. A gate is open while its data loads: were this read to show
    // as loading, every retry of an outage would open the gates for as long as it lasts.
    api.down = null;
    const release = api.hold();
    await settle(READ_RETRY_FIRST_MS);
    expect(reads()).toBe(2);
    expect(seen()).toEqual(CLOSED);

    release();
    await settle();
    expect(seen()).toEqual(OPEN);
  });

  test("shows as loading when the host asks for it again", async () => {
    const { api, reads } = harness({ down: new Error(OUTAGE) });
    await settle();
    expect(seen()).toEqual(CLOSED);

    api.down = null;
    const release = api.hold();
    fireEvent.click(screen.getByTestId("failed"));
    await settle();
    expect(reads()).toBe(2);
    // What a host's retry button has always shown: the read is in flight, over the failure
    // that is still the last answer.
    expect(seen()).toEqual({
      loading: true,
      loaded: false,
      failed: true,
      show: "loading",
      allowed: false,
      blocked: "false",
      reason: "",
      error: "",
    });

    release();
    await settle();
    expect(seen()).toEqual(OPEN);
  });
});

// ---------------------------------------------------------------------------
// When the next read is made
// ---------------------------------------------------------------------------

describe("the wait before a failed read is made again", () => {
  const delays = (error: unknown, failures: number[]) =>
    failures.map((count) => readRetryDelay(count, error, 0.5));

  test("doubles from five seconds to five minutes, and stops growing there", () => {
    expect(delays(new Error(OUTAGE), [1, 2, 3, 4, 5, 6, 7, 8, 500])).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
    expect(READ_RETRY_FIRST_MS).toBe(5_000);
    expect(READ_RETRY_SLOWEST_MS).toBe(300_000);
  });

  test("moves by up to a fifth either way", () => {
    expect(readRetryDelay(1, new Error(OUTAGE), 0)).toBe(4_000);
    expect(readRetryDelay(1, new Error(OUTAGE), 1)).toBe(6_000);
    expect(readRetryDelay(9, new Error(OUTAGE), 0)).toBe(240_000);
    expect(readRetryDelay(9, new Error(OUTAGE), 1)).toBe(360_000);
  });

  test("is the short one for an outage: no answer, a 5xx, a timeout, too many calls", () => {
    const outages = [
      new Error(OUTAGE),
      new KaitenNetworkError("Network error during getLicensingSnapshot()"),
      new KaitenError({ title: "Internal Server Error", status: 500 }),
      new KaitenError({ title: "Bad Gateway", status: 502 }),
      new KaitenError({ title: "Service Unavailable", status: 503 }),
      new KaitenError({ title: "Request Timeout", status: 408 }),
      new KaitenError({ title: "Too Many Requests", status: 429 }),
    ];
    for (const error of outages) expect(delays(error, [1, 2])).toEqual([5_000, 10_000]);
  });

  test("is five minutes from the first for an answer that refuses", () => {
    const refusals = [
      new KaitenError({ title: "Unauthorized", status: 401 }),
      new KaitenError({ title: "Forbidden", status: 403 }),
      new KaitenError({ title: "Not Found", status: 404, code: "Customer.NotFound" }),
      new KaitenError({ title: "Unprocessable Entity", status: 422 }),
      // A refusal the client makes itself, before any request.
      new KaitenError({ title: "Secret credential used in a browser", status: 0 }),
    ];
    for (const error of refusals) expect(delays(error, [1, 2])).toEqual([300_000, 300_000]);
  });

  test("is never shorter than the Retry-After the API sent", () => {
    const limited = (seconds: number) =>
      new RateLimitedError(
        { title: "Too Many Requests", status: 429, code: "PublicAuth.RateLimited" },
        { retryAfterSeconds: seconds },
      );
    expect(delays(limited(90), [1, 2])).toEqual([90_000, 90_000]);
    // A Retry-After shorter than the wait changes nothing.
    expect(delays(limited(2), [1, 2])).toEqual([5_000, 10_000]);
    // Past five minutes too: the API said when.
    expect(delays(limited(900), [1])).toEqual([900_000]);
  });

  test("a read refused for too many calls waits for the delay the API asked for", async () => {
    const limited = new RateLimitedError(
      { title: "Too Many Requests", status: 429, code: "PublicAuth.RateLimited" },
      { retryAfterSeconds: 17 },
    );
    const { reads } = await afterOneFailedPoll({}, limited);

    await settle(16_999);
    expect(reads()).toBe(2);
    await settle(1);
    expect(reads()).toBe(3);
  });

  test("a read the API refuses is asked again at the pace of a poll, and no sooner", async () => {
    const unauthorized = new KaitenError({ title: "Unauthorized", status: 401 });
    const { api, reads } = await afterOneFailedPoll({}, unauthorized);

    // Four polling ticks go by, and read nothing: SWR skips them while the error stands.
    await settle(READ_RETRY_SLOWEST_MS - 1);
    expect(reads()).toBe(2);

    // The host has a new token by now: the read picks it up.
    api.down = null;
    await settle(1);
    expect(reads()).toBe(3);
    expect(seen()).toEqual(OPEN);
  });

  test("starts over once a read has succeeded: five seconds again, and a whole delay to decide in", async () => {
    const { api, reads } = await afterOneFailedPoll({ props: { staleIfErrorMs: 30_000 } });

    // Two retries fail, at five and fifteen seconds; the third, at thirty-five, succeeds.
    await settle(15_000);
    expect(reads()).toBe(4);
    api.down = null;
    await settle(20_000);
    expect(reads()).toBe(5);
    expect(seen()).toEqual(OPEN);

    // The next poll fails, a minute after the first failure. It is the first since a read
    // succeeded: the thirty seconds the host allows are counted from it, not from the other.
    api.down = new Error(OUTAGE);
    await settle(25_000);
    expect(reads()).toBe(6);
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });

    // And it is read again after five seconds, not after the forty a fourth failure waits.
    await settle(READ_RETRY_FIRST_MS - 1);
    expect(reads()).toBe(6);
    await settle(1);
    expect(reads()).toBe(7);
  });

  test("a refetch that fails while a retry is pending adds no second one", async () => {
    const { reads } = await afterOneFailedPoll();

    await settle(1_000);
    fireEvent.click(screen.getByTestId("refetch"));
    await settle();
    expect(reads()).toBe(3);

    // The retry that was pending is made at its five seconds.
    await settle(3_999);
    expect(reads()).toBe(3);
    await settle(1);
    expect(reads()).toBe(4);

    // Three reads failed in a row, so the next wait is twenty seconds. A second chain, started
    // by the refetch, would have read ten seconds after it.
    await settle(19_999);
    expect(reads()).toBe(4);
    await settle(1);
    expect(reads()).toBe(5);
  });

  test("a refetch that succeeds drops the retry that was pending", async () => {
    const { api, reads } = await afterOneFailedPoll();

    api.down = null;
    await settle(1_000);
    fireEvent.click(screen.getByTestId("refetch"));
    await settle();
    expect(reads()).toBe(3);
    expect(seen()).toEqual(OPEN);

    // Nothing at the five seconds the retry was due at: only the next poll reads.
    await settle(POLL - 1_001);
    expect(reads()).toBe(3);
    await settle(1);
    expect(reads()).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// A failure the provider did not see
// ---------------------------------------------------------------------------

describe("a read that failed before the provider could see it", () => {
  test("is made again by a provider that mounts on it with data of its own", async () => {
    const { api, reads, provider } = scope();
    const first = render(provider());
    await settle();
    api.down = new Error(OUTAGE);
    await settle(POLL);
    expect(reads()).toBe(2);
    first.unmount();

    // The page comes back with a snapshot its server read, so nothing is read on mount. The
    // failure is still in the cache, where SWR skips every poll for it, and the retry that
    // was owed went with the provider that had seen it.
    api.down = null;
    render(provider({ initialData: { snapshot: demoSnapshot() } }));
    await settle();
    expect(reads()).toBe(2);
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });

    await settle(READ_RETRY_FIRST_MS - 1);
    expect(reads()).toBe(2);
    await settle(1);
    expect(reads()).toBe(3);
    expect(seen()).toEqual(OPEN);

    // And the polling is back with it.
    await settle(POLL);
    expect(reads()).toBe(4);
  });

  test("is made again by a second provider of the scope once the first, which had the retry, is gone", async () => {
    const { api, reads, provider } = scope();
    const first = render(provider({}, null));
    render(provider());
    await settle();
    expect(reads()).toBe(1);

    // SWR hands the failure of a poll to the provider that made it, the first. The second
    // arms a read of its own: both read five seconds later.
    api.down = new Error(OUTAGE);
    await settle(POLL);
    expect(reads()).toBe(2);
    await settle(READ_RETRY_FIRST_MS + 1_000);
    expect(reads()).toBe(4);

    // The first goes, and its retries with it. The second has none pending: it finds out at
    // its next look, five minutes after the failure, and reads five seconds later.
    first.unmount();
    api.down = null;
    await settle(READ_RETRY_SLOWEST_MS - 1_001);
    expect(reads()).toBe(4);
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });
    await settle(READ_RETRY_FIRST_MS);
    expect(reads()).toBe(5);
    expect(seen()).toEqual(OPEN);
  });

  test("is not made again by the second provider at every failure the first one has", async () => {
    const { api, reads, provider } = scope();
    render(provider({}, null));
    render(provider());
    await settle();

    // Each read fails with an error of its own, as a real client's do: a second provider that
    // armed a read for every error it is shown would read every five seconds for as long as
    // the API is down.
    api.down = () => new Error(OUTAGE);
    await settle(POLL);
    expect(reads()).toBe(2);

    // Forty seconds of outage: both read at five seconds, then the first alone at fifteen.
    // Its next wait is forty seconds, since it counts the read the second one made.
    await settle(40_000);
    expect(reads()).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// A tab that cannot read
// ---------------------------------------------------------------------------

describe("a tab that is hidden or offline", () => {
  function show(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  test("is not read for a retry while hidden, and is read at once when shown again", async () => {
    const { api, reads } = await afterOneFailedPoll();

    show("hidden");
    await settle(READ_RETRY_FIRST_MS);
    expect(reads()).toBe(2);
    await settle(2 * 3_600_000);
    expect(reads()).toBe(2);
    // Two hours on, the data is past its hour, and still decides: nothing closes it but a
    // read that fails, and a hidden tab makes none.
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });

    api.down = null;
    show("visible");
    await settle();
    expect(reads()).toBe(3);
    expect(seen()).toEqual(OPEN);
  });

  test("lets the data go when the read it makes on being shown again fails past the delay", async () => {
    const { reads } = await afterOneFailedPoll();

    show("hidden");
    await settle(2 * 3_600_000);
    show("visible");
    await settle();
    expect(reads()).toBe(3);
    expect(seen()).toEqual(CLOSED);
  });

  test("is not read for a retry while offline, and is read at once when online again", async () => {
    const { api, reads } = await afterOneFailedPoll();

    window.dispatchEvent(new Event("offline"));
    await settle(10 * READ_RETRY_SLOWEST_MS);
    expect(reads()).toBe(2);

    api.down = null;
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(reads()).toBe(3);
    expect(seen()).toEqual(OPEN);
  });

  test("keeps waiting when it is shown again but still offline", async () => {
    const { api, reads } = await afterOneFailedPoll();

    show("hidden");
    window.dispatchEvent(new Event("offline"));
    await settle(READ_RETRY_FIRST_MS);
    show("visible");
    await settle();
    expect(reads()).toBe(2);

    api.down = null;
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(reads()).toBe(3);
  });

  test("drops the wait when a read the host asked for succeeds meanwhile", async () => {
    const { api, reads } = await afterOneFailedPoll();

    show("hidden");
    await settle(READ_RETRY_FIRST_MS);
    api.down = null;
    fireEvent.click(screen.getByTestId("refetch"));
    await settle();
    expect(reads()).toBe(3);
    expect(seen()).toEqual(OPEN);

    // Shown again, the tab owes no read: the one it waited to make is not needed any more.
    show("visible");
    await settle();
    expect(reads()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// A provider that is gone
// ---------------------------------------------------------------------------

describe("a provider that unmounts", () => {
  // A retry left behind would read nothing, since SWR has nobody to read for: what tells it
  // from none is the timer itself.
  test("drops the retry it had pending", async () => {
    const { reads, unmount } = await afterOneFailedPoll();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await settle(2 * 3_600_000);
    expect(reads()).toBe(2);
  });

  test("starts none for a read that fails after it left", async () => {
    const { api, reads, unmount } = harness();
    await settle();

    // The poll is in flight when the provider goes, and fails after.
    api.down = new Error(OUTAGE);
    const release = api.hold();
    await settle(POLL);
    expect(reads()).toBe(2);
    unmount();
    release();
    await settle();

    expect(vi.getTimerCount()).toBe(0);
    await settle(2 * 3_600_000);
    expect(reads()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The other reads
// ---------------------------------------------------------------------------

describe("the reads of the other modes", () => {
  test("a customer session's gates keep deciding on the portal that was read", async () => {
    const api = fakeApi();
    const getPortal = vi.fn(() => api.answer(demoPortal()));
    const sessionClient = { getPortal } as unknown as KaitenSessionClientLike;

    render(
      <KaitenProvider
        mode="customer-session"
        sessionClient={sessionClient}
        apiUrl={`https://kaiten.test/api/${customers++}`}
        polling={{ interval: POLL }}
      >
        {TREE}
      </KaitenProvider>,
    );
    await settle();
    expect(seen()).toEqual(OPEN);

    api.down = new Error(OUTAGE);
    await settle(POLL);
    expect(getPortal).toHaveBeenCalledTimes(2);
    expect(seen()).toEqual({ ...OPEN, error: OUTAGE });

    api.down = null;
    await settle(READ_RETRY_FIRST_MS);
    expect(getPortal).toHaveBeenCalledTimes(3);
    expect(seen()).toEqual(OPEN);
  });

  test("a public provider keeps the catalog it read, and reads it again on its own", async () => {
    const api = fakeApi();
    const getCatalog = vi.fn(() => api.answer({ plans: [], entitlements: [] }));
    const client = { getCatalog } as unknown as KaitenClientLike;

    function Plans() {
      const plans = usePlans();
      return (
        <button
          type="button"
          data-testid="plans"
          data-error={plans.error?.message ?? ""}
          onClick={plans.refetch}
        />
      );
    }

    render(
      <KaitenProvider mode="public" publishableKey={`pk_recovery_${customers++}`} client={client}>
        <KaitenLoaded>
          <span data-testid="loaded" />
        </KaitenLoaded>
        <KaitenFailed>
          <span data-testid="failed" />
        </KaitenFailed>
        <Plans />
      </KaitenProvider>,
    );
    await settle();
    expect(screen.queryByTestId("loaded")).not.toBeNull();

    // A public provider does not poll: the read that fails is one the host asked for.
    api.down = new Error(OUTAGE);
    fireEvent.click(screen.getByTestId("plans"));
    await settle();
    expect(getCatalog).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("plans").dataset.error).toBe(OUTAGE);
    expect(screen.queryByTestId("loaded")).not.toBeNull();
    expect(screen.queryByTestId("failed")).toBeNull();

    api.down = null;
    await settle(READ_RETRY_FIRST_MS);
    expect(getCatalog).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("plans").dataset.error).toBe("");
  });
});
