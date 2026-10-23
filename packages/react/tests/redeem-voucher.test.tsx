// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// Redeeming a code on a live subscription, in two steps: the preview, which changes nothing, and
// the apply, which redeems and reads the portal again. The session is a double, so what is pinned
// is the calls it received and what the hook makes of its answers.

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenError, type SessionRedemption } from "@kaitencloud/client";
import {
  createMockKaitenSessionClient,
  demoPortal,
  demoTrialPortal,
} from "@kaitencloud/client/testing";

import { KaitenProvider, usePortal } from "../src/index.ts";
import { useRedeemVoucher } from "../src/billing.ts";
import {
  initialRedeemVoucherState,
  redeemVoucherProblem,
  redeemVoucherReducer,
  type RedeemVoucherState,
} from "../src/hooks/billing/redeem-voucher-state.ts";
import { callsOf, providerUnavailable, rateLimited, sessionProvider } from "./support/billing.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const problem = (status: number, code: string) =>
  new KaitenError({ title: "refused", status, code, detail: "refused" });

const redemption: SessionRedemption = {
  name: "Welcome 20%",
  voucherType: "PRICE",
  status: "ACTIVE",
  appliesFromInvoice: "next",
  applicationsCount: 0,
  applicationsMax: 3,
  effectiveStartsAt: "2026-01-15T09:00:00.000Z",
  effectiveExpiresAt: null,
};

describe("the problems", () => {
  test("a refusal of the code is one, whatever its reason", () => {
    expect(redeemVoucherProblem(problem(422, "RedeemSessionVoucher.VoucherInvalid"))).toEqual({
      kind: "voucher_invalid",
    });
  });

  test("a subscription that waits for its payment, and one that is not live, are told apart", () => {
    expect(
      redeemVoucherProblem(problem(409, "RedeemSessionVoucher.SubscriptionIncomplete")),
    ).toEqual({ kind: "subscription_incomplete" });
    expect(redeemVoucherProblem(problem(409, "RedeemSessionVoucher.NoLiveSubscription"))).toEqual({
      kind: "no_subscription",
    });
    expect(redeemVoucherProblem(problem(422, "RedeemSessionVoucher.InstanceRequired"))).toEqual({
      kind: "no_subscription",
    });
  });

  test("coming too often carries the wait, and a provider that is down its own", () => {
    expect(redeemVoucherProblem(rateLimited(90))).toEqual({
      kind: "rate_limited",
      retryAfterSeconds: 90,
    });
    expect(redeemVoucherProblem(providerUnavailable(30))).toMatchObject({ kind: "unavailable" });
  });

  test("anything else is other, and no error is no problem", () => {
    expect(redeemVoucherProblem(new Error("boom"))).toEqual({ kind: "other" });
    expect(redeemVoucherProblem(problem(500, "Whatever.Failed"))).toEqual({ kind: "other" });
    expect(redeemVoucherProblem(null)).toBeNull();
  });
});

describe("the reducer", () => {
  const run = (...events: Parameters<typeof redeemVoucherReducer>[1][]) =>
    events.reduce(redeemVoucherReducer, initialRedeemVoucherState);

  test("goes from a check to a preview to an applied redemption", () => {
    const previewed = run({ type: "check" }, { type: "checked", redemption });
    expect(previewed).toMatchObject({ status: "preview", redemption });

    const applied = redeemVoucherReducer(redeemVoucherReducer(previewed, { type: "apply" }), {
      type: "applied",
      redemption,
    });
    expect(applied).toMatchObject({ status: "applied", redemption, problem: null });
  });

  test("an apply with nothing previewed changes nothing", () => {
    expect(run({ type: "apply" })).toBe(initialRedeemVoucherState);
    const checking = run({ type: "check" });
    expect(redeemVoucherReducer(checking, { type: "apply" })).toBe(checking);
  });

  test("a late answer after a reset changes nothing", () => {
    const state = run({ type: "check" }, { type: "reset" });
    expect(redeemVoucherReducer(state, { type: "checked", redemption })).toBe(state);
    expect(redeemVoucherReducer(state, { type: "refused", error: new Error("x"), now: 0 })).toBe(
      state,
    );
  });

  test("a new check forgets the previous preview, and is ignored while one is under way", () => {
    const previewed = run({ type: "check" }, { type: "checked", redemption });
    expect(redeemVoucherReducer(previewed, { type: "check" })).toEqual({
      ...initialRedeemVoucherState,
      status: "checking",
    });
    const applying = redeemVoucherReducer(previewed, { type: "apply" });
    expect(redeemVoucherReducer(applying, { type: "check" })).toBe(applying);
  });

  test("a refusal for coming too often says when another attempt goes through, at least a second", () => {
    const state: RedeemVoucherState = redeemVoucherReducer(run({ type: "check" }), {
      type: "refused",
      error: rateLimited(0.2),
      now: 1_000,
    });
    expect(state).toMatchObject({ status: "refused", problem: { kind: "rate_limited" } });
    expect(state.retryAt).toBe(2_000);
  });
});

/** The hook beside the portal the provider reads. */
function mount(client: ReturnType<typeof createMockKaitenSessionClient>, onApplied?: () => void) {
  return renderHook(() => ({ redeem: useRedeemVoucher({ onApplied }), portal: usePortal() }), {
    wrapper: sessionProvider(client),
  });
}

describe("the hook", () => {
  test("previews with a dry run, which changes nothing, then applies and reads the portal again", async () => {
    const client = createMockKaitenSessionClient();
    const onApplied = vi.fn();
    const view = mount(client, onApplied);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

    await act(() => view.result.current.redeem.check("  WELCOME20 "));
    expect(callsOf(client, "redeemVoucher")).toEqual([{ code: "WELCOME20", dryRun: true }]);
    expect(view.result.current.redeem).toMatchObject({
      status: "preview",
      redemption: { name: "Welcome 20%", appliesFromInvoice: "next" },
    });
    expect(view.result.current.portal.data!.vouchers).toEqual([]);

    await act(() => view.result.current.redeem.apply());
    expect(callsOf(client, "redeemVoucher")).toEqual([
      { code: "WELCOME20", dryRun: true },
      { code: "WELCOME20" },
    ]);
    expect(view.result.current.redeem.status).toBe("applied");
    // Read again before apply resolved: the redemption is in the portal.
    expect(view.result.current.portal.data!.vouchers.map((voucher) => voucher.name)).toEqual([
      "Welcome 20%",
    ]);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  test("never holds the code in its state, and forgets it once applied", async () => {
    const client = createMockKaitenSessionClient();
    const view = mount(client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

    await act(() => view.result.current.redeem.check("WELCOME20"));
    const { check, apply, reset, ...state } = view.result.current.redeem;
    void check;
    void apply;
    void reset;
    expect(JSON.stringify(state)).not.toContain("WELCOME20");

    await act(() => view.result.current.redeem.apply());
    // Applying again sends nothing: the code was the first apply's alone.
    await act(() => view.result.current.redeem.apply());
    expect(callsOf(client, "redeemVoucher")).toHaveLength(2);
  });

  test("an apply with no preview sends nothing", async () => {
    const client = createMockKaitenSessionClient();
    const view = mount(client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

    await act(() => view.result.current.redeem.apply());

    expect(callsOf(client, "redeemVoucher")).toEqual([]);
    expect(view.result.current.redeem.status).toBe("idle");
  });

  test("an empty code sends nothing", async () => {
    const client = createMockKaitenSessionClient();
    const view = mount(client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

    await act(() => view.result.current.redeem.check("   "));

    expect(callsOf(client, "redeemVoucher")).toEqual([]);
  });

  test("a code that cannot be used is refused with the one problem, and nothing is kept", async () => {
    const client = createMockKaitenSessionClient();
    const view = mount(client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

    await act(() => view.result.current.redeem.check("NOPE"));

    expect(view.result.current.redeem).toMatchObject({
      status: "refused",
      problem: { kind: "voucher_invalid" },
      redemption: null,
    });
    expect(view.result.current.redeem.error).toBeInstanceOf(KaitenError);
    // And nothing to apply.
    await act(() => view.result.current.redeem.apply());
    expect(callsOf(client, "redeemVoucher")).toHaveLength(1);
  });

  test("tells a subscription that waits for its payment from one that is gone", async () => {
    const waiting = demoPortal();
    const incomplete = createMockKaitenSessionClient({
      portal: { ...waiting, subscription: { ...waiting.subscription!, status: "INCOMPLETE" } },
    });
    const none = createMockKaitenSessionClient({ portal: { ...waiting, subscription: null } });

    const first = mount(incomplete);
    await waitFor(() => expect(first.result.current.portal.data).toBeDefined());
    await act(() => first.result.current.redeem.check("WELCOME20"));
    const second = mount(none);
    await waitFor(() => expect(second.result.current.portal.data).toBeDefined());
    await act(() => second.result.current.redeem.check("WELCOME20"));

    expect(first.result.current.redeem.problem).toEqual({ kind: "subscription_incomplete" });
    expect(second.result.current.redeem.problem).toEqual({ kind: "no_subscription" });
  });

  test("a refusal for coming too often says when to come back", async () => {
    const client = createMockKaitenSessionClient();
    vi.spyOn(client, "redeemVoucher").mockRejectedValue(rateLimited(90));
    const view = mount(client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());
    const before = Date.now();

    await act(() => view.result.current.redeem.check("WELCOME20"));

    expect(view.result.current.redeem.problem).toEqual({
      kind: "rate_limited",
      retryAfterSeconds: 90,
    });
    expect(view.result.current.redeem.retryAt).toBeGreaterThanOrEqual(before + 90_000);
  });

  test("a refusal at the apply is the problem, with nothing applied", async () => {
    const client = createMockKaitenSessionClient();
    const view = mount(client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());
    await act(() => view.result.current.redeem.check("WELCOME20"));
    vi.spyOn(client, "redeemVoucher").mockRejectedValue(
      problem(409, "RedeemSessionVoucher.SubscriptionIncomplete"),
    );

    await act(() => view.result.current.redeem.apply());

    expect(view.result.current.redeem).toMatchObject({
      status: "refused",
      problem: { kind: "subscription_incomplete" },
    });
    expect(view.result.current.portal.data!.vouchers).toEqual([]);
  });

  test("reset forgets the preview and the code, and an answer that comes late is dropped", async () => {
    const client = createMockKaitenSessionClient({ delayMs: 20 });
    const view = mount(client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

    let pending: Promise<void>;
    await act(async () => {
      pending = view.result.current.redeem.check("WELCOME20");
      view.result.current.redeem.reset();
      await pending;
    });

    expect(view.result.current.redeem.status).toBe("idle");
    await act(() => view.result.current.redeem.apply());
    expect(callsOf(client, "redeemVoucher")).toHaveLength(1);
  });

  test("a price code takes the discount off what a trial ends with", async () => {
    const client = createMockKaitenSessionClient({ portal: demoTrialPortal() });
    const view = mount(client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

    await act(() => view.result.current.redeem.check("WELCOME20"));
    await act(() => view.result.current.redeem.apply());

    expect(view.result.current.portal.data!.trial?.charge?.amount).toBe(6320);
  });

  test("is for a customer session: elsewhere it says so", async () => {
    const view = renderHook(() => useRedeemVoucher(), {
      wrapper: ({ children }) => (
        <KaitenProvider mode="static" catalog={{ plans: [] }}>
          {children}
        </KaitenProvider>
      ),
    });
    await expect(view.result.current.check("X")).rejects.toThrow(/customer-session/);
  });
});
