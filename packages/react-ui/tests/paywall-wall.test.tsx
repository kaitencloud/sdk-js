// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// What the wall says and does once `usePaywallTrigger` has decided: its wording for each
// reason, the way out it offers, and what it does to the content it covers and to the
// focus. The trigger is replaced, so that each test sets the decision it is about and
// can move it while the content is on screen; the trigger's own decisions are tested in
// @kaitencloud/react.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { PaywallTriggerResult } from "@kaitencloud/react";

const trigger = vi.hoisted(() => ({ current: undefined as PaywallTriggerResult | undefined }));

vi.mock("@kaitencloud/react", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/react")>();
  return { ...actual, usePaywallTrigger: () => trigger.current };
});

const { Paywall } = await import("../src/index.ts");
const { KaitenProvider } = await import("./support/styled-provider.tsx");

afterEach(cleanup);

const OPEN: PaywallTriggerResult = {
  shouldShow: false,
  reason: null,
  current: 40,
  limit: 100,
  percentage: 40,
  metered: true,
  usageWindow: null,
  isLoading: false,
  error: null,
  remaining: 60,
};

function decide(overrides: Partial<PaywallTriggerResult>) {
  trigger.current = { ...OPEN, ...overrides };
}

function Mounted({ children }: { children: ReactNode }) {
  return (
    <KaitenProvider mode="static" catalog={{ plans: [] }}>
      {children}
    </KaitenProvider>
  );
}

// --- Wording -------------------------------------------------------------------------------

test("a usage that could not be read is said as such, with no figures and nothing to buy", () => {
  decide({
    shouldShow: true,
    reason: "usage_unavailable",
    current: 0,
    limit: 100,
    percentage: 0,
    metered: false,
    remaining: null,
  });
  render(
    <Mounted>
      <Paywall entitlement="api_calls" onUpgrade={() => {}}>
        <p>Protected</p>
      </Paywall>
    </Mounted>,
  );

  expect(screen.getByText("Usage unavailable")).toBeDefined();
  expect(screen.queryByText(/You've used/)).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText("0%")).toBeNull();
  // No upgrade for a customer nobody could read.
  expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
});

test("a feature the plan does not include says so, not 0 of 1", () => {
  decide({
    shouldShow: true,
    reason: "not_entitled",
    current: 0,
    limit: 1,
    percentage: 0,
    metered: false,
    remaining: null,
  });
  render(
    <Mounted>
      <Paywall entitlement="sso">
        <p>Protected</p>
      </Paywall>
    </Mounted>,
  );

  expect(screen.queryByText(/You've used/)).toBeNull();
  expect(
    screen.getByText(/Unlock it by changing plan or enabling the related add-on/),
  ).toBeDefined();
});

test("a quota with too little left says how much is needed and how much is left", () => {
  decide({
    shouldShow: true,
    reason: "insufficient_quota",
    current: 95,
    limit: 100,
    percentage: 95,
    remaining: 5,
    recommendedAction: { type: "add_quota", label: "Add quota" },
  });
  render(
    <Mounted>
      <Paywall entitlement="exports" min={10} onUpgrade={() => {}}>
        <p>Protected</p>
      </Paywall>
    </Mounted>,
  );

  expect(screen.getByText("Not enough quota")).toBeDefined();
  expect(screen.getByText("This needs 10, and 5 are left.")).toBeDefined();
  expect(screen.getByRole("button", { name: /Add quota/ })).toBeDefined();
});

// --- Hard mode -----------------------------------------------------------------------------

test("hard mode lets a customer close the warning before the limit", () => {
  decide({ shouldShow: true, reason: "near_limit", percentage: 85, current: 85, remaining: 15 });
  render(
    <Mounted>
      <Paywall entitlement="api_calls" mode="hard" onUpgrade={() => {}}>
        <button type="button">Protected</button>
      </Paywall>
    </Mounted>,
  );

  // The warning is no modal: the usage is still accepted.
  expect(document.querySelector("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

  expect(screen.getByText("Protected").closest("[inert]")).toBeNull();
  expect(document.querySelector('[data-slot="paywall"]')).toBeNull();
});

test("hard mode still keeps a refusal behind the wall", () => {
  decide({ shouldShow: true, reason: "over_limit", percentage: 100, current: 100, remaining: 0 });
  render(
    <Mounted>
      <Paywall entitlement="api_calls" mode="hard" onUpgrade={() => {}}>
        <button type="button">Protected</button>
      </Paywall>
    </Mounted>,
  );

  expect(document.querySelector("dialog")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  expect(screen.getByText("Protected").closest("[inert]")).not.toBeNull();
});

test("the hard wall's dialog is closed before the host's upgrade runs", () => {
  decide({ shouldShow: true, reason: "over_limit", percentage: 100, current: 100, remaining: 0 });
  let dialogWhenCalled: Element | null | undefined;
  const onUpgrade = vi.fn(() => {
    dialogWhenCalled = document.querySelector("dialog");
  });
  render(
    <Mounted>
      <Paywall entitlement="api_calls" mode="hard" onUpgrade={onUpgrade}>
        <button type="button">Protected</button>
      </Paywall>
    </Mounted>,
  );

  fireEvent.click(screen.getByRole("button", { name: /Upgrade/ }));

  expect(onUpgrade).toHaveBeenCalledOnce();
  // A checkout the host opens from here must not sit under a modal it cannot reach.
  expect(dialogWhenCalled).toBeNull();
  // The content stays behind the inline wall.
  expect(screen.getByText("Protected").closest("[inert]")).not.toBeNull();
});

// --- The covered content -------------------------------------------------------------------

const WALLS = [
  ["a soft wall", "soft", false],
  ["a hard wall", "hard", false],
  ["an unstyled wall", "soft", true],
] as const;

test.each(WALLS)(
  "%s keeps the content it covers mounted, and what was typed in it",
  (_, mode, unstyled) => {
    decide({});
    const view = render(
      <Mounted>
        <Paywall entitlement="api_calls" mode={mode} unstyled={unstyled} onUpgrade={() => {}}>
          <input aria-label="Draft" />
        </Paywall>
      </Mounted>,
    );
    const input = screen.getByLabelText<HTMLInputElement>("Draft");
    fireEvent.change(input, { target: { value: "half-written" } });

    // A periodic read puts the usage over the line while the form is being filled.
    decide({ shouldShow: true, reason: "over_limit", current: 100, percentage: 100, remaining: 0 });
    view.rerender(
      <Mounted>
        <Paywall entitlement="api_calls" mode={mode} unstyled={unstyled} onUpgrade={() => {}}>
          <input aria-label="Draft" />
        </Paywall>
      </Mounted>,
    );

    const covered = screen.getByLabelText<HTMLInputElement>("Draft");
    expect(covered).toBe(input);
    expect(covered.value).toBe("half-written");
    expect(covered.closest("[inert]")).not.toBeNull();

    // And back under the line: the same field, still filled, reachable again.
    decide({});
    view.rerender(
      <Mounted>
        <Paywall entitlement="api_calls" mode={mode} unstyled={unstyled} onUpgrade={() => {}}>
          <input aria-label="Draft" />
        </Paywall>
      </Mounted>,
    );

    const reopened = screen.getByLabelText<HTMLInputElement>("Draft");
    expect(reopened).toBe(input);
    expect(reopened.value).toBe("half-written");
    expect(reopened.closest("[inert]")).toBeNull();
  },
);

function FocusPage() {
  return (
    <Mounted>
      <button type="button">Elsewhere</button>
      <Paywall entitlement="api_calls" onUpgrade={() => {}}>
        <input aria-label="Draft" />
      </Paywall>
    </Mounted>
  );
}

test("the wall leaves the focus where it is when it was outside the covered content", () => {
  decide({});
  const view = render(<FocusPage />);
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  act(() => elsewhere.focus());

  decide({ shouldShow: true, reason: "near_limit", current: 85, percentage: 85, remaining: 15 });
  view.rerender(<FocusPage />);

  expect(document.activeElement).toBe(elsewhere);
});

test("the wall takes the focus out of the content it covers", () => {
  decide({});
  const view = render(<FocusPage />);
  act(() => screen.getByLabelText("Draft").focus());

  decide({ shouldShow: true, reason: "near_limit", current: 85, percentage: 85, remaining: 15 });
  view.rerender(<FocusPage />);

  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Upgrade/ }));
});
