// @vitest-environment jsdom

// The exports a host uses without ever rendering a Kaiten component. They were
// covered incidentally by the styled components' suite, which formatted with
// them and listened for their events; that suite moved out with the components.

import { afterEach, expect, test, vi } from "vite-plus/test";

import { emitKaitenEvent, isUnlimited, kaitenComponentEvents, pluralize } from "../src/index.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("kaitenComponentEvents names every event the SDK dispatches", () => {
  expect(Object.values(kaitenComponentEvents)).toEqual([
    "kaiten:plan-changed",
    "kaiten:addon-added",
    "kaiten:subscription-canceled",
    "kaiten:payment-updated",
    "kaiten:quota-added",
  ]);
});

test("emitKaitenEvent dispatches a CustomEvent the host can listen for", () => {
  const heard: unknown[] = [];
  const listener = (event: Event) => heard.push((event as CustomEvent).detail);
  window.addEventListener(kaitenComponentEvents.planChanged, listener);

  emitKaitenEvent("kaiten:plan-changed", { planId: "plan-pro", planName: "Pro" });

  expect(heard).toEqual([{ planId: "plan-pro", planName: "Pro" }]);
  window.removeEventListener(kaitenComponentEvents.planChanged, listener);
});

test("emitKaitenEvent is a no-op on the server rather than a crash", () => {
  // Server rendering reaches the same code paths; a `window` that is not there
  // must be a missing listener, not a ReferenceError in someone's SSR route.
  vi.stubGlobal("window", undefined);
  expect(() =>
    emitKaitenEvent("kaiten:quota-added", { creditSlug: "seats", amount: 10 }),
  ).not.toThrow();
});

test("pluralize picks a form by count and substitutes {n}", () => {
  const forms = { one: "1 period", other: "{n} periods" };
  expect(pluralize(1, forms)).toBe("1 period");
  expect(pluralize(5, forms)).toBe("5 periods");
  expect(pluralize(0, forms)).toBe("0 periods");
});

test("pluralize follows the locale's own plural rules", () => {
  // French counts 0 and 1 as singular, which is exactly the kind of rule a
  // host must not have to reimplement.
  const forms = { one: "{n} jour", other: "{n} jours" };
  expect(pluralize(0, forms, "fr")).toBe("0 jour");
  expect(pluralize(2, forms, "fr")).toBe("2 jours");
});

test("pluralize falls back to `other` for a category the caller did not supply", () => {
  expect(pluralize(2, { other: "{n} items" }, "ar")).toBe("2 items");
});

test("isUnlimited is the API's sentinel, not a sign test", () => {
  // -1 means unlimited; any other negative is a malformed limit and must not
  // be read as "unlimited" by accident.
  expect(isUnlimited(-1)).toBe(true);
  expect(isUnlimited(0)).toBe(false);
  expect(isUnlimited(25)).toBe(false);
  expect(isUnlimited(-2)).toBe(false);
});
