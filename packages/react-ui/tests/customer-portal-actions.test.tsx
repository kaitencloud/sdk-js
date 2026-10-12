// @vitest-environment jsdom
//
// What a customer does in the customer portal, against the real session client and the answers
// Kaiten recorded for Initech: cancel the subscription and take it back, change how many units of
// an add-on they hold, check a voucher code, and read where a limit comes from. Each is held to
// what the customer sees afterwards, which is the portal as the server now says it.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { fr } from "@kaitencloud/react/locales";

import {
  AddOns,
  CurrentPlan,
  CustomerPortal,
  IncludedFeatures,
  UsageMeters,
  VoucherEntry,
  formatKaitenDate,
} from "../src/index.ts";
import { FAKE_TIMERS, settle } from "./support/checkout.tsx";
import { mount, off } from "./support/session-mount.tsx";
import { refusal, sessionServer } from "../.storybook/session-server.ts";
import { KaitenProvider } from "./support/styled-provider.tsx";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const endsOn = `Ends on ${formatKaitenDate("2026-11-01T00:00:00Z")}`;
const renewsOn = `Renews on ${formatKaitenDate("2026-11-01T00:00:00Z")}`;

/** A press, and the answer of the server, and what the portal read again. */
async function press(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name }));
  });
}

// ---------------------------------------------------------------------------
// Cancelling, and taking it back
// ---------------------------------------------------------------------------

test("Cancel is offered when the portal lets this customer cancel, and Reactivate when they did", async () => {
  for (const [portal, offered] of [
    ["portal", "Cancel subscription"],
    ["portalPastDue", "Cancel subscription"],
    ["portalCanceling", "Reactivate subscription"],
  ] as const) {
    const view = mount(sessionServer({ portal }), <CurrentPlan manage />);
    expect(await screen.findByRole("button", { name: offered }), portal).toBeTruthy();
    const other =
      offered === "Cancel subscription" ? "Reactivate subscription" : "Cancel subscription";
    expect(screen.queryByRole("button", { name: other }), portal).toBeNull();
    view.unmount();
  }
});

test("a session with no live subscription to act on offers neither", async () => {
  for (const portal of ["portalNeverSubscribed", "portalCustomerWide"] as const) {
    const server = sessionServer({ portal });
    const view = mount(server, <CurrentPlan manage />);
    await vi.waitFor(() => expect(server.to("GET", "portal")).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /subscription$/ }), portal).toBeNull();
    view.unmount();
  }
});

test("a plan card of the host's own does not cancel anything", async () => {
  mount(sessionServer(), <CurrentPlan />);
  await screen.findByText("Pro");
  expect(screen.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
});

test("cancelling asks first and says when it ends; keeping the subscription sends nothing", async () => {
  const server = sessionServer();
  mount(server, <CurrentPlan manage />);
  await press("Cancel subscription");

  expect(
    screen.getByText(
      `Your subscription will end on ${formatKaitenDate("2026-11-01T00:00:00Z")}. You keep everything until then, and you can undo this before it ends.`,
    ),
  ).toBeTruthy();
  await press("Keep my subscription");
  expect(server.to("POST", "billing/cancel")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Cancel subscription" })).toBeTruthy();
});

test("cancelling is the end of the period, never at once, and the portal then says so", async () => {
  const server = sessionServer();
  mount(server, <CurrentPlan manage />);
  expect(await screen.findByText(renewsOn)).toBeTruthy();

  await press("Cancel subscription");
  await press("Cancel at period end");

  const [call] = server.to("POST", "billing/cancel");
  expect(call).toBeTruthy();
  // The end customer never says when: the API's answer is always the end of the period.
  expect(call!.body ?? {}).not.toHaveProperty("mode");
  expect(await screen.findByText(endsOn)).toBeTruthy();
  expect(screen.queryByText(/Renews on/)).toBeNull();
  expect(screen.getByRole("button", { name: "Reactivate subscription" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
});

test("a cancellation is withdrawn until the period is over", async () => {
  const server = sessionServer({ portal: "portalCanceling" });
  mount(server, <CurrentPlan manage />);
  expect(await screen.findByText(endsOn)).toBeTruthy();

  await press("Reactivate subscription");

  expect(server.to("POST", "billing/reactivate")).toHaveLength(1);
  expect(await screen.findByText(renewsOn)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel subscription" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reactivate subscription" })).toBeNull();
});

/** Presses the button the keyboard is on: focus it first, as a Tab would have. */
async function pressFocused(name: string | RegExp) {
  const button = await screen.findByRole("button", { name });
  button.focus();
  await act(async () => {
    fireEvent.click(button);
  });
}

/** What the keyboard is on, once what the last press started is done. */
const focused = (expected: () => Element | null) =>
  waitFor(() => expect(document.activeElement).toBe(expected()));
const focusedText = (text: string | RegExp) =>
  waitFor(() => expect(document.activeElement?.textContent).toMatch(text));

test("the keyboard follows a cancellation: the question, then back, then the reactivation", async () => {
  const server = sessionServer();
  mount(server, <CurrentPlan manage />);
  await screen.findByText(renewsOn);

  await pressFocused("Cancel subscription");
  await focusedText(/^Your subscription will end on/);

  // Keeping it puts the customer back on the button that asked.
  await pressFocused("Keep my subscription");
  await focused(() => screen.getByRole("button", { name: "Cancel subscription" }));

  await pressFocused("Cancel subscription");
  await pressFocused("Cancel at period end");
  await screen.findByText(endsOn);
  await focused(() => screen.getByRole("button", { name: "Reactivate subscription" }));

  await pressFocused("Reactivate subscription");
  await screen.findByText(renewsOn);
  await focused(() => screen.getByRole("button", { name: "Cancel subscription" }));
});

test("a customer in their trial is told it ends now, not on a date", async () => {
  const portal: Record<string, any> = structuredClone(answers.portal);
  portal.subscription.status = "TRIAL";
  portal.subscription.trialEndsAt = "2026-11-01T00:00:00Z";
  mount(sessionServer({ portal }), <CurrentPlan manage />);
  await press("Cancel subscription");
  expect(screen.getByText("Your trial will end now, and you won't be charged.")).toBeTruthy();
});

test("a refusal while a billing period is being closed is waited out, once, and the screen says so", async () => {
  vi.useFakeTimers(FAKE_TIMERS);
  const server = sessionServer();
  server.script("POST billing/cancel", refusal("cancelBoundaryPending"));
  mount(server, <CurrentPlan manage />);
  await settle();

  fireEvent.click(screen.getByRole("button", { name: "Cancel subscription" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel at period end" }));
  await settle();
  expect(screen.getByText(/We're closing your billing period/)).toBeTruthy();
  expect(server.to("POST", "billing/cancel")).toHaveLength(1);

  await settle(60_000);
  expect(server.to("POST", "billing/cancel")).toHaveLength(2);
  expect(screen.getByText(endsOn)).toBeTruthy();
  expect(screen.queryByText(/We're closing your billing period/)).toBeNull();
});

test("a second refusal is the answer: the customer is asked to try again", async () => {
  vi.useFakeTimers(FAKE_TIMERS);
  const server = sessionServer();
  server.script(
    "POST billing/cancel",
    refusal("cancelBoundaryPending"),
    refusal("cancelBoundaryPending"),
  );
  mount(server, <CurrentPlan manage />);
  await settle();

  fireEvent.click(screen.getByRole("button", { name: "Cancel subscription" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel at period end" }));
  await settle(61_000);

  expect(server.to("POST", "billing/cancel")).toHaveLength(2);
  expect(
    screen.getByText("Your billing period is still being closed. Try again in a minute."),
  ).toBeTruthy();
  expect(screen.getByRole("alert")).toBeTruthy();
});

test("a cancellation the API refuses is said, and changes nothing on screen", async () => {
  const server = sessionServer();
  server.script("POST billing/cancel", refusal("cancelNotActive"));
  mount(server, <CurrentPlan manage />);
  await press("Cancel subscription");
  await press("Cancel at period end");
  expect(await screen.findByText("That didn't work. Please try again.")).toBeTruthy();
  expect(screen.getByText(renewsOn)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The quantity of an add-on
// ---------------------------------------------------------------------------

const quantityOf = (name: string) => screen.getByLabelText(`Quantity of ${name}`).textContent;

test("shows what the instance holds, with the stepper's limit", async () => {
  mount(sessionServer(), <AddOns />);
  expect(await screen.findByText("Extra seats")).toBeTruthy();
  expect(quantityOf("Extra seats")).toBe("3");
  expect(quantityOf("GPU pack")).toBe("1");
  expect(screen.getByText(/Up to 50/)).toBeTruthy();
  // The price of one unit, at the subscription's period.
  expect(screen.getByText(/€10\.00\/month/)).toBeTruthy();
});

test("a press is one change, sent as the quantity the instance will hold", async () => {
  const server = sessionServer();
  mount(server, <AddOns />);
  await screen.findByText("Extra seats");

  await press("Add one Extra seats");

  expect(server.to("PUT", "addons/extra-seats-v1").map((call) => call.body)).toEqual([
    { quantity: 4 },
  ]);
  expect(quantityOf("Extra seats")).toBe("4");

  await press("Remove one Extra seats");
  expect(server.to("PUT", "addons/extra-seats-v1").map((call) => call.body)).toEqual([
    { quantity: 4 },
    { quantity: 3 },
  ]);
  expect(quantityOf("Extra seats")).toBe("3");
});

test("the stepper stops at the most an instance may hold", async () => {
  const portal = structuredClone(answers.portal);
  portal.addOns[0]!.quantity = 50;
  mount(sessionServer({ portal }), <AddOns />);
  await screen.findByText("Extra seats");
  expect(off(screen.getByRole("button", { name: "Add one Extra seats" }))).toBe(true);
  expect(off(screen.getByRole("button", { name: "Remove one Extra seats" }))).toBe(false);
  // An add-on with no limit has no ceiling.
  expect(off(screen.getByRole("button", { name: "Add one GPU pack" }))).toBe(false);
});

test("removing the last unit asks first, and says what happens to the bill", async () => {
  const server = sessionServer();
  mount(server, <AddOns />);
  await screen.findByText("GPU pack");

  await press("Remove one GPU pack");
  expect(screen.getByText("Remove GPU pack from your plan?")).toBeTruthy();
  expect(
    screen.getByText(
      "Changes are billed from your next renewal. Nothing is refunded for the current period.",
    ),
  ).toBeTruthy();
  expect(server.to("PUT", "addons/gpu-pack-v1")).toHaveLength(0);

  await press("Keep");
  expect(screen.queryByText("Remove GPU pack from your plan?")).toBeNull();
  expect(server.to("PUT", "addons/gpu-pack-v1")).toHaveLength(0);

  await press("Remove one GPU pack");
  await press("Remove");
  expect(server.to("PUT", "addons/gpu-pack-v1").map((call) => call.body)).toEqual([
    { quantity: 0 },
  ]);
  // It left the portal, and stays here at none, so that it can be added back.
  expect(quantityOf("GPU pack")).toBe("0");
  await press("Add one GPU pack");
  expect(quantityOf("GPU pack")).toBe("1");
});

test("the keyboard stays on the stepper through a change, and follows the removal of the last unit", async () => {
  const server = sessionServer();
  mount(server, <AddOns />);
  await screen.findByText("GPU pack");

  await pressFocused("Add one Extra seats");
  await waitFor(() => expect(quantityOf("Extra seats")).toBe("4"));
  await focused(() => screen.getByRole("button", { name: "Add one Extra seats" }));

  await pressFocused("Remove one GPU pack");
  await focusedText(/^Remove GPU pack from your plan\?$/);
  await pressFocused("Keep");
  await focused(() => screen.getByRole("button", { name: "Remove one GPU pack" }));

  await pressFocused("Remove one GPU pack");
  await pressFocused("Remove");
  await waitFor(() => expect(quantityOf("GPU pack")).toBe("0"));
  await focused(() => screen.getByRole("button", { name: "Add one GPU pack" }));
});

test("a change refused while a billing period is closed goes through after the wait, once", async () => {
  vi.useFakeTimers(FAKE_TIMERS);
  const server = sessionServer();
  server.script("PUT addons/extra-seats-v1", refusal("cancelBoundaryPending"));
  mount(server, <AddOns />);
  await settle();

  fireEvent.click(screen.getByRole("button", { name: "Add one Extra seats" }));
  await settle();
  expect(screen.getByText(/We're closing your billing period/)).toBeTruthy();
  expect(off(screen.getByRole("button", { name: "Add one Extra seats" }))).toBe(true);
  expect(server.to("PUT", "addons/extra-seats-v1")).toHaveLength(1);

  await settle(60_000);
  expect(server.to("PUT", "addons/extra-seats-v1")).toHaveLength(2);
  expect(quantityOf("Extra seats")).toBe("4");
});

test("a change the API refuses is said, and the quantity is the one the server holds", async () => {
  const server = sessionServer();
  server.script("PUT addons/extra-seats-v1", refusal("addonIncompatible"));
  mount(server, <AddOns />);
  await screen.findByText("Extra seats");

  await press("Add one Extra seats");
  expect(await screen.findByText("That didn't work. Please try again.")).toBeTruthy();
  expect(quantityOf("Extra seats")).toBe("3");
});

// ---------------------------------------------------------------------------
// A voucher
// ---------------------------------------------------------------------------

const CODE = "WELCOME20";

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test("a valid code says what it is and that it is applied at checkout, and is gone from the page", async () => {
  const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  const server = sessionServer();
  const { container } = mount(server, <VoucherEntry />);
  await screen.findByLabelText("Voucher code");

  type("Voucher code", CODE);
  await press("Check");

  expect(await screen.findByText("Welcome 20% — Applied at checkout.")).toBeTruthy();
  // It was sent, in the body, and nowhere else.
  const [call] = server.to("POST", "vouchers/validate");
  expect(call!.body).toEqual({ code: CODE });
  expect(call!.url).not.toContain(CODE);
  expect(window.location.href).not.toContain(CODE);
  expect((screen.getByLabelText("Voucher code") as HTMLInputElement).value).toBe("");
  expect(container.innerHTML).not.toContain(CODE);
  expect(document.body.innerHTML).not.toContain(CODE);
  for (const spy of logs) {
    expect(JSON.stringify(spy.mock.calls), "a log").not.toContain(CODE);
  }
  expect(JSON.stringify(window.sessionStorage)).not.toContain(CODE);
  expect(JSON.stringify(window.localStorage)).not.toContain(CODE);
});

test("the keyboard stays on Check while it is emptied and answered", async () => {
  const server = sessionServer();
  mount(server, <VoucherEntry />);
  await screen.findByLabelText("Voucher code");

  type("Voucher code", CODE);
  await pressFocused("Check");
  expect(await screen.findByText("Welcome 20% — Applied at checkout.")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Check" }));
  expect(off(screen.getByRole("button", { name: "Check" }))).toBe(true);
});

test("every refusal is the same sentence, and says no reason", async () => {
  const server = sessionServer();
  mount(server, <VoucherEntry />);
  await screen.findByLabelText("Voucher code");

  type("Voucher code", "NOPE");
  await press("Check");
  expect(await screen.findByText("This code can't be used.")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("This code can't be used.");
  expect((screen.getByLabelText("Voucher code") as HTMLInputElement).value).toBe("");
});

test("Enter checks the code, and nothing is sent for an empty field", async () => {
  const server = sessionServer();
  mount(server, <VoucherEntry />);
  await screen.findByLabelText("Voucher code");
  expect(off(screen.getByRole("button", { name: "Check" }))).toBe(true);

  type("Voucher code", "launch boost");
  fireEvent.keyDown(screen.getByLabelText("Voucher code"), { key: "Enter" });
  expect(await screen.findByText("Launch boost — Applied at checkout.")).toBeTruthy();
  expect(server.to("POST", "vouchers/validate")).toHaveLength(1);
});

test("a check refused for coming too often says when to come back, and waits that long", async () => {
  vi.useFakeTimers(FAKE_TIMERS);
  const server = sessionServer();
  server.script("POST vouchers/validate", refusal("voucherRateLimited"));
  mount(server, <VoucherEntry />);
  await settle();

  type("Voucher code", "ONE");
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  await settle();
  expect(screen.getByText("Too many attempts. Try again in 2 minutes.")).toBeTruthy();

  type("Voucher code", "TWO");
  expect(off(screen.getByRole("button", { name: "Check" }))).toBe(true);
  await settle(91_000);
  expect(off(screen.getByRole("button", { name: "Check" }))).toBe(false);
});

test("in French", async () => {
  mount(sessionServer(), <VoucherEntry />, fr);
  await screen.findByLabelText("Code promo");
  type("Code promo", "NOPE");
  await press("Vérifier");
  expect(await screen.findByText("Ce code ne peut pas être utilisé.")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Where a limit comes from
// ---------------------------------------------------------------------------

test("a limit a voucher moved says how, in the server's figures", async () => {
  mount(sessionServer(), <UsageMeters />);
  await screen.findByText("API calls");

  fireEvent.click(screen.getByRole("button", { name: "How this limit is made up: API calls" }));

  expect(screen.getByRole("note").textContent).toBe("(100,000 base) × 2 voucher = 200,000");
});

test("a limit add-ons raised says so, and a limit nothing moved has nothing to say", async () => {
  mount(sessionServer(), <UsageMeters />);
  await screen.findByText("Seats");

  fireEvent.click(screen.getByRole("button", { name: "How this limit is made up: Seats" }));
  expect(screen.getByRole("note").textContent).toBe("5 base + 3 × 1 add-on = 8");
  expect(
    screen.queryByRole("button", { name: "How this limit is made up: AI credits" }),
  ).toBeNull();
});

test("the same note is on the included features", async () => {
  const { container } = mount(sessionServer(), <IncludedFeatures />);
  await screen.findAllByText("API calls");
  const buttons = within(container).getAllByRole("button", {
    name: "How this limit is made up: API calls",
  });
  expect(buttons.length).toBeGreaterThan(0);
  fireEvent.click(buttons[0]!);
  expect(screen.getAllByRole("note")[0]!.textContent).toBe("(100,000 base) × 2 voucher = 200,000");
});

test("the note opens on a press and closes on another", async () => {
  mount(sessionServer(), <UsageMeters />);
  await screen.findByText("API calls");
  const button = screen.getByRole("button", { name: "How this limit is made up: API calls" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(button);
  expect(screen.queryByRole("note")).toBeNull();
});

test("unstyled, the note is there too, in plain markup", async () => {
  const { container } = mount(sessionServer(), <UsageMeters unstyled />);
  await screen.findByText(/API calls/);
  const button = screen.getByRole("button", { name: "How this limit is made up: API calls" });
  expect(button.closest("[data-slot='provenance']")).toBeTruthy();
  fireEvent.click(button);
  expect(screen.getByRole("note").textContent).toBe("(100,000 base) × 2 voucher = 200,000");
  expect(container.querySelector("[data-slot='provenance'] [class]")).toBeNull();

  cleanup();
  const features = mount(sessionServer(), <IncludedFeatures unstyled />);
  await screen.findAllByText(/API calls/);
  expect(
    within(features.container).getAllByRole("button", {
      name: "How this limit is made up: API calls",
    }).length,
  ).toBeGreaterThan(0);
});

test("in French", async () => {
  mount(sessionServer(), <UsageMeters />, fr);
  await screen.findByText("API calls");
  fireEvent.click(screen.getByRole("button", { name: "D'où vient cette limite: API calls" }));
  // The figures are written in the browser's own locale; the words are the pack's.
  expect(screen.getByRole("note").textContent).toMatch(
    /^\(100.000 de base\) × 2 code promo = 200.000$/,
  );
});

// ---------------------------------------------------------------------------
// The portal, composed
// ---------------------------------------------------------------------------

test("a customer session's portal is its plan, its limits, its add-ons, its invoices and a voucher check", async () => {
  const { container } = mount(sessionServer(), <CustomerPortal />);
  await screen.findByText("Invoices");
  for (const title of [
    "Current plan",
    "Included features",
    "Usage meters",
    "Add-ons",
    "Invoices",
    "Voucher",
  ]) {
    expect(screen.getAllByText(title).length, title).toBeGreaterThan(0);
  }
  expect(container.querySelector('[data-slot="customer-portal"]')).toBeTruthy();
});

test("under any other mode the sections that are a session's are dropped, and leave no empty cell", async () => {
  const { container } = render(
    <KaitenProvider mode="static" catalog={{ plans: [] }}>
      <CustomerPortal elements={["InvoiceList", "VoucherEntry"]} />
    </KaitenProvider>,
  );
  const grid = container.querySelector('[data-slot="customer-portal"] > div');
  expect(grid).toBeTruthy();
  expect(grid!.children).toHaveLength(0);
  expect(screen.queryByText("Invoices")).toBeNull();
  expect(screen.queryByText("Voucher")).toBeNull();
});
