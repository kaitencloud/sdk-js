// @vitest-environment jsdom
//
// The add-ons of a customer session's portal: the card lists what the instance holds, and the
// changes are made in a panel that opens from it or from the plan card. In the panel the customer
// sets quantities that stay there, reads what each change does to the subscription, and confirms:
// one change per add-on, in order, stopping at the first the API refuses. Held, as the customer
// portal's other suites are, to the real session client and what Kaiten answered for Initech: Pro,
// in euros, by the month, renewing on 1 November, with Extra seats ×3 at €10.00 a month and a GPU
// pack ×1 that has no price.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { fr } from "@kaitencloud/react/locales";

import { AddOns, CurrentPlan, CustomerPortal, formatKaitenDate } from "../src/index.ts";
import { FAKE_TIMERS, settle } from "./support/checkout.tsx";
import { flat, mount, off } from "./support/session-mount.tsx";
import { refusal, sessionServer } from "../.storybook/session-server.ts";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const RENEWAL = formatKaitenDate("2026-11-01T00:00:00Z");

/** The panel, once it is open. */
const panel = () => screen.getByRole("dialog", { name: "Manage add-ons" });
const inPanel = () => within(panel());

/** Opens the panel from the first button that opens it, focused first as a Tab would have. */
async function openPanel() {
  const [button] = await screen.findAllByRole("button", { name: "Manage add-ons" });
  button!.focus();
  await act(async () => {
    fireEvent.click(button!);
  });
  return panel();
}

/** Presses a button of the panel. */
async function pressInPanel(name: string | RegExp) {
  const button = inPanel().getByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
}

/** The quantity the panel holds for an add-on. */
const staged = (name: string) => inPanel().getByLabelText(`Quantity of ${name}`).textContent;

/** The text of each line of the card: what the instance holds. */
const held = () =>
  [...document.querySelectorAll('[data-slot="addon"]')].map((row) => flat(row.textContent));

/** The text of each change the panel's summary lists. */
const changes = () =>
  [...panel().querySelectorAll('[data-slot="addon-change"]')].map((line) => flat(line.textContent));

/** The quantities sent, in the order they were sent, as `slug=quantity`. */
const sent = (server: ReturnType<typeof sessionServer>) =>
  server.calls
    .filter((call) => call.method === "PUT")
    .map(
      (call) =>
        `${call.route.slice("addons/".length)}=${(call.body as { quantity: number }).quantity}`,
    );

// ---------------------------------------------------------------------------
// The card and the way into the panel
// ---------------------------------------------------------------------------

test("the card lists what the instance holds, its quantity and the price of a unit, and changes nothing", async () => {
  mount(sessionServer(), <AddOns />);
  await screen.findByText("Extra seats");

  expect(held()).toEqual(["Extra seats€10.00/month× 3", "GPU pack× 1"]);
  // No stepper on the card: a change is made in the panel.
  expect(screen.queryByRole("button", { name: "Add one Extra seats" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove one GPU pack" })).toBeNull();
  expect(screen.getByRole("button", { name: "Manage add-ons" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the plan card of the portal opens the same panel, and a plan card of the host's own does not", async () => {
  mount(sessionServer(), <CurrentPlan manage />);
  await openPanel();
  expect(staged("Extra seats")).toBe("3");
  expect(staged("GPU pack")).toBe("1");
  cleanup();

  mount(sessionServer(), <CurrentPlan />);
  await screen.findByText(/^Renews on/);
  expect(screen.queryByRole("button", { name: "Manage add-ons" })).toBeNull();
});

test("an instance that holds nothing and is offered nothing has no section, and no way into the panel", async () => {
  // No catalogue is read here, so nothing is offered beside what the instance holds.
  const portal = { ...structuredClone(answers.portal), addOns: [] };
  mount(sessionServer({ portal }), <CurrentPlan manage />);
  await screen.findByText(/^Renews on/);
  expect(screen.queryByRole("button", { name: "Manage add-ons" })).toBeNull();
  cleanup();

  mount(sessionServer({ portal }), <AddOns />);
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  expect(document.querySelector('[data-slot="addons"]')).toBeNull();
  expect(screen.queryByRole("button", { name: "Manage add-ons" })).toBeNull();
});

// ---------------------------------------------------------------------------
// Setting quantities, and reading what they do
// ---------------------------------------------------------------------------

test("a quantity set in the panel stays there: nothing is sent before Confirm", async () => {
  const server = sessionServer();
  mount(server, <AddOns />);
  await openPanel();

  await pressInPanel("Add one Extra seats");
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Remove one GPU pack");

  expect(staged("Extra seats")).toBe("5");
  expect(staged("GPU pack")).toBe("0");
  expect(sent(server)).toEqual([]);
  // The card behind is what the server holds.
  expect(held()).toEqual(["Extra seats€10.00/month× 3", "GPU pack× 1"]);
});

test("the summary says each change, its fee at the add-on's own price and when it is billed", async () => {
  mount(sessionServer(), <AddOns />);
  await openPanel();
  expect(inPanel().getByText("No changes yet.")).toBeTruthy();

  await pressInPanel("Add one Extra seats");
  await pressInPanel("Remove one GPU pack");

  expect(changes()).toEqual([
    `Extra seats 3 → 4 +1 × €10.00/monthTakes effect now, and is billed from your renewal on ${RENEWAL}.`,
    // The GPU pack has no price: the change is said without one.
    `GPU pack 1 → 0 −1Removed now. Your renewal on ${RENEWAL} no longer bills it, and nothing is refunded for the current period.`,
  ]);
  // An increase may also be billed for the current period: said once, of every add-on, since the
  // portal does not say which are billed that way.
  expect(
    inPanel().getByText(
      "A higher quantity can also be billed for the current period, at the most you hold during it, on your next invoice.",
    ),
  ).toBeTruthy();
});

test("the summary never adds a fee up: two more seats are two units at the add-on's price", async () => {
  mount(sessionServer(), <AddOns />);
  await openPanel();
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Add one Extra seats");

  const summary = flat(panel().querySelector('[data-slot="addon-changes"]')!.textContent);
  expect(summary).toContain("+2 × €10.00/month");
  expect(summary).not.toContain("20.00");
  expect(summary).not.toContain("30.00");
  expect(summary).not.toContain("50.00");
});

test("a lower quantity takes effect now, as the contract makes it, and the renewal bills what is left", async () => {
  mount(sessionServer(), <AddOns />);
  await openPanel();
  await pressInPanel("Remove one Extra seats");

  expect(changes()).toEqual([
    `Extra seats 3 → 2 −1 × €10.00/monthTakes effect now. Your renewal on ${RENEWAL} bills the new quantity, and nothing is refunded for the current period.`,
  ]);
  // Nothing is raised: no word of the current period.
  expect(inPanel().queryByText(/A higher quantity/)).toBeNull();
});

test("a subscription that ends renews nothing, and without one nothing is billed", async () => {
  mount(sessionServer({ portal: "portalCanceling" }), <AddOns />);
  await openPanel();
  await pressInPanel("Add one Extra seats");
  expect(changes()[0]).toContain(
    `Takes effect now. Your subscription ends on ${RENEWAL} and isn't renewed.`,
  );
  cleanup();

  const portal = { ...structuredClone(answers.portal), subscription: null, upcomingInvoice: null };
  mount(sessionServer({ portal }), <AddOns />);
  await openPanel();
  await pressInPanel("Add one Extra seats");
  // No subscription bills it: no fee, and no word of a period.
  expect(changes()).toEqual([
    "Extra seats 3 → 4 +1Takes effect now. Nothing is billed without a subscription.",
  ]);
  expect(inPanel().queryByText(/A higher quantity/)).toBeNull();
});

test("in a trial, a change is billed from the trial's end, with no word of the current period", async () => {
  // The trial's period is the trial: it ends when the trial does, before the month would.
  const portal: Record<string, any> = structuredClone(answers.portal);
  portal.subscription = {
    ...portal.subscription,
    status: "TRIAL",
    trialEndsAt: "2026-10-15T00:00:00Z",
    currentPeriodEnd: "2026-10-15T00:00:00Z",
  };
  mount(sessionServer({ portal }), <AddOns />);
  await openPanel();
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Remove one GPU pack");

  const end = formatKaitenDate("2026-10-15T00:00:00Z");
  expect(changes()).toEqual([
    `Extra seats 3 → 4 +1 × €10.00/monthTakes effect now, and is billed from the end of your trial on ${end}.`,
    `GPU pack 1 → 0 −1Removed now. It isn't billed when your trial ends on ${end}.`,
  ]);
  // A trial is never trued up: nothing is said of the current period.
  expect(inPanel().queryByText(/A higher quantity/)).toBeNull();
});

test("a subscription that waits for its checkout's payment has no panel, and says when add-ons can change", async () => {
  const portal = structuredClone(answers.portal);
  portal.subscription = { ...portal.subscription, status: "INCOMPLETE" };
  mount(sessionServer({ portal }), <CustomerPortal elements={["CurrentPlan", "AddOns"]} />);
  await screen.findAllByText("Extra seats");

  expect(screen.queryByRole("button", { name: "Manage add-ons" })).toBeNull();
  // Said on each card that would have opened the panel.
  expect(
    screen.getAllByText(
      "Your plan starts once your payment is confirmed. You can change add-ons after that.",
    ),
  ).toHaveLength(2);
});

test("the stepper stops at the most an instance may hold, and at none", async () => {
  const portal = structuredClone(answers.portal);
  portal.addOns[0]!.quantity = 50;
  mount(sessionServer({ portal }), <AddOns />);
  await openPanel();

  expect(off(inPanel().getByRole("button", { name: "Add one Extra seats" }))).toBe(true);
  expect(off(inPanel().getByRole("button", { name: "Remove one Extra seats" }))).toBe(false);
  // An add-on with no limit has no ceiling.
  expect(off(inPanel().getByRole("button", { name: "Add one GPU pack" }))).toBe(false);

  await pressInPanel("Remove one GPU pack");
  expect(off(inPanel().getByRole("button", { name: "Remove one GPU pack" }))).toBe(true);
  // A press on a stepper at its limit does nothing.
  await pressInPanel("Remove one GPU pack");
  expect(staged("GPU pack")).toBe("0");
});

test("Confirm is out of use until something is changed, and again once it is set back", async () => {
  mount(sessionServer(), <AddOns />);
  await openPanel();
  const confirm = () => inPanel().getByRole("button", { name: "Confirm changes" });

  expect(off(confirm())).toBe(true);
  await pressInPanel("Add one Extra seats");
  expect(off(confirm())).toBe(false);
  await pressInPanel("Remove one Extra seats");
  expect(off(confirm())).toBe(true);
  expect(inPanel().getByText("No changes yet.")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Confirming, and cancelling
// ---------------------------------------------------------------------------

test("Confirm sends one change per add-on, in order, and the portal then says what they did", async () => {
  const server = sessionServer();
  mount(server, <AddOns />);
  await openPanel();
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Remove one GPU pack");

  await pressInPanel("Confirm changes");

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(sent(server)).toEqual(["extra-seats-v1=5", "gpu-pack-v1=0"]);
  // Each change read the portal again: the card is what the server now holds.
  expect(server.to("GET", "portal").length).toBeGreaterThanOrEqual(3);
  expect(held()).toEqual(["Extra seats€10.00/month× 5"]);
  expect(screen.getByText("Your add-ons have been updated.").getAttribute("role")).toBe("status");
});

test("Cancel drops what was set and sends nothing; the panel opens again on the server's quantities", async () => {
  const server = sessionServer();
  mount(server, <AddOns />);
  await openPanel();
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Cancel");

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(sent(server)).toEqual([]);
  expect(screen.queryByText("Your add-ons have been updated.")).toBeNull();

  await openPanel();
  expect(staged("Extra seats")).toBe("3");
  expect(inPanel().getByText("No changes yet.")).toBeTruthy();
});

test("Escape closes the panel as Cancel does, and the keyboard is back on the button that opened it", async () => {
  const server = sessionServer();
  mount(server, <AddOns />);
  const dialog = await openPanel();
  // The keyboard is in the panel.
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  await pressInPanel("Add one Extra seats");

  await act(async () => {
    fireEvent.keyDown(dialog, { key: "Escape" });
  });

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(sent(server)).toEqual([]);
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Manage add-ons" })),
  );
});

test("Confirm stops at the first refusal, says it of that add-on, and sends nothing after it", async () => {
  const server = sessionServer();
  server.script("PUT addons/extra-seats-v1", refusal("addonIncompatible"));
  mount(server, <AddOns />);
  await openPanel();
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Add one GPU pack");

  await pressInPanel("Confirm changes");

  expect(
    await inPanel().findByText(
      "Extra seats: This add-on isn't available with your plan or its billing period.",
    ),
  ).toBeTruthy();
  expect(sent(server)).toEqual(["extra-seats-v1=4"]);
  // Nothing went through: both changes are still the panel's, and the card is as it was.
  expect(changes()).toHaveLength(2);
  expect(held()).toEqual(["Extra seats€10.00/month× 3", "GPU pack× 1"]);
});

test("the changes before a refusal went through: the summary holds the rest, and can be sent again", async () => {
  const server = sessionServer();
  server.script("PUT addons/gpu-pack-v1", refusal("addonIncompatible"));
  mount(server, <AddOns />);
  await openPanel();
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Add one GPU pack");

  await pressInPanel("Confirm changes");

  expect(await inPanel().findByText(/^GPU pack: /)).toBeTruthy();
  expect(sent(server)).toEqual(["extra-seats-v1=4", "gpu-pack-v1=2"]);
  await waitFor(() => expect(held()[0]).toBe("Extra seats€10.00/month× 4"));
  expect(changes()).toEqual([
    `GPU pack 1 → 2 +1Takes effect now, and is billed from your renewal on ${RENEWAL}.`,
  ]);

  // The next press clears the sentence; the second try goes through, and the panel closes.
  await pressInPanel("Confirm changes");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(sent(server)).toEqual(["extra-seats-v1=4", "gpu-pack-v1=2", "gpu-pack-v1=2"]);
  expect(held()).toEqual(["Extra seats€10.00/month× 4", "GPU pack× 2"]);
});

/** A refusal of `PUT /public/session/addons/{addonSlug}`, as Kaiten's are: the recorded one, with another code. */
const addonRefusal = (status: number, code: string) => ({
  status,
  body: {
    ...answers.errors.addonIncompatible.body,
    title: status === 409 ? "Conflict" : "Unprocessable Entity",
    status,
    code: `SetSessionAddonQuantity.${code}`,
  },
});

test.each([
  [422, "AddonNotPublic", "This add-on is no longer available."],
  [422, "CurrencyMismatch", "This add-on isn't sold in the currency of your subscription."],
  [422, "Incompatible", "This add-on isn't available with your plan or its billing period."],
  [422, "QuantityExceedsMax", "That's more than this add-on allows."],
  [409, "OtherVersionAttached", "Your plan already includes another version of this add-on."],
  [
    409,
    "SubscriptionIncomplete",
    "Your plan starts once your payment is confirmed. You can change add-ons after that.",
  ],
  [422, "InstanceRequired", "Add-ons can't be changed from this page."],
  // What the portal has no word for is the generic sentence.
  [422, "SomethingNew", "That didn't work. Please try again."],
] as const)("%i .%s is said in its own words", async (status, code, said) => {
  const server = sessionServer();
  server.script("PUT addons/extra-seats-v1", addonRefusal(status, code));
  mount(server, <AddOns />);
  await openPanel();
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Confirm changes");

  const message = await inPanel().findByText(`Extra seats: ${said}`);
  expect(message.closest('[data-slot="addons-feedback"]')).not.toBeNull();
  expect(message.getAttribute("role")).toBe("alert");
  // Said once, and gone with the next change the customer makes.
  await pressInPanel("Add one Extra seats");
  expect(inPanel().queryByText(`Extra seats: ${said}`)).toBeNull();
});

test("a billing period being closed is waited out once, and said; the change then goes through", async () => {
  vi.useFakeTimers(FAKE_TIMERS);
  const server = sessionServer();
  server.script("PUT addons/extra-seats-v1", refusal("cancelBoundaryPending"));
  mount(server, <AddOns />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Manage add-ons" }));
  await settle();
  fireEvent.click(inPanel().getByRole("button", { name: "Add one Extra seats" }));
  fireEvent.click(inPanel().getByRole("button", { name: "Confirm changes" }));
  await settle();

  expect(inPanel().getByText(/We're closing your billing period/)).toBeTruthy();
  // Nothing is changed while it waits.
  expect(off(inPanel().getByRole("button", { name: "Add one Extra seats" }))).toBe(true);
  expect(off(inPanel().getByRole("button", { name: "Confirm changes" }))).toBe(true);
  expect(sent(server)).toEqual(["extra-seats-v1=4"]);

  await settle(60_000);
  expect(sent(server)).toEqual(["extra-seats-v1=4", "extra-seats-v1=4"]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(held()[0]).toBe("Extra seats€10.00/month× 4");
});

test("a panel closed while its changes are sent sends no further one", async () => {
  vi.useFakeTimers(FAKE_TIMERS);
  const server = sessionServer();
  server.script("PUT addons/extra-seats-v1", refusal("cancelBoundaryPending"));
  mount(server, <AddOns />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Manage add-ons" }));
  await settle();
  fireEvent.click(inPanel().getByRole("button", { name: "Add one Extra seats" }));
  fireEvent.click(inPanel().getByRole("button", { name: "Add one GPU pack" }));
  fireEvent.click(inPanel().getByRole("button", { name: "Confirm changes" }));
  await settle();
  expect(sent(server)).toEqual(["extra-seats-v1=4"]);

  // Cancelled during the wait: the wait is not carried through, and the GPU pack is never sent.
  fireEvent.click(inPanel().getByRole("button", { name: "Cancel" }));
  await settle(60_000);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(sent(server)).toEqual(["extra-seats-v1=4"]);
});

// ---------------------------------------------------------------------------
// In another language, unstyled, and in the whole portal
// ---------------------------------------------------------------------------

test("in French", async () => {
  const server = sessionServer();
  server.script("PUT addons/extra-seats-v1", addonRefusal(422, "CurrencyMismatch"));
  mount(server, <AddOns />, fr);
  const [button] = await screen.findAllByRole("button", { name: "Gérer les options" });
  await act(async () => {
    fireEvent.click(button!);
  });
  const dialog = screen.getByRole("dialog", { name: "Gérer les options" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter un Extra seats" }));

  const line = flat(dialog.querySelector('[data-slot="addon-change"]')!.textContent);
  expect(line).toContain("Effectif tout de suite, et facturé à partir de votre renouvellement du");
  expect(line).toContain("2026");

  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer les modifications" }));
  });
  expect(flat((await within(dialog).findByRole("alert")).textContent)).toBe(
    "Extra seats : Cette option n'est pas vendue dans la devise de votre abonnement.",
  );
});

test("unstyled, the panel is the native dialog and plain buttons, and works the same", async () => {
  const server = sessionServer();
  mount(server, <AddOns unstyled />);
  const dialog = await openPanel();

  expect(dialog.tagName).toBe("DIALOG");
  // The host's to style: the SDK's geometry, centred in the top layer, and none of its chrome.
  expect(dialog.className).toBe("ktn-own ktn-dialog");
  for (const button of within(dialog).getAllByRole("button")) {
    expect(button.getAttribute("class")).toBeNull();
  }
  expect(within(dialog).getByRole("heading", { name: "Manage add-ons" })).toBeTruthy();

  await pressInPanel("Add one Extra seats");
  await pressInPanel("Confirm changes");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(sent(server)).toEqual(["extra-seats-v1=4"]);
  await waitFor(() => expect(held()[0]).toBe("Extra seats × 4 €10.00/month"));
});

test("in the whole portal, the plan card and the add-ons card both open it", async () => {
  mount(sessionServer(), <CustomerPortal />);
  await screen.findByText("Invoices");
  const buttons = await screen.findAllByRole("button", { name: "Manage add-ons" });
  expect(buttons).toHaveLength(2);
  expect(buttons[0]!.closest('[data-slot="card"]')!.textContent).toContain("Current plan");
  expect(buttons[1]!.closest('[data-slot="card"]')!.textContent).toContain("Add-ons");

  await act(async () => {
    fireEvent.click(buttons[1]!);
  });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

test("the changes are said once in the portal: by the card they were made from, until a panel opens again", async () => {
  mount(sessionServer(), <CustomerPortal elements={["CurrentPlan", "AddOns"]} />);
  const [fromThePlan, fromTheCard] = await screen.findAllByRole("button", {
    name: "Manage add-ons",
  });
  const updated = () => screen.queryAllByText("Your add-ons have been updated.");

  await act(async () => {
    fireEvent.click(fromThePlan!);
  });
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Confirm changes");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(updated()).toHaveLength(1);
  expect(updated()[0]!.closest('[data-slot="card"]')!.textContent).toContain("Current plan");

  // Another panel opens: what the first said is no longer the last word.
  await act(async () => {
    fireEvent.click(fromTheCard!);
  });
  expect(updated()).toHaveLength(0);
  await pressInPanel("Add one Extra seats");
  await pressInPanel("Confirm changes");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(updated()).toHaveLength(1);
  expect(updated()[0]!.closest('[data-slot="card"]')!.textContent).toContain("Add-ons");
});

test("removing the last add-on keeps the card, which says so, and the keyboard goes to what it says", async () => {
  // No catalogue is read: once the GPU pack goes, nothing is held and nothing is offered.
  const portal = structuredClone(answers.portal);
  portal.addOns = portal.addOns.filter((addon) => addon.addonSlug === "gpu-pack-v1");
  const server = sessionServer({ portal });
  mount(server, <AddOns />);
  await openPanel();
  await pressInPanel("Remove one GPU pack");
  await pressInPanel("Confirm changes");

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(sent(server)).toEqual(["gpu-pack-v1=0"]);
  // The card stays, with what the instance now holds and the sentence of the changes; the button
  // that opened the panel is gone with the add-ons, and the keyboard is on the sentence.
  expect(screen.getByText("You have no add-ons yet.")).toBeTruthy();
  const sentence = screen.getByText("Your add-ons have been updated.");
  expect(screen.queryByRole("button", { name: "Manage add-ons" })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(sentence));
});
