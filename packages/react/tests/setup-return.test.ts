// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// The browser's half of a round trip to the provider's setup page: where the customer is sent
// back to, what is remembered while they are away, and how a window that is waiting hears that
// they are back.

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import {
  announceReturn,
  clearKaitenParams,
  clearPending,
  currentPageUrl,
  openSetupPage,
  readPending,
  readSetupReturn,
  savePending,
  waitForReturn,
} from "../src/hooks/billing/setup-return.ts";

const at = (url: string) => window.history.replaceState({ kept: true }, "", url);

beforeEach(() => {
  window.sessionStorage.clear();
  at("/");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("the page the customer comes back to is this one, without its fragment or any kaiten parameter", () => {
  at("/billing?tab=card&kaiten_setup_session=cs_1&kaiten_other=x&plan=pro#invoices");
  const url = new URL(currentPageUrl());
  expect(url.origin).toBe(window.location.origin);
  expect(url.pathname).toBe("/billing");
  expect(url.hash).toBe("");
  // The host's own parameters are the host's: only ours go.
  expect([...url.searchParams.keys()]).toEqual(["tab", "plan"]);
  expect(url.searchParams.get("plan")).toBe("pro");
});

test("the setup session of a return is read from the address, and the address is left alone", () => {
  expect(readSetupReturn()).toBeNull();
  at("/billing?kaiten_setup_session=cs_1");
  expect(readSetupReturn()).toBe("cs_1");
  expect(window.location.search).toBe("?kaiten_setup_session=cs_1");
});

test("clearing takes every kaiten parameter out and keeps the rest, the fragment and the history state", () => {
  at("/billing?tab=card&kaiten_setup_session=cs_1&kaiten_x=1#invoices");
  clearKaitenParams();
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    "/billing?tab=card#invoices",
  );
  expect(window.history.state).toEqual({ kept: true });

  // Nothing of ours in the address: the history is not touched.
  const replace = vi.spyOn(window.history, "replaceState");
  clearKaitenParams();
  expect(replace).not.toHaveBeenCalled();
});

test("what a flow keeps is given back for its own setup session, and for no other", () => {
  savePending("checkout", "cs_1", { chosen: "pro" }, "2099-01-01T00:00:00Z");
  expect(readPending("checkout", "cs_1")).toEqual({ chosen: "pro" });
  expect(readPending("checkout", "cs_2")).toBeNull();
  // Another flow's memory is another record.
  expect(readPending("payment-method", "cs_1")).toBeNull();
  clearPending("checkout");
  expect(readPending("checkout", "cs_1")).toBeNull();
});

test("what a flow kept is gone once the setup page it waited on has expired", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  savePending("checkout", "cs_1", { chosen: "pro" }, "2026-01-01T01:00:00Z");

  // A little after the page itself expired: the grace a slow return is given.
  vi.setSystemTime(new Date("2026-01-01T01:05:00Z"));
  expect(readPending("checkout", "cs_1")).toEqual({ chosen: "pro" });

  vi.setSystemTime(new Date("2026-01-01T01:11:00Z"));
  expect(readPending("checkout", "cs_1")).toBeNull();
  // And it was forgotten, not only skipped.
  expect(window.sessionStorage.length).toBe(0);
});

test("without an expiry it is kept for an hour", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  savePending("checkout", "cs_1", 1);
  vi.setSystemTime(new Date("2026-01-01T00:59:00Z"));
  expect(readPending("checkout", "cs_1")).toBe(1);
  vi.setSystemTime(new Date("2026-01-01T01:01:00Z"));
  expect(readPending("checkout", "cs_1")).toBeNull();
});

test("storage that refuses loses the memory and nothing else", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  expect(() => savePending("checkout", "cs_1", {})).not.toThrow();
  vi.restoreAllMocks();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
  expect(readPending("checkout", "cs_1")).toBeNull();
  window.sessionStorage.setItem("kaiten:pending:checkout", "{not json");
  vi.restoreAllMocks();
  expect(readPending("checkout", "cs_1")).toBeNull();
});

test("the setup page opens in a popup that is cut off from this page", () => {
  const popup = { opener: window } as unknown as Window;
  const open = vi.spyOn(window, "open").mockReturnValue(popup);
  const navigate = vi.fn();

  expect(openSetupPage("https://pay.example.test/setup", navigate)).toBe("popup");
  expect(open).toHaveBeenCalledWith(
    "https://pay.example.test/setup",
    "kaiten-setup",
    expect.stringContaining("popup"),
  );
  expect(popup.opener).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

test("a popup the browser blocks sends this page there instead", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const navigate = vi.fn();

  expect(openSetupPage("https://pay.example.test/setup", navigate)).toBe("redirect");
  expect(navigate).toHaveBeenCalledWith("https://pay.example.test/setup");
});

test("a window that waits hears that the page is back, once, and says it was waiting", async () => {
  const onReturn = vi.fn();
  const stop = waitForReturn("cs_1", onReturn);

  // The page the customer comes back to: somebody was waiting.
  await expect(announceReturn("cs_1")).resolves.toBe(true);
  expect(onReturn).toHaveBeenCalledTimes(1);

  // A second page that says it is back is answered too, and does not start it over.
  await expect(announceReturn("cs_1")).resolves.toBe(true);
  expect(onReturn).toHaveBeenCalledTimes(1);

  stop();
});

test("nobody waits when the page was the one sent away, and a wait for another session is not this one", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const other = vi.fn();
  const stop = waitForReturn("cs_other", other);

  const announced = announceReturn("cs_1");
  await vi.advanceTimersByTimeAsync(300);
  await expect(announced).resolves.toBe(false);
  expect(other).not.toHaveBeenCalled();
  stop();
});

test("a window that stopped waiting is not told", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const onReturn = vi.fn();
  waitForReturn("cs_1", onReturn)();

  const announced = announceReturn("cs_1");
  await vi.advanceTimersByTimeAsync(300);
  await expect(announced).resolves.toBe(false);
  expect(onReturn).not.toHaveBeenCalled();
});

test("without a broadcast channel nobody is ever told, and nothing breaks", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  try {
    const stop = waitForReturn("cs_1", vi.fn());
    await expect(announceReturn("cs_1")).resolves.toBe(false);
    expect(() => stop()).not.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});
