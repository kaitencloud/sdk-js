// @vitest-environment jsdom
//
// A customer's checkout, drawn: what they choose, what the server says is due, the provider's
// page for a payment method and the way back from it, and what became of the payment. The
// session is a double scripted with what a server would say, and the hooks under the component
// are the real ones: what is pinned is what a customer sees and what reaches the API.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Addon, BillingPrice, CheckoutInput, CheckoutResult } from "@kaitencloud/client";
import { DEMO_SESSION_NOW, demoVouchers } from "@kaitencloud/client/testing";
import { fr } from "@kaitencloud/react/locales";

import { CheckoutFlow, type CheckoutFlowProps } from "../src/index.ts";
import {
  FAKE_TIMERS,
  activationInvoice,
  alreadySubscribed,
  billingEmailRequired,
  callsOf,
  cannotCapture,
  demoPortal,
  demoUnsubscribedPortal,
  extraSeats,
  growthPlan,
  line,
  previewOf,
  providerUnavailable,
  quotaExceeded,
  rateLimited,
  sessionProvider,
  setupIncomplete,
  settle,
  subscribed,
  trialPreview,
  unsubscribedSession,
  voucherInvalid,
} from "./support/checkout.tsx";
import { off } from "./support/session-mount.tsx";

const GROWTH_MONTHLY = "price_growth_monthly";
const GROWTH_ANNUAL = "price_growth_annual";
const plan = growthPlan();

/** A default fee in dollars of `amount` minor units, every month or every year. */
const fee = (id: string, amount: number, interval: "month" | "year"): BillingPrice => ({
  id,
  amount,
  unitAmountDecimal: `${amount}`,
  currencyCode: "USD",
  billingModel: "FLAT_FEE",
  isDefault: true,
  interval,
  label: interval === "year" ? "Annual" : "Monthly",
});

/** The seats as the catalogue sells them: a paid add-on with a monthly fee, and none by the year. */
const seatsByTheMonth: Addon = { ...extraSeats, pricingType: "PAID" };
/** Storage, paid, by the month or by the year. */
const storage: Addon = {
  ...extraSeats,
  slug: "extra-storage-v1",
  familySlug: "extra-storage",
  name: "Extra storage",
  pricingType: "PAID",
  billingPrices: [
    fee("price_storage_monthly", 500, "month"),
    fee("price_storage_annual", 5000, "year"),
  ],
};
/** GPU hours: paid, metered only, so billed no flat fee for any period. */
const gpuHours: Addon = {
  ...extraSeats,
  slug: "gpu-hours-v1",
  familySlug: "gpu-hours",
  name: "GPU hours",
  pricingType: "PAID",
  billingPrices: [
    {
      id: "price_gpu_hours",
      amount: 90,
      unitAmountDecimal: "90",
      currencyCode: "USD",
      billingModel: "USAGE_BASED",
      isDefault: false,
    },
  ],
};
/** Priority support: free, with a fee of nothing, by the year alone. */
const prioritySupport: Addon = {
  ...extraSeats,
  slug: "priority-support-v1",
  familySlug: "priority-support",
  name: "Priority support",
  pricingType: "FREE",
  billingPrices: [fee("price_priority_support_annual", 0, "year")],
};

const at = (url: string) => window.history.replaceState(null, "", url);

beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  // The double's setup pages expire an hour after the instant its portal was read.
  vi.setSystemTime(new Date(DEMO_SESSION_NOW));
  window.sessionStorage.clear();
  at("/billing?tab=plan#top");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Client = ReturnType<typeof unsubscribedSession>;

const commits = (client: Client) =>
  (callsOf(client, "checkout") as CheckoutInput[]).filter((input) => !input.dryRun);
const previews = (client: Client) =>
  (callsOf(client, "checkout") as CheckoutInput[]).filter((input) => input.dryRun);

async function draw(
  client: Client,
  props: Partial<CheckoutFlowProps> = {},
  extra: Parameters<typeof sessionProvider>[1] = {},
) {
  const Wrapper = sessionProvider(client, extra);
  const view = render(
    <Wrapper>
      <CheckoutFlow plan={plan} addOns={[extraSeats]} {...props} />
    </Wrapper>,
  );
  await settle();
  return view;
}

/** The links of the flow, not the "Powered by" one of its footer. */
const links = () =>
  within(flow())
    .queryAllByRole("link")
    .filter((link) => link.getAttribute("aria-label") !== "Powered by Kaiten");
const flow = () => document.querySelector<HTMLElement>('[data-slot="checkout-flow"]')!;
const button = (name: string | RegExp) => screen.getByRole("button", { name });
/** What the server says is due, as the summary writes it. */
const total = () =>
  flow().querySelector('[data-slot="checkout-summary-lines"] [role="status"]')!.textContent;
const quantity = (name: string) =>
  within(flow()).getByRole("status", { name: `Quantity of ${name}` }).textContent;
/** The names of the add-ons offered, in their order. */
const names = () =>
  [...flow().querySelectorAll('[data-slot="checkout-flow-addons"] li')].map(
    (row) => row.querySelector("span > span")!.textContent,
  );

/** Pressing something, and letting what it starts settle. */
async function press(target: HTMLElement, wait = 0) {
  await act(async () => fireEvent.click(target));
  await settle(wait);
}

/** What a small mock server says is due for a selection: seats at $25.00, 20% off the base fee. */
function dryRun(input: CheckoutInput): CheckoutResult {
  const base = input.licensePriceId === GROWTH_ANNUAL ? 79000 : 7900;
  const seats = input.addOns?.reduce((count, entry) => count + entry.quantity, 0) ?? 0;
  if (input.voucherCode && input.voucherCode.trim().toUpperCase() !== "WELCOME20") {
    throw voucherInvalid();
  }
  const discount = input.voucherCode ? Math.round(base / 5) : 0;
  return previewOf(base + seats * 2500 - discount, [
    line(1, "BASE", "Growth", base),
    ...(seats ? [line(2, "ADDON", "Extra seats", seats * 2500, `${seats} × 25.00 USD`)] : []),
    ...(discount ? [line(3, "DISCOUNT", "Welcome 20%", -discount)] : []),
  ]);
}

/** A double that prices selections as the mock server does, and answers a commit as `commit` says. */
function selling(
  commit: (input: CheckoutInput) => CheckoutResult | Error | Promise<CheckoutResult> = () =>
    subscribed("paid"),
  preview: (input: CheckoutInput) => CheckoutResult | Error = dryRun,
  portal = demoUnsubscribedPortal(),
): Client {
  return unsubscribedSession({
    portal,
    vouchers: demoVouchers(),
    checkout: (input) => {
      if (input.dryRun) {
        const answer = preview(input);
        if (answer instanceof Error) throw answer;
        return answer;
      }
      const answer = commit(input);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

describe("choosing", () => {
  test("a plan is billing periods, add-ons, a code and what is due, with a statement about cards", async () => {
    const client = selling();
    await draw(client);

    const root = within(flow());
    expect(root.getByText("Growth", { selector: '[data-slot="card-title"]' })).toBeTruthy();
    // The two billing periods, in the words of the price, the monthly one chosen.
    const periods = root.getAllByRole("radio");
    expect(periods.map((radio) => radio.parentElement!.textContent)).toEqual([
      "$79.00/month",
      "$790.00/year",
    ]);
    expect(periods.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(root.getByRole("group", { name: "Billing interval" })).toBeTruthy();
    expect(root.getByRole("radiogroup", { name: "Billing interval" })).toBeTruthy();
    // The add-on, its price, and a quantity of none.
    expect(root.getByText("Extra seats")).toBeTruthy();
    expect(root.getByText("$25.00/month")).toBeTruthy();
    expect(quantity("Extra seats")).toBe("0");
    expect(root.getByLabelText("Voucher code")).toBeTruthy();
    // What is due, and the statement: card details are the provider's.
    expect(root.getByText("Due today")).toBeTruthy();
    expect(total()).toBe("$79.00");
    expect(root.getByText(/handled by the payment provider/)).toBeTruthy();
    expect(previews(client)).toEqual([{ licensePriceId: GROWTH_MONTHLY, dryRun: true }]);
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);
  });

  test("a quantity stepped up is one request, 300 ms after the last step; at its maximum the step stops", async () => {
    const client = selling();
    await draw(client, { addOns: [{ ...extraSeats, maxQuantity: 3 }] });

    const more = button("Add one Extra seats");
    for (let step = 0; step < 3; step += 1) {
      await act(async () => fireEvent.click(more));
      await settle(100);
    }
    expect(off(more)).toBe(true);
    // The summary on screen is the last answer, until the pause has gone by; nothing can be bought on it.
    expect(previews(client)).toHaveLength(1);
    expect(total()).toBe("$79.00");
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);

    await settle(200);
    expect(previews(client)).toHaveLength(2);
    expect(previews(client)[1]).toEqual({
      licensePriceId: GROWTH_MONTHLY,
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 3 }],
      dryRun: true,
    });
    expect(quantity("Extra seats")).toBe("3");
    expect(total()).toBe("$154.00");
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);

    const fewer = button("Remove one Extra seats");
    for (let step = 0; step < 3; step += 1) await act(async () => fireEvent.click(fewer));
    expect(off(fewer)).toBe(true);
    await settle(300);
    expect(previews(client).at(-1)).toEqual({ licensePriceId: GROWTH_MONTHLY, dryRun: true });
  });

  test("another billing period is another price, priced again", async () => {
    const client = selling();
    await draw(client);

    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "$790.00/year" })));
    await settle(300);
    expect(previews(client).at(-1)).toEqual({ licensePriceId: GROWTH_ANNUAL, dryRun: true });
    expect(total()).toBe("$790.00");
  });

  test("the arrow keys move the choice from one period to the next, as in any radio group", async () => {
    const client = selling();
    await draw(client);

    const [monthly, annual] = screen.getAllByRole("radio");
    act(() => monthly!.focus());
    // Base UI moves the focus in a microtask, which has to find the key's update rendered. A
    // synchronous act renders it on the way out; React 18's async act would only render it
    // after the microtask, where a browser renders it before.
    act(() => {
      fireEvent.keyDown(monthly!, { key: "ArrowRight" });
    });
    await act(async () => {});
    await settle(300);
    expect(document.activeElement).toBe(annual);
    expect(annual!.getAttribute("aria-checked")).toBe("true");
    expect(monthly!.getAttribute("aria-checked")).toBe("false");
    expect(previews(client).at(-1)).toEqual({ licensePriceId: GROWTH_ANNUAL, dryRun: true });
  });

  test("the price the host asks for is the one chosen, and a plan with one price offers no choice", async () => {
    const client = selling();
    await draw(client, { priceId: GROWTH_ANNUAL });
    expect(previews(client)[0]!.licensePriceId).toBe(GROWTH_ANNUAL);
    cleanup();

    const single = selling();
    await draw(single, {
      plan: growthPlan({ billingPrices: growthPlan().billingPrices!.slice(0, 1) }),
    });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(previews(single)[0]!.licensePriceId).toBe(GROWTH_MONTHLY);
  });

  test("a plan with no price to buy says so, and asks the server nothing", async () => {
    const client = selling();
    await draw(client, { plan: growthPlan({ billingPrices: [] }) });
    expect(screen.getByText("This plan can't be bought online.")).toBeTruthy();
    expect(previews(client)).toHaveLength(0);
  });

  test("an add-on in another currency than the plan's is not offered, and none is without a catalogue", async () => {
    const euros = {
      ...extraSeats,
      billingPrices: extraSeats.billingPrices!.map((price) => ({
        ...price,
        currencyCode: "EUR" as const,
      })),
    };
    await draw(selling(), { addOns: [euros] });
    expect(screen.queryByText("Extra seats")).toBeNull();
    cleanup();

    // The provider has no catalogue (no key, no client): nothing to offer unless the host says.
    await draw(selling(), { addOns: undefined });
    expect(screen.queryByText("Extra seats")).toBeNull();
  });

  test("an add-on is offered at its fee for the period chosen, and not for a period it has none for", async () => {
    // Seats are paid for by the month only; storage by the month or by the year.
    const client = selling();
    await draw(client, { addOns: [seatsByTheMonth, storage] });

    const root = within(flow());
    expect(names()).toEqual(["Extra seats", "Extra storage"]);
    expect(root.getByText("$25.00/month")).toBeTruthy();
    expect(root.getByText("$5.00/month")).toBeTruthy();

    await press(screen.getByRole("radio", { name: "$790.00/year" }), 300);
    // By the year Kaiten attaches no seats: they are not offered, at their monthly fee or any.
    expect(names()).toEqual(["Extra storage"]);
    expect(root.queryByText("Extra seats")).toBeNull();
    expect(root.queryByText("$25.00/month")).toBeNull();
    expect(root.getByText("$50.00/year")).toBeTruthy();
    expect(root.queryByText("$5.00/month")).toBeNull();
  });

  test("an add-on chosen leaves the selection with a period that does not sell it, and is never sent with it", async () => {
    const client = selling();
    await draw(client, {
      addOns: [seatsByTheMonth, storage],
      initialQuantities: { "extra-seats-v1": 2, "extra-storage-v1": 1 },
    });
    expect(previews(client)[0]!.addOns).toEqual([
      { addonSlug: "extra-seats-v1", quantity: 2 },
      { addonSlug: "extra-storage-v1", quantity: 1 },
    ]);

    await press(screen.getByRole("radio", { name: "$790.00/year" }), 300);
    expect(previews(client).at(-1)).toEqual({
      licensePriceId: GROWTH_ANNUAL,
      addOns: [{ addonSlug: "extra-storage-v1", quantity: 1 }],
      dryRun: true,
    });
    // No request ever asked for seats by the year, to price or to buy.
    await press(button(/^Subscribe/));
    expect(commits(client)).toHaveLength(1);
    for (const input of callsOf(client, "checkout") as CheckoutInput[]) {
      if (input.licensePriceId !== GROWTH_ANNUAL) continue;
      expect(input.addOns?.map((entry) => entry.addonSlug)).toEqual(["extra-storage-v1"]);
    }
  });

  test("a quantity is not kept for an add-on that left: back on its period it is at none", async () => {
    const client = selling();
    await draw(client, {
      addOns: [seatsByTheMonth, storage],
      initialQuantities: { "extra-seats-v1": 2 },
    });
    await press(screen.getByRole("radio", { name: "$790.00/year" }), 300);
    await press(screen.getByRole("radio", { name: "$79.00/month" }), 300);

    expect(quantity("Extra seats")).toBe("0");
    expect(previews(client).at(-1)).toEqual({ licensePriceId: GROWTH_MONTHLY, dryRun: true });
  });

  test("a quantity the host starts from for an add-on the first price does not sell is not sent", async () => {
    const client = selling();
    await draw(client, {
      priceId: GROWTH_ANNUAL,
      addOns: [seatsByTheMonth, storage],
      initialQuantities: { "extra-seats-v1": 2, "extra-storage-v1": 1 },
    });
    expect(previews(client)).toEqual([
      {
        licensePriceId: GROWTH_ANNUAL,
        addOns: [{ addonSlug: "extra-storage-v1", quantity: 1 }],
        dryRun: true,
      },
    ]);
    expect(names()).toEqual(["Extra storage"]);
  });

  test("add-ons the host hands over later are held to the same rule", async () => {
    // At first the host offers nothing: a quantity for a slug the flow knows nothing of is the
    // host's, and is sent. Once the seats are handed over, the year is found not to sell them.
    const client = selling();
    const Wrapper = sessionProvider(client);
    const drawn = (addOns: CheckoutFlowProps["addOns"]) => (
      <Wrapper>
        <CheckoutFlow
          plan={plan}
          priceId={GROWTH_ANNUAL}
          addOns={addOns}
          initialQuantities={{ "extra-seats-v1": 2 }}
        />
      </Wrapper>
    );
    const view = render(drawn([]));
    await settle();
    expect(previews(client)[0]!.addOns).toEqual([{ addonSlug: "extra-seats-v1", quantity: 2 }]);

    view.rerender(drawn([seatsByTheMonth]));
    await settle(300);
    expect(previews(client).at(-1)).toEqual({ licensePriceId: GROWTH_ANNUAL, dryRun: true });
    expect(screen.queryByText("Extra seats")).toBeNull();
  });

  test("an add-on billed no flat fee for the period is offered, and shown with no fee of another", async () => {
    // GPU hours are metered only; priority support is free, with a fee of $0.00 by the year alone.
    // Kaiten attaches both beside a monthly price, and bills neither a monthly fee.
    const client = selling();
    await draw(client, { addOns: [gpuHours, prioritySupport] });

    expect(names()).toEqual(["GPU hours", "Priority support"]);
    expect(within(flow()).queryByText("$0.00/year")).toBeNull();
    // Each row is its name and its stepper, with no amount in it.
    for (const row of flow().querySelectorAll('[data-slot="checkout-flow-addons"] li')) {
      expect(row.textContent).not.toContain("$");
    }
  });

  test("the quantities the host starts from are the first selection", async () => {
    const client = selling();
    await draw(client, { initialQuantities: { "extra-seats-v1": 2 } });
    expect(quantity("Extra seats")).toBe("2");
    expect(previews(client)[0]).toEqual({
      licensePriceId: GROWTH_MONTHLY,
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      dryRun: true,
    });
  });

  test("a plan with a trial is subscribed with it: nothing offers to start without it", async () => {
    const client = selling(undefined, () => trialPreview("2026-02-01T00:00:00.000Z"));
    await draw(client, { plan: growthPlan({ trialPeriodDays: 14 }) });
    expect(total()).toBe("$0.00 today");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(flow().querySelector('input[type="checkbox"]')).toBeNull();
    expect(within(flow()).queryByText(/without the free trial/i)).toBeNull();

    await press(button(/^Subscribe|^Start/));
    expect(commits(client)).toHaveLength(1);
    // No call asks the server to leave the trial out: the plan's own is the one it applies.
    for (const input of callsOf(client, "checkout") as CheckoutInput[]) {
      expect(input).not.toHaveProperty("trial");
    }
  });

  test("unstyled, a plan with a trial has no checkbox either", async () => {
    await draw(
      selling(undefined, () => trialPreview("2026-02-01T00:00:00.000Z")),
      {
        plan: growthPlan({ trialPeriodDays: 14 }),
        unstyled: true,
      },
    );
    expect(within(flow()).getByText("Trial ends on Feb 1, 2026")).toBeTruthy();
    expect(flow().querySelector('input[type="checkbox"]')).toBeNull();
  });

  test("a trial is nothing due today, and the day it ends", async () => {
    const client = selling(undefined, () => trialPreview("2026-02-01T00:00:00.000Z"));
    await draw(client, { plan: growthPlan({ trialPeriodDays: 14 }) });
    expect(total()).toBe("$0.00 today");
    expect(within(flow()).getByText("Trial ends on Feb 1, 2026")).toBeTruthy();
  });

  test("a customer with no billing email sees what is due at once, and is asked for one to subscribe", async () => {
    const portal = demoUnsubscribedPortal();
    const client = selling(undefined, dryRun, {
      ...portal,
      customer: { ...portal.customer, billingEmail: null },
    });
    await draw(client);

    const field = screen.getByLabelText("Billing email") as HTMLInputElement;
    expect(field.type).toBe("email");
    expect(field.required).toBe(true);
    expect(field.getAttribute("aria-describedby")).toBe(
      screen.getByText("Invoices are sent to this address.").id,
    );
    // Priced without an address, which only the subscribing needs.
    expect(previews(client)).toEqual([{ licensePriceId: GROWTH_MONTHLY, dryRun: true }]);
    expect(total()).toBe("$79.00");
    expect(screen.getByText("Enter your billing email to subscribe.")).toBeTruthy();
    expect(screen.queryByText("Enter your billing email to see what is due today.")).toBeNull();
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);
    expect(field.getAttribute("aria-invalid")).toBeNull();

    // An address that cannot be one is marked, and Subscribe still waits.
    fireEvent.change(field, { target: { value: "ops@" } });
    await settle(300);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter your billing email to subscribe.")).toBeTruthy();
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);

    fireEvent.change(field, { target: { value: "ops@acme.example" } });
    await settle(300);
    // The address changes nothing that is due: the summary is not asked for again.
    expect(previews(client)).toHaveLength(1);
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText("Enter your billing email to subscribe.")).toBeNull();
    expect(total()).toBe("$79.00");
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);

    await press(button(/^Subscribe/));
    expect(commits(client)[0]).toMatchObject({ billingEmail: "ops@acme.example" });
  });

  test("an older Kaiten that prices nothing without an address is answered with the email field first", async () => {
    const portal = demoUnsubscribedPortal();
    const client = selling(
      undefined,
      (input) => (input.billingEmail ? dryRun(input) : billingEmailRequired()),
      { ...portal, customer: { ...portal.customer, billingEmail: null } },
    );
    await draw(client);

    expect(screen.getByText("Enter your billing email to see what is due today.")).toBeTruthy();
    expect(screen.queryByText("Enter your billing email to subscribe.")).toBeNull();
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Billing email"), {
      target: { value: "ops@acme.example" },
    });
    await settle(300);
    expect(previews(client).at(-1)).toEqual({
      licensePriceId: GROWTH_MONTHLY,
      billingEmail: "ops@acme.example",
      dryRun: true,
    });
    expect(screen.queryByText("Enter your billing email to see what is due today.")).toBeNull();
    expect(total()).toBe("$79.00");
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);
  });

  test("a host that cancels is given a cancel button, which is not a way to subscribe", async () => {
    const onCancel = vi.fn();
    const client = selling();
    await draw(client, { onCancel });
    await press(button("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(commits(client)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A voucher code
// ---------------------------------------------------------------------------

describe("a voucher code", () => {
  const apply = async (code: string) => {
    fireEvent.change(screen.getByLabelText("Voucher code"), { target: { value: code } });
    await press(button("Apply"), 300);
  };

  test("is typed once: applied, it has left the field, the page, the address and the logs", async () => {
    const logged: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
    }
    const client = selling();
    await draw(client);

    const field = screen.getByLabelText("Voucher code") as HTMLInputElement;
    fireEvent.change(field, { target: { value: " welcome20 " } });
    expect(button("Apply")).toHaveProperty("disabled", false);
    await press(button("Apply"), 300);

    // The server priced the selection with the code, which went in the body of that call.
    expect(previews(client).at(-1)).toEqual({
      licensePriceId: GROWTH_MONTHLY,
      voucherCode: "welcome20",
      dryRun: true,
    });
    expect(screen.getByText("Voucher applied")).toBeTruthy();
    expect(within(flow()).getByText("Welcome 20%")).toBeTruthy();
    expect(within(flow()).getByText("-$15.80")).toBeTruthy();
    expect(total()).toBe("$63.20");
    expect(screen.queryByLabelText("Voucher code")).toBeNull();
    // Not in the page, not in a field, not in the address, not in a log.
    expect(document.documentElement.innerHTML.toLowerCase()).not.toContain("welcome20");
    expect(
      [...document.querySelectorAll("input")].map((input) => input.value.toLowerCase()),
    ).not.toContain("welcome20");
    expect(window.location.href.toLowerCase()).not.toContain("welcome20");
    expect(JSON.stringify(logged).toLowerCase()).not.toContain("welcome20");

    // Removing it prices the selection without it again.
    await press(button("Remove voucher"), 300);
    expect(screen.getByLabelText("Voucher code")).toBeTruthy();
    expect(previews(client).at(-1)).toEqual({ licensePriceId: GROWTH_MONTHLY, dryRun: true });
  });

  test("that cannot be used says so in a sentence that gives no reason, and keeps the summary", async () => {
    const client = selling();
    await draw(client);
    await apply("NOPE");

    const alert = within(flow()).getByRole("alert");
    expect(alert.textContent).toBe("This code can't be used.");
    const field = screen.getByLabelText("Voucher code") as HTMLInputElement;
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    // The summary it had is still there, and nothing can be bought until the customer says what to do.
    expect(total()).toBe("$79.00");
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);
    expect(field.value).toBe("");
    expect(document.documentElement.innerHTML).not.toContain("NOPE");

    // Removing it is how the customer goes on without one.
    await press(button("Remove voucher"));
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);
    expect(within(flow()).queryByRole("alert")).toBeNull();
  });

  test("is applied with the Enter key, and an empty field applies nothing", async () => {
    const client = selling();
    await draw(client);
    expect(button("Apply")).toHaveProperty("disabled", true);

    const field = screen.getByLabelText("Voucher code");
    fireEvent.change(field, { target: { value: "WELCOME20" } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    await settle(300);
    expect(screen.getByText("Voucher applied")).toBeTruthy();
  });
});

describe("a voucher code that is not the checkout's yet", () => {
  test("typed and not applied holds Subscribe back, and says why", async () => {
    const client = selling();
    await draw(client);
    const field = screen.getByLabelText("Voucher code");
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);

    fireEvent.change(field, { target: { value: "WELCOME20" } });
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);
    const hint = within(flow()).getByText("Apply the code, or clear the field, to continue.");
    expect(field.getAttribute("aria-describedby")).toBe(hint.id);

    // Cleared, it is nothing; applied, it is the checkout's.
    fireEvent.change(field, { target: { value: "" } });
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);
    fireEvent.change(field, { target: { value: "WELCOME20" } });
    await press(button("Apply"), 300);
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);
    expect(within(flow()).queryByText(/Apply the code/)).toBeNull();
  });

  test("taken by the preview and refused at the checkout is one sentence, a price without it, and a way on", async () => {
    const client = selling(() => voucherInvalid());
    await draw(client);
    fireEvent.change(screen.getByLabelText("Voucher code"), { target: { value: "WELCOME20" } });
    await press(button("Apply"), 300);
    expect(total()).toBe("$63.20");

    await press(button(/^Subscribe/), 300);

    const alerts = within(flow()).getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual(["This code can't be used."]);
    expect(within(flow()).queryByText("Voucher applied")).toBeNull();
    // Priced again without it, so that no discount that is not coming is on screen.
    expect(total()).toBe("$79.00");
    expect(previews(client).at(-1)).toEqual({ licensePriceId: GROWTH_MONTHLY, dryRun: true });
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);

    await press(button("Remove voucher"), 300);
    expect(within(flow()).queryByRole("alert")).toBeNull();
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);
  });
});

describe("where the keyboard is", () => {
  test("a voucher that is applied keeps it, on the sentence that says so, and gives it back to the field when removed", async () => {
    const client = selling();
    await draw(client);
    const field = screen.getByLabelText("Voucher code");
    field.focus();
    fireEvent.change(field, { target: { value: "WELCOME20" } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    await settle(300);

    const applied = within(flow()).getByText("Voucher applied");
    expect(document.activeElement).toBe(applied);

    const remove = button("Remove voucher");
    remove.focus();
    await press(remove, 300);
    expect(document.activeElement).toBe(screen.getByLabelText("Voucher code"));
  });

  test("subscribing leaves it on what the checkout says first, and a refusal on the refusal", async () => {
    const client = selling(() => quotaExceeded("seats"));
    await draw(client);
    const subscribe = button(/^Subscribe/);
    subscribe.focus();
    await press(subscribe);

    const refusal = within(flow()).getByRole("alert");
    expect(document.activeElement).toBe(refusal);
    cleanup();

    const paid = selling();
    await draw(paid);
    const again = button(/^Subscribe/);
    again.focus();
    await press(again);
    expect(document.activeElement).toBe(within(flow()).getByText("You're subscribed"));
  });

  test("the step of an add-on stays on its button, at its limits too", async () => {
    const client = selling();
    await draw(client, { addOns: [{ ...extraSeats, maxQuantity: 1 }] });
    const more = button("Add one Extra seats");
    more.focus();
    await press(more, 300);
    expect(document.activeElement).toBe(more);
    expect(off(more)).toBe(true);

    const fewer = button("Remove one Extra seats");
    fewer.focus();
    await press(fewer, 300);
    expect(document.activeElement).toBe(fewer);
    expect(off(fewer)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Subscribing
// ---------------------------------------------------------------------------

describe("subscribing", () => {
  test("a customer with a payment method is subscribed at once, the return address being this page", async () => {
    const onSubscribed = vi.fn();
    const client = selling(() => subscribed("paid"));
    await draw(client, { onSubscribed });
    await press(button(/^Subscribe/));

    // What was chosen, asking to come back here if a payment method is needed: no fragment, no parameter of ours.
    const [committed] = commits(client);
    expect(committed).toMatchObject({ licensePriceId: GROWTH_MONTHLY });
    expect(new URL(committed!.returnUrl!).pathname + new URL(committed!.returnUrl!).search).toBe(
      "/billing?tab=plan",
    );
    expect(new URL(committed!.returnUrl!).hash).toBe("");
    expect(onSubscribed).toHaveBeenCalledTimes(1);
    expect(onSubscribed.mock.calls[0]![0]).toMatchObject({ status: "subscribed" });

    expect(within(flow()).getByText("You're subscribed")).toBeTruthy();
    expect(within(flow()).getByText("Payment received.")).toBeTruthy();
    const receipt = within(flow()).getByRole("link", { name: "View receipt" });
    expect(receipt.getAttribute("href")).toBe("https://pay.example.test/i/inv_activation");
    expect(receipt.getAttribute("target")).toBe("_blank");
    expect(receipt.getAttribute("rel")).toBe("noopener noreferrer");
    // The choosing is over.
    expect(screen.queryByRole("button", { name: /^Subscribe/ })).toBeNull();
  });

  test("the host's own return address is the one asked for", async () => {
    const client = selling(() => subscribed("paid"));
    await draw(client, { returnUrl: "https://app.example.test/billing/done" });
    await press(button(/^Subscribe/));
    expect(commits(client)[0]!.returnUrl).toBe("https://app.example.test/billing/done");
  });

  test("while it is made the button says so and nothing else can be changed", async () => {
    const client = selling(() => new Promise<CheckoutResult>(() => {}));
    await draw(client);
    await press(button(/^Subscribe/));

    expect(off(button(/^Processing/))).toBe(true);
    expect(screen.getByRole("radio", { name: "$790.00/year" }).matches(":disabled")).toBe(true);
    expect(button("Add one Extra seats")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Voucher code").matches(":disabled")).toBe(true);
  });

  test("a trial or a free plan is subscribed with nothing to pay", async () => {
    const client = selling(() =>
      subscribed("not_required", null, { trialEndsAt: "2026-02-01T00:00:00.000Z" }),
    );
    await draw(client);
    await press(button(/^Subscribe/));

    expect(within(flow()).getByText("You're subscribed")).toBeTruthy();
    expect(within(flow()).getByText("Trial ends on Feb 1, 2026")).toBeTruthy();
    expect(links()).toHaveLength(0);
    await settle(60_000);
    expect(callsOf(client, "listInvoices")).toHaveLength(0);
    cleanup();

    const free = selling(() => subscribed("not_required", null));
    await draw(free);
    await press(button(/^Subscribe/));
    expect(within(flow()).getByText("Nothing is due today.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A payment method first
// ---------------------------------------------------------------------------

describe("a payment method first", () => {
  /** A checkout that asks for a payment method, then subscribes once the setup session comes back with it. */
  function needingACard(then: CheckoutResult = subscribed("paid")) {
    return selling((input) =>
      input.setupSessionId
        ? then
        : {
            status: "requires_payment_method",
            setupUrl: "https://pay.example.test/setup/cs_1",
            setupSessionId: "cs_1",
            expiresAt: "2026-01-15T10:00:00.000Z",
          },
    );
  }

  const popup = () =>
    vi.spyOn(window, "open").mockReturnValue({ opener: window } as unknown as Window);

  test("the provider's page opens in a popup, and the customer says when they are done", async () => {
    const open = popup();
    const client = needingACard();
    await draw(client);
    await press(button(/^Subscribe/));

    expect(open).toHaveBeenCalledWith(
      "https://pay.example.test/setup/cs_1",
      "kaiten-setup",
      expect.any(String),
    );
    const root = within(flow());
    expect(root.getByText(/Save your payment method in the window we opened/)).toBeTruthy();
    const again = root.getByRole("link", { name: "Open the page again" });
    expect(again.getAttribute("href")).toBe("https://pay.example.test/setup/cs_1");
    expect(again.getAttribute("rel")).toBe("noopener noreferrer");

    await press(button("I've saved my payment method"));
    expect(commits(client)[1]).toEqual({
      licensePriceId: GROWTH_MONTHLY,
      setupSessionId: "cs_1",
    });
    expect(within(flow()).getByText("You're subscribed")).toBeTruthy();
  });

  test("a setup page that saved nothing is said, and the customer can go back to choosing", async () => {
    popup();
    const client = selling((input) => {
      if (input.setupSessionId) return setupIncomplete();
      return {
        status: "requires_payment_method",
        setupUrl: "https://pay.example.test/setup/cs_1",
        setupSessionId: "cs_1",
        expiresAt: "2026-01-15T10:00:00.000Z",
      };
    });
    await draw(client);
    await press(button(/^Subscribe/));
    await press(button("I've saved my payment method"));

    expect(within(flow()).getByRole("alert").textContent).toContain(
      "We haven't received a payment method yet",
    );
    expect(within(flow()).getByRole("link", { name: "Open the page again" })).toBeTruthy();

    await press(button("Cancel"));
    expect(button(/^Subscribe/)).toHaveProperty("disabled", false);
  });

  test("when popups are blocked the page itself goes there, and comes back to go on with what was chosen", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const assign = vi.fn();
    const client = needingACard();
    // `location.assign` cannot be spied in jsdom: the page is sent through the host's own hook.
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: Object.assign(new URL(original.href), { assign }),
    });
    try {
      const view = await draw(client, { initialQuantities: { "extra-seats-v1": 2 } });
      fireEvent.change(screen.getByLabelText("Voucher code"), { target: { value: "WELCOME20" } });
      await press(button("Apply"), 300);
      await press(button(/^Subscribe/));
      expect(assign).toHaveBeenCalledWith("https://pay.example.test/setup/cs_1");
      view.unmount();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }

    // The provider sends the customer back to the page: loaded again, nothing in memory but what was kept.
    at("/billing?tab=plan&kaiten_setup_session=cs_1#top");
    await draw(client);
    expect(within(flow()).getByRole("button", { name: /Processing|Subscribe/ })).toBeTruthy();
    await settle(300);

    // What had been chosen is chosen again, the checkout goes on with the setup session, and the address is clean.
    expect(commits(client)[1]).toEqual({
      licensePriceId: GROWTH_MONTHLY,
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      voucherCode: "WELCOME20",
      setupSessionId: "cs_1",
    });
    expect(within(flow()).getByText("You're subscribed")).toBeTruthy();
    expect(window.location.search).toBe("?tab=plan");
    expect(window.location.hash).toBe("#top");
    expect(window.sessionStorage.length).toBe(0);
    expect(document.documentElement.innerHTML).not.toContain("WELCOME20");
  });
});

// ---------------------------------------------------------------------------
// What became of the payment
// ---------------------------------------------------------------------------

describe("the payment", () => {
  test("a payment to confirm is a link to the provider's page, and the invoices are read until it is paid", async () => {
    const client = selling(() => subscribed("requires_action"));
    await draw(client);
    await press(button(/^Subscribe/));

    const root = within(flow());
    expect(root.getByText("You're subscribed")).toBeTruthy();
    expect(root.getByText("Confirm your payment to finish.")).toBeTruthy();
    const complete = root.getByRole("link", { name: "Complete payment" });
    expect(complete.getAttribute("href")).toBe("https://pay.example.test/i/inv_activation");
    expect(complete.getAttribute("target")).toBe("_blank");
    expect(complete.getAttribute("rel")).toBe("noopener noreferrer");
    expect(root.getByText("Waiting for your payment...")).toBeTruthy();

    // Every 5 seconds; the third read finds it paid.
    client.setInvoices([activationInvoice("PAYMENT_FAILED")]);
    await settle(5_000);
    await settle(5_000);
    expect(root.queryByText("Payment received.")).toBeNull();
    client.setInvoices([activationInvoice("PAID")]);
    await settle(5_000);
    expect(callsOf(client, "listInvoices")).toHaveLength(3);
    expect(root.getByText("Payment received.")).toBeTruthy();
    expect(root.queryByRole("link", { name: "Complete payment" })).toBeNull();
    // And it stops there.
    await settle(60_000);
    expect(callsOf(client, "listInvoices")).toHaveLength(3);
  });

  test("a payment not known yet is waited on without a link, and given up on after ten minutes", async () => {
    const client = selling(() => subscribed("processing"));
    await draw(client);
    await press(button(/^Subscribe/));

    expect(within(flow()).getByText("Waiting for your payment...")).toBeTruthy();
    expect(links()).toHaveLength(0);

    await settle(10 * 60_000);
    expect(
      within(flow()).getByText(
        "We haven't seen your payment yet. We'll check again when you come back to this window.",
      ),
    ).toBeTruthy();
  });

  test("a declined card is a subscription whose payment failed, with a new card to save and an invoice to pay", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: window } as unknown as Window);
    // The double's portal is the one of a subscribed instance, as the API's is once it is.
    const client = selling(() => subscribed("failed"), dryRun, demoPortal());
    await draw(client);
    await press(button(/^Subscribe/));

    const root = within(flow());
    expect(root.getByText("You're subscribed")).toBeTruthy();
    expect(root.getByRole("alert").textContent).toBe(
      "You're subscribed, but your card was declined.",
    );
    const pay = root.getByRole("link", { name: "Pay invoice" });
    expect(pay.getAttribute("href")).toBe("https://pay.example.test/i/inv_activation");
    expect(pay.getAttribute("rel")).toBe("noopener noreferrer");
    // Nothing is read in the meantime.
    await settle(30_000);
    expect(callsOf(client, "listInvoices")).toHaveLength(0);

    // A new card, saved in a popup so that this screen stays.
    await press(button("Update payment method"));
    expect(callsOf(client, "createPaymentMethodSession")).toHaveLength(1);
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/setup/"),
      "kaiten-setup",
      expect.any(String),
    );
  });

  test("a payment not known yet that is found declined becomes a declined card, with the ways out", async () => {
    const client = selling(() => subscribed("processing"), dryRun, demoPortal());
    await draw(client);
    await press(button(/^Subscribe/));
    expect(within(flow()).getByText("Waiting for your payment...")).toBeTruthy();

    client.setInvoices([activationInvoice("PAYMENT_FAILED")]);
    await settle(5_000);

    const root = within(flow());
    expect(root.getByRole("alert").textContent).toBe(
      "You're subscribed, but your card was declined.",
    );
    expect(root.queryByText("Waiting for your payment...")).toBeNull();
    expect(root.getByRole("button", { name: "Update payment method" })).toBeTruthy();
    expect(root.getByRole("link", { name: "Pay invoice" }).getAttribute("href")).toBe(
      "https://pay.example.test/i/inv_activation",
    );
    // Nothing is read until the customer goes to pay.
    await settle(30_000);
    expect(callsOf(client, "listInvoices")).toHaveLength(1);
  });

  test("paying the declined invoice on the provider's page is waited on until it is paid", async () => {
    const client = selling(() => subscribed("failed"));
    await draw(client);
    await press(button(/^Subscribe/));

    await press(within(flow()).getByRole("link", { name: "Pay invoice" }));
    expect(within(flow()).getByText("Waiting for your payment...")).toBeTruthy();
    client.setInvoices([activationInvoice("PAID")]);
    await settle(5_000);
    expect(within(flow()).getByText("Payment received.")).toBeTruthy();
    expect(within(flow()).queryByText("You're subscribed, but your card was declined.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe("refusals", () => {
  test("an instance that is subscribed already is sent to its portal", async () => {
    const client = selling(undefined, () => {
      throw alreadySubscribed();
    });
    await draw(client, { portalHref: "https://app.example.test/billing" });

    expect(within(flow()).getByText("You already have a subscription.")).toBeTruthy();
    const link = within(flow()).getByRole("link", { name: "Manage your subscription" });
    expect(link.getAttribute("href")).toBe("https://app.example.test/billing");
    // Nothing more to choose.
    expect(screen.queryByRole("button", { name: /^Subscribe/ })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  test("a host that opens its portal itself is given a button, and one that has none is given the sentence", async () => {
    const onOpenPortal = vi.fn();
    const client = selling(undefined, () => {
      throw alreadySubscribed();
    });
    await draw(client, { onOpenPortal });
    await press(button("Manage your subscription"));
    expect(onOpenPortal).toHaveBeenCalledTimes(1);
    cleanup();

    await draw(client);
    expect(within(flow()).getByText("You already have a subscription.")).toBeTruthy();
    expect(within(flow()).queryByRole("button")).toBeNull();
    expect(links()).toHaveLength(0);
  });

  test("an instance that became subscribed since is told so at the checkout", async () => {
    const client = selling(() => alreadySubscribed());
    await draw(client, { portalHref: "https://app.example.test/billing" });
    await press(button(/^Subscribe/));
    expect(within(flow()).getByText("You already have a subscription.")).toBeTruthy();
    expect(within(flow()).getByRole("link", { name: "Manage your subscription" })).toBeTruthy();
  });

  test("a plan the instance is over names the entitlements, by the names the portal gives them", async () => {
    const portal = demoPortal();
    const client = selling(
      undefined,
      () => {
        throw quotaExceeded("seats", "api-credits");
      },
      { ...portal, subscription: null, capabilities: { ...portal.capabilities, checkout: true } },
    );
    await draw(client);

    expect(within(flow()).getByRole("alert").textContent).toBe(
      "Your usage is above what this plan includes: Seats, api-credits. Choose a larger plan, or add-ons.",
    );
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);
    expect(within(flow()).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a plan that became too small at the checkout is refused the same way, and the customer goes on choosing", async () => {
    const client = selling(() => quotaExceeded("seats"));
    await draw(client);
    await press(button(/^Subscribe/));

    expect(within(flow()).getByRole("alert").textContent).toContain(
      "above what this plan includes: seats",
    );
    expect(button(/^Subscribe/)).toBeTruthy();
  });

  test("a provider that is down is a sentence, at the preview and at the checkout, and asking again is the customer's", async () => {
    let down = true;
    const client = selling(
      () => (down ? providerUnavailable(30) : subscribed("paid")),
      (input) => (down ? providerUnavailable(30) : dryRun(input)),
    );
    await draw(client);
    expect(within(flow()).getByRole("alert").textContent).toContain(
      "The payment provider can't be reached right now",
    );
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);

    down = false;
    await press(button("Try again"));
    expect(total()).toBe("$79.00");

    down = true;
    await press(button(/^Subscribe/));
    expect(
      within(flow())
        .getAllByRole("alert")
        .map((node) => node.textContent)
        .join(" "),
    ).toContain("The payment provider can't be reached right now");
    down = false;
    await press(button(/^Subscribe/));
    expect(within(flow()).getByText("You're subscribed")).toBeTruthy();
  });

  test("too many calls says to wait, and not that the provider is down", async () => {
    const client = selling(undefined, () => {
      throw rateLimited(45);
    });
    await draw(client);
    expect(within(flow()).getByRole("alert").textContent).toContain(
      "Too many attempts. Try again in a moment.",
    );
    expect(within(flow()).getByRole("alert").textContent).not.toContain("provider");
    expect(within(flow()).getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("a plan the vendor cannot take payment for is said not to be sold here, with nothing to retry", async () => {
    const client = selling(undefined, () => {
      throw cannotCapture();
    });
    await draw(client);
    expect(within(flow()).getByRole("alert").textContent).toBe("This plan can't be bought online.");
    expect(within(flow()).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(button(/^Subscribe/)).toHaveProperty("disabled", true);
  });

  test("a link to a page that is not a web page is not offered", async () => {
    const hostile = {
      ...activationInvoice("PAYMENT_FAILED"),
      hostedInvoiceUrl: "javascript:alert(1)",
    };
    const client = selling(() => ({
      ...subscribed("requires_action", hostile),
      payment: { status: "requires_action", hostedInvoiceUrl: "javascript:alert(1)" },
    }));
    await draw(client);
    await press(button(/^Subscribe/));

    expect(within(flow()).getByText("Confirm your payment to finish.")).toBeTruthy();
    expect(links()).toHaveLength(0);
    expect(flow().innerHTML).not.toContain("javascript:");
  });

  test("anything else is the generic sentence", async () => {
    const client = selling(() => new Error("boom"));
    await draw(client);
    await press(button(/^Subscribe/));
    expect(within(flow()).getByRole("alert").textContent).toBe(
      "Unable to complete checkout. Please try again.",
    );
  });
});

// ---------------------------------------------------------------------------
// Outside a session, unstyled, in French
// ---------------------------------------------------------------------------

describe("the other ways to draw it", () => {
  test("outside a customer session there is no checkout to draw", async () => {
    const { KaitenProvider } = await import("./support/styled-provider.tsx");
    render(
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        <CheckoutFlow plan={plan} />
      </KaitenProvider>,
    );
    await settle();
    expect(flow()).toBeNull();
  });

  test("unstyled, it is the same checkout in plain markup", async () => {
    const client = selling(() => subscribed("requires_action"));
    await draw(client, { unstyled: true });

    const root = flow();
    expect(root.tagName).toBe("SECTION");
    expect(root.querySelector('[data-slot="card"]')).toBeNull();
    expect(root.querySelector('[class*="bg-"]')).toBeNull();
    expect(root.querySelector("fieldset legend")!.textContent).toBe("Billing interval");
    // The choices stay the browser's own radios, the markup the unstyled rendering promises.
    const periods = within(root).getAllByRole("radio");
    expect(periods.map((radio) => radio.tagName)).toEqual(["INPUT", "INPUT"]);
    expect((periods[0] as HTMLInputElement).checked).toBe(true);
    expect(root.querySelector('[data-slot="radio-group"]')).toBeNull();
    expect(total()).toBe("Due today: $79.00");

    fireEvent.change(screen.getByLabelText("Voucher code"), { target: { value: "WELCOME20" } });
    await press(button("Apply"), 300);
    expect(screen.getByText("Voucher applied")).toBeTruthy();
    await press(button(/^Subscribe/));
    expect(within(flow()).getByRole("link", { name: "Complete payment" }).className).toBe("");
  });

  test("in French, the words and the amounts are French", async () => {
    const client = selling(() => subscribed("paid"));
    await draw(client, {}, { locale: fr });

    const root = within(flow());
    expect(root.getByRole("group", { name: "Période de facturation" })).toBeTruthy();
    expect(root.getByLabelText("Code promo")).toBeTruthy();
    expect(root.getByText("À payer aujourd'hui")).toBeTruthy();
    expect(total()).toMatch(/^79,00\s\$US$/);
    await press(button(/^Souscrire/));
    expect(root.getByText("Vous êtes abonné")).toBeTruthy();
    expect(root.getByText("Paiement reçu.")).toBeTruthy();
  });

  test("another plan is another checkout, from the start", async () => {
    const client = selling();
    const Wrapper = sessionProvider(client);
    const view = render(
      <Wrapper>
        <CheckoutFlow plan={plan} addOns={[extraSeats]} />
      </Wrapper>,
    );
    await settle();
    await act(async () => fireEvent.click(button("Add one Extra seats")));
    await settle(300);
    expect(quantity("Extra seats")).toBe("1");

    view.rerender(
      <Wrapper>
        <CheckoutFlow plan={growthPlan({ slug: "scale", name: "Scale" })} addOns={[extraSeats]} />
      </Wrapper>,
    );
    await settle();
    expect(
      within(flow()).getByText("Scale", { selector: '[data-slot="card-title"]' }),
    ).toBeTruthy();
    expect(quantity("Extra seats")).toBe("0");
  });
});
