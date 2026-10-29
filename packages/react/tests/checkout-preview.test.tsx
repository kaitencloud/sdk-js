// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// What is due today, from the server: a checkout's `dryRun`, asked when a selection has stood
// still for 300 ms. The session is a double that answers what the test scripts, so what is
// pinned is what the hook does with the answers: it shows the server's total, never a sum, it
// keeps the summary it had when a voucher is refused, and it asks nothing it need not.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { CheckoutInput, CheckoutResult } from "@kaitencloud/client";

import {
  useCheckoutPreview,
  type CheckoutPreviewSelection,
  type CheckoutPreviewState,
} from "../src/billing.ts";
import {
  billingEmailRequired,
  callsOf,
  FAKE_TIMERS,
  line,
  previewOf,
  providerUnavailable,
  quotaExceeded,
  sessionProvider,
  settle,
  trialPreview,
  unsubscribedSession,
  voucherInvalid,
} from "./support/billing.tsx";

const PRO = "price_pro_monthly";
const GROWTH = "price_growth_monthly";

const selection = (patch: Partial<CheckoutPreviewSelection> = {}): CheckoutPreviewSelection => ({
  licensePriceId: PRO,
  addOns: {},
  voucherCode: "",
  skipTrial: false,
  billingEmail: "",
  ...patch,
});

beforeEach(() => {
  // The timers a debounce is made of, and the clock. Frames and microtasks stay real, which
  // is what the provider's own reads need.
  vi.useFakeTimers(FAKE_TIMERS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The answers of a checkout's `dryRun`, by what it was asked, with each request kept. */
function scripted(answer: (input: CheckoutInput) => CheckoutResult | Error) {
  const requests: CheckoutInput[] = [];
  const client = unsubscribedSession({
    checkout: (input) => {
      requests.push(input);
      const result = answer(input);
      if (result instanceof Error) throw result;
      return result;
    },
  });
  return { client, requests };
}

/** Renders the hook on a selection a test can change, and lets what is pending settle. */
async function mount(
  client: ReturnType<typeof scripted>["client"],
  first: CheckoutPreviewSelection | null,
  options: { paused?: boolean } = {},
) {
  let current = first;
  const settings = options;
  const view = renderHook(() => useCheckoutPreview(current, settings), {
    wrapper: sessionProvider(client),
  });
  await settle();
  return {
    view,
    pause: (paused: boolean) => {
      settings.paused = paused;
      view.rerender();
    },
    change: async (next: CheckoutPreviewSelection | null, wait = 0) => {
      current = next;
      view.rerender();
      if (wait) await settle(wait);
    },
    get state(): CheckoutPreviewState {
      return view.result.current;
    },
  };
}

test("with no price chosen there is nothing to price, and nothing is asked", async () => {
  const { client, requests } = scripted(() => previewOf(4900));
  const probe = await mount(client, selection({ licensePriceId: null }));

  await settle(1_000);
  expect(probe.state).toMatchObject({
    status: "idle",
    data: null,
    voucher: "none",
    isStale: false,
  });
  expect(requests).toHaveLength(0);

  // A null selection is a component that was handed its summary: it asks nothing either.
  await probe.change(null);
  await settle(1_000);
  expect(requests).toHaveLength(0);
});

test("the first selection is asked at once, as a dry run, and the summary is the server's", async () => {
  const lines = [line(1, "BASE", "Monthly", 4900), line(2, "ADDON", "Extra seat × 2", 2000)];
  // The lines sum to 69.00, the total is 99.99: it is the server's total that is shown.
  const { client, requests } = scripted(() => previewOf(9999, lines));
  const probe = await mount(client, selection());

  expect(requests).toEqual([{ licensePriceId: PRO, dryRun: true }]);
  expect(probe.state.status).toBe("ready");
  expect(probe.state.data?.dueToday.total).toBe(9999);
  expect(probe.state.data?.dueToday.lines.map((entry) => entry.amount)).toEqual([4900, 2000]);
});

test("a quantity stepped up three times is one request, 300 ms after the last step", async () => {
  const { client, requests } = scripted((input) =>
    previewOf(4900 + (input.addOns?.[0]?.quantity ?? 0) * 1000),
  );
  const probe = await mount(client, selection({ addOns: { "extra-seats-v1": 2 } }));
  expect(requests).toHaveLength(1);
  expect(requests[0]!.addOns).toEqual([{ addonSlug: "extra-seats-v1", quantity: 2 }]);

  await probe.change(selection({ addOns: { "extra-seats-v1": 3 } }), 100);
  await probe.change(selection({ addOns: { "extra-seats-v1": 4 } }), 100);
  await probe.change(selection({ addOns: { "extra-seats-v1": 3 } }), 299);
  // Nothing yet, and the summary on screen is the one of the last answer, marked as not this selection's.
  expect(requests).toHaveLength(1);
  expect(probe.state).toMatchObject({ status: "loading", isStale: true });
  expect(probe.state.data?.dueToday.total).toBe(6900);

  await settle(1);
  // Exactly one new request, for the selection it settled on.
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual({
    licensePriceId: PRO,
    addOns: [{ addonSlug: "extra-seats-v1", quantity: 3 }],
    dryRun: true,
  });
  expect(probe.state).toMatchObject({ status: "ready", isStale: false });
  expect(probe.state.data?.dueToday.total).toBe(7900);
});

test("a selection that comes back to one already answered is not asked again", async () => {
  const { client, requests } = scripted(() => previewOf(4900));
  const probe = await mount(client, selection());
  await probe.change(selection({ licensePriceId: GROWTH }), 300);
  expect(requests).toHaveLength(2);

  // The customer goes back to the first plan within the pause, and the summary stays.
  await probe.change(selection({ licensePriceId: PRO }), 600);
  expect(requests).toHaveLength(3);
});

test("an answer that comes after a newer request was made is dropped", async () => {
  const resolvers: Array<(result: CheckoutResult) => void> = [];
  const requests: CheckoutInput[] = [];
  const client = unsubscribedSession({
    checkout: (input) => {
      requests.push(input);
      return new Promise<CheckoutResult>((resolve) => resolvers.push(resolve));
    },
  });
  const probe = await mount(client, selection());
  expect(requests).toHaveLength(1);

  // Pro is still being asked when the customer moves to Growth.
  await probe.change(selection({ licensePriceId: GROWTH }), 300);
  expect(requests).toHaveLength(2);

  // Growth's answer comes first, then Pro's, late: only Growth's is shown.
  await act(async () => resolvers[1]!(previewOf(7900)));
  await act(async () => resolvers[0]!(previewOf(4900)));
  expect(probe.state.status).toBe("ready");
  expect(probe.state.data?.dueToday.total).toBe(7900);
});

test("a trial is nothing due and the day the first invoice is, as the server says it", async () => {
  const { client } = scripted(() => trialPreview("2026-02-01T00:00:00Z"));
  const probe = await mount(client, selection());

  expect(probe.state.data?.dueToday).toMatchObject({ total: 0, lines: [] });
  expect(probe.state.data?.trialEndsAt).toBe("2026-02-01T00:00:00Z");
});

test("skipping the trial is sent, and the plan's own is what is asked for otherwise", async () => {
  const { client, requests } = scripted(() => previewOf(4900));
  const probe = await mount(client, selection());
  await probe.change(selection({ skipTrial: true }), 300);

  expect(requests.map((request) => request.trial)).toEqual([undefined, false]);
});

// ---------------------------------------------------------------------------
// The voucher
// ---------------------------------------------------------------------------

test("a code the server prices with is applied", async () => {
  const { client, requests } = scripted((input) =>
    input.voucherCode === "WELCOME20"
      ? previewOf(5520, [line(1, "BASE", "Pro", 6900), line(2, "DISCOUNT", "Welcome 20%", -1380)])
      : previewOf(6900, [line(1, "BASE", "Pro", 6900)]),
  );
  const probe = await mount(client, selection());
  expect(probe.state.voucher).toBe("none");

  await probe.change(selection({ voucherCode: " WELCOME20 " }));
  expect(probe.state.voucher).toBe("checking");
  await settle(300);

  // The code travels trimmed, in the body, and the discount is the server's line.
  expect(requests.at(-1)).toEqual({ licensePriceId: PRO, voucherCode: "WELCOME20", dryRun: true });
  expect(probe.state).toMatchObject({ status: "ready", voucher: "applied", isStale: false });
  expect(probe.state.data?.dueToday.total).toBe(5520);
});

test("a code the server refuses leaves the summary that was there, and says only that it was refused", async () => {
  const { client, requests } = scripted((input) =>
    input.voucherCode ? voucherInvalid() : previewOf(4900, [line(1, "BASE", "Pro", 4900)]),
  );
  const probe = await mount(client, selection());
  await probe.change(selection({ voucherCode: "NOPE" }), 300);

  expect(probe.state.voucher).toBe("rejected");
  expect(probe.state.problem).toEqual({ kind: "voucher_invalid" });
  // The previous summary is still the right one for the rest of the selection: no request for it.
  expect(requests).toHaveLength(2);
  expect(probe.state).toMatchObject({ status: "ready", isStale: false });
  expect(probe.state.data?.dueToday.total).toBe(4900);
  expect(probe.state.error).toBeNull();

  // Clearing the code is back to the summary it already had: nothing is asked.
  await probe.change(selection(), 1_000);
  expect(requests).toHaveLength(2);
  expect(probe.state).toMatchObject({ voucher: "none", problem: null, status: "ready" });
});

test("a code refused after the plan changed is asked again without it, so that what is shown is true", async () => {
  const { client, requests } = scripted((input) =>
    input.voucherCode
      ? input.licensePriceId === PRO
        ? previewOf(5520)
        : voucherInvalid()
      : previewOf(input.licensePriceId === PRO ? 6900 : 7900),
  );
  const probe = await mount(client, selection({ voucherCode: "WELCOME20" }));
  expect(probe.state).toMatchObject({ voucher: "applied" });
  expect(probe.state.data?.dueToday.total).toBe(5520);

  // Growth, with a code that is for Pro: the summary of Pro would be the wrong one to keep.
  await probe.change(selection({ licensePriceId: GROWTH, voucherCode: "WELCOME20" }), 300);
  expect(requests.slice(-2)).toEqual([
    { licensePriceId: GROWTH, voucherCode: "WELCOME20", dryRun: true },
    { licensePriceId: GROWTH, dryRun: true },
  ]);
  expect(probe.state).toMatchObject({ voucher: "rejected", status: "ready", isStale: false });
  expect(probe.state.data?.dueToday.total).toBe(7900);
});

test("a code that is there from the start and refused still leaves a summary on screen", async () => {
  const { client, requests } = scripted((input) =>
    input.voucherCode ? voucherInvalid() : previewOf(4900),
  );
  const probe = await mount(client, selection({ voucherCode: "NOPE" }));

  expect(requests).toEqual([
    { licensePriceId: PRO, voucherCode: "NOPE", dryRun: true },
    { licensePriceId: PRO, dryRun: true },
  ]);
  expect(probe.state).toMatchObject({ voucher: "rejected", status: "ready" });
  expect(probe.state.data?.dueToday.total).toBe(4900);
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("a plan the instance is over is refused with the entitlements that are, and keeps the last summary", async () => {
  const { client } = scripted((input) =>
    input.licensePriceId === PRO ? previewOf(4900) : quotaExceeded("seats", "api-calls"),
  );
  const probe = await mount(client, selection());
  await probe.change(selection({ licensePriceId: GROWTH }), 300);

  expect(probe.state.status).toBe("failed");
  expect(probe.state.problem).toEqual({
    kind: "quota_exceeded",
    entitlementSlugs: ["seats", "api-calls"],
  });
  expect(probe.state.isStale).toBe(true);
  expect(probe.state.data?.dueToday.total).toBe(4900);
});

test("a provider that cannot be reached is a wait, and asking again is the customer's to do", async () => {
  let down = true;
  const { client, requests } = scripted(() => (down ? providerUnavailable(30) : previewOf(4900)));
  const probe = await mount(client, selection());

  expect(probe.state.status).toBe("failed");
  expect(probe.state.problem).toEqual({ kind: "unavailable", retryAfterSeconds: 30 });
  // It does not ask again by itself, however long it waits.
  await settle(60_000);
  expect(requests).toHaveLength(1);

  down = false;
  await act(async () => probe.state.retry());
  await settle();
  expect(requests).toHaveLength(2);
  expect(probe.state).toMatchObject({ status: "ready", problem: null, error: null });
});

test("a customer with no billing email is told so by the API, which asks for one before it prices", async () => {
  const { client, requests } = scripted((input) =>
    input.billingEmail ? previewOf(4900) : billingEmailRequired(),
  );
  const probe = await mount(client, selection());
  expect(probe.state.problem).toEqual({ kind: "billing_email_required" });

  // An address that cannot be one is not sent; one that can be is.
  await probe.change(selection({ billingEmail: "ops@" }), 300);
  expect(requests).toHaveLength(1);
  await probe.change(selection({ billingEmail: "ops@acme.example" }), 300);
  expect(requests.at(-1)).toEqual({
    licensePriceId: PRO,
    billingEmail: "ops@acme.example",
    dryRun: true,
  });
  expect(probe.state.status).toBe("ready");
});

test("the billing email is not part of what is priced: it is not sent, and typing it asks nothing", async () => {
  const { client, requests } = scripted(() => previewOf(4900));
  const probe = await mount(client, selection({ billingEmail: "ops@acme.example" }));
  expect(requests).toEqual([{ licensePriceId: PRO, dryRun: true }]);

  await probe.change(selection({ billingEmail: "finance@acme.example" }), 1_000);
  await probe.change(selection({ billingEmail: "" }), 1_000);
  expect(requests).toHaveLength(1);
  expect(probe.state).toMatchObject({ status: "ready", isStale: false });
});

test("a server that wanted an address once is sent it with every preview after", async () => {
  const { client, requests } = scripted((input) =>
    input.billingEmail ? previewOf(4900) : billingEmailRequired(),
  );
  const probe = await mount(client, selection({ billingEmail: "ops@acme.example" }));
  // The first request had none, was refused for it, and is made again with it.
  await settle(300);
  expect(requests.map((input) => input.billingEmail)).toEqual([undefined, "ops@acme.example"]);
  expect(probe.state.status).toBe("ready");

  await probe.change(selection({ billingEmail: "ops@acme.example", skipTrial: true }), 300);
  expect(requests.at(-1)).toEqual({
    licensePriceId: PRO,
    billingEmail: "ops@acme.example",
    trial: false,
    dryRun: true,
  });
});

test("a paused preview asks nothing, drops an answer on its way, and asks when it is resumed", async () => {
  let answer!: (result: CheckoutResult) => void;
  const requests: CheckoutInput[] = [];
  const client = unsubscribedSession({
    checkout: (input) => {
      requests.push(input);
      return new Promise<CheckoutResult>((resolve) => (answer = resolve));
    },
  });
  const probe = await mount(client, selection());
  expect(requests).toHaveLength(1);

  // The answer comes after the pause: it is not shown, however late.
  probe.pause(true);
  await act(async () => answer(previewOf(4900)));
  await settle(1_000);
  expect(probe.state).toMatchObject({ status: "loading", data: null, problem: null });
  expect(requests).toHaveLength(1);

  probe.pause(false);
  await settle(300);
  expect(requests).toHaveLength(2);
  await act(async () => answer(previewOf(4900)));
  expect(probe.state.status).toBe("ready");

  // Paused again with a summary up: it stays, and nothing is asked for a selection that moves.
  probe.pause(true);
  await probe.change(selection({ addOns: { "extra-seats-v1": 2 } }), 1_000);
  expect(requests).toHaveLength(2);
  expect(probe.state.data?.dueToday.total).toBe(4900);
});

test("an answer that is not a preview is an error, not a summary", async () => {
  const { client } = scripted(() => ({
    status: "requires_payment_method",
    setupUrl: "https://pay.example.test/setup",
    setupSessionId: "cs",
    expiresAt: "2026-01-01T00:00:00Z",
  }));
  const probe = await mount(client, selection());

  expect(probe.state.status).toBe("failed");
  expect(probe.state.data).toBeNull();
  expect(probe.state.error?.message).toContain("requires_payment_method");
});

test("under any mode but a customer session there is no session to ask, and it stays idle", async () => {
  const { KaitenProvider } = await import("../src/index.ts");
  const view = renderHook(() => useCheckoutPreview(selection()), {
    wrapper: ({ children }) => (
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        {children}
      </KaitenProvider>
    ),
  });
  await settle(1_000);

  expect(view.result.current).toMatchObject({ status: "idle", data: null });
});

test("a summary that was asked for and answered is not asked for again when the hook remounts with the same selection in the same scope", async () => {
  const { client, requests } = scripted(() => previewOf(4900));
  const first = await mount(client, selection());
  first.view.unmount();
  await mount(client, selection());

  // A dry run is not cached: what is due is the server's to say each time it is shown.
  expect(requests).toHaveLength(2);
  expect(callsOf(client, "checkout")).toHaveLength(2);
});
