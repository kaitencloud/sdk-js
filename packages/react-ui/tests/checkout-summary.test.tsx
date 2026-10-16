// @vitest-environment jsdom
//
// What is due today, drawn: the server's lines and the server's total, as they are. The session
// is a double that answers what the test scripts, so what is pinned is what the component makes of
// the answers: it adds nothing up, it asks once for a selection that stops changing, and it says
// what is refused.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { CheckoutInput, CheckoutResult } from "@kaitencloud/client";
import type { CheckoutProblem } from "@kaitencloud/react/billing";
import { fr } from "@kaitencloud/react/locales";

import { CheckoutSummary, type CheckoutSummarySelection } from "../src/index.ts";
import {
  FAKE_TIMERS,
  callsOf,
  line,
  previewOf,
  providerUnavailable,
  quotaExceeded,
  sessionProvider,
  settle,
  trialPreview,
  unsubscribedSession,
  voucherInvalid,
  alreadySubscribed,
  demoPortal,
} from "./support/checkout.tsx";

const monthly: CheckoutSummarySelection = { licensePriceId: "price_growth_monthly" };

beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

async function draw(
  client: ReturnType<typeof unsubscribedSession>,
  props: Parameters<typeof CheckoutSummary>[0],
  extra: Parameters<typeof sessionProvider>[1] = {},
) {
  const Wrapper = sessionProvider(client, extra);
  const view = render(
    <Wrapper>
      <CheckoutSummary {...props} />
    </Wrapper>,
  );
  await settle();
  return {
    view,
    update: async (next: Parameters<typeof CheckoutSummary>[0], wait = 0) => {
      view.rerender(
        <Wrapper>
          <CheckoutSummary {...next} />
        </Wrapper>,
      );
      await settle(wait);
    },
  };
}

const summary = () => document.querySelector<HTMLElement>('[data-slot="checkout-summary"]')!;

test("the lines are the server's, and so is the total, whatever the lines add up to", async () => {
  const { client, requests } = scripted(() =>
    previewOf(9999, [
      line(1, "BASE", "Monthly", 4900),
      line(2, "ADDON", "Extra seat × 2", 2000, "2 × 10.00 USD"),
      line(3, "DISCOUNT", "Welcome 20%", -1380),
    ]),
  );
  await draw(client, { selection: monthly });

  expect(requests).toEqual([{ licensePriceId: "price_growth_monthly", dryRun: true }]);
  const lines = within(summary());
  expect(lines.getByText("Monthly")).toBeTruthy();
  expect(lines.getByText("$49.00")).toBeTruthy();
  expect(lines.getByText("Extra seat × 2")).toBeTruthy();
  expect(lines.getByText("2 × 10.00 USD")).toBeTruthy();
  expect(lines.getByText("$20.00")).toBeTruthy();
  expect(lines.getByText("-$13.80")).toBeTruthy();
  // The lines sum to $55.20; what is due is the server's $99.99, and no $55.20 is anywhere.
  expect(lines.getByText("Due today")).toBeTruthy();
  expect(lines.getByRole("status").textContent).toBe("$99.99");
  expect(summary().textContent).not.toContain("55.20");
});

test("a selection that moves is asked for once it stops, 300 ms after the last change", async () => {
  const { client, requests } = scripted((input) =>
    previewOf(4900 + (input.addOns?.[0]?.quantity ?? 0) * 1000),
  );
  const view = await draw(client, { selection: { ...monthly, addOns: { seats: 2 } } });
  expect(requests).toHaveLength(1);

  await view.update({ selection: { ...monthly, addOns: { seats: 3 } } }, 100);
  await view.update({ selection: { ...monthly, addOns: { seats: 4 } } }, 100);
  await view.update({ selection: { ...monthly, addOns: { seats: 3 } } }, 299);
  // Nothing yet, and what is on screen is the last answer, dimmed and marked busy.
  expect(requests).toHaveLength(1);
  expect(within(summary()).getByRole("status").textContent).toBe("$69.00");
  expect(
    document.querySelector('[data-slot="checkout-summary-lines"]')!.getAttribute("aria-busy"),
  ).toBe("true");

  await settle(1);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual({
    licensePriceId: "price_growth_monthly",
    addOns: [{ addonSlug: "seats", quantity: 3 }],
    dryRun: true,
  });
  expect(within(summary()).getByRole("status").textContent).toBe("$79.00");
  expect(
    document.querySelector('[data-slot="checkout-summary-lines"]')!.getAttribute("aria-busy"),
  ).toBe("false");
});

test("a trial is nothing due today, and the day it ends", async () => {
  const { client } = scripted(() => trialPreview("2026-11-02T00:00:00.000Z"));
  await draw(client, { selection: monthly });

  const lines = within(summary());
  expect(lines.getByRole("status").textContent).toBe("$0.00 today");
  expect(lines.getByText("Trial ends on Nov 2, 2026")).toBeTruthy();
  expect(lines.queryByText("Due today")).toBeNull();
});

test("a voucher the server refuses leaves the summary that was there", async () => {
  const requests: CheckoutInput[] = [];
  const client = unsubscribedSession({
    checkout: (input) => {
      requests.push(input);
      if (input.voucherCode) throw voucherInvalid();
      return previewOf(4900, [line(1, "BASE", "Pro", 4900)]);
    },
  });
  const view = await draw(client, { selection: monthly });
  await view.update({ selection: { ...monthly, voucherCode: "NOPE" } }, 300);

  // The summary of the selection without the code, and no request for it: it was there.
  expect(requests.map((request) => request.voucherCode)).toEqual([undefined, "NOPE"]);
  expect(within(summary()).getByText("Pro")).toBeTruthy();
  expect(within(summary()).getByRole("status").textContent).toBe("$49.00");
  expect(screen.queryByRole("alert")).toBeNull();
  // And the code is not on the page: it is the checkout's.
  expect(document.documentElement.innerHTML).not.toContain("NOPE");
});

test("a plan the instance is over names the entitlements that are, by the name the portal gives them", async () => {
  const { client } = scripted(() => quotaExceeded("seats", "api-credits"));
  vi.spyOn(client, "getPortal").mockResolvedValue({
    ...demoPortal(),
    subscription: null,
  });
  await draw(client, { selection: monthly });

  // "seats" is an entitlement of the portal, with a name; "api-credits" is not, and is said as it is.
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain(
    "Your usage is above what this plan includes: Seats, api-credits.",
  );
  // Nothing was ever shown that could be paid.
  expect(document.querySelector('[data-slot="checkout-summary-lines"]')).toBeNull();
});

test("a provider that is down is a wait with a way to ask again", async () => {
  let down = true;
  const { client, requests } = scripted(() => (down ? providerUnavailable(30) : previewOf(4900)));
  await draw(client, { selection: monthly });

  expect(screen.getByRole("alert").textContent).toContain("The payment provider can't be reached");
  down = false;
  screen.getByRole("button", { name: "Try again" }).click();
  await settle();
  expect(requests).toHaveLength(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(within(summary()).getByRole("status").textContent).toBe("$49.00");
});

test("a refusal of a kind this version does not know is said as `other` is, with a way to ask again", async () => {
  // A later `@kaitencloud/react` may name a refusal that was `other` until then.
  const client = unsubscribedSession();
  const retry = vi.fn();
  const refused = (kind: string) => ({
    status: "failed" as const,
    data: null,
    isStale: false,
    voucher: "none" as const,
    problem: { kind } as unknown as CheckoutProblem,
    error: new Error("Refused."),
    retry,
  });
  const { update } = await draw(client, { preview: refused("other") });
  const asOther = screen.getByRole("alert").textContent;

  await update({ preview: refused("a_kind_of_a_later_release") });
  expect(screen.getByRole("alert").textContent).toBe(asOther);
  screen.getByRole("button", { name: "Try again" }).click();
  expect(retry).toHaveBeenCalledOnce();
});

test("an instance that is subscribed already is said so", async () => {
  const { client } = scripted(() => alreadySubscribed());
  await draw(client, { selection: monthly });
  expect(screen.getByRole("alert").textContent).toBe("You already have a subscription.");
});

test("nothing is asked, and something is said, before a price is chosen", async () => {
  const { client, requests } = scripted(() => previewOf(4900));
  await draw(client, { selection: { licensePriceId: null } });

  expect(requests).toHaveLength(0);
  expect(screen.getByText("Choose a plan to see what is due today.")).toBeTruthy();
});

test("while the server is asked a placeholder stands where the lines will be", async () => {
  const client = unsubscribedSession({ checkout: () => new Promise(() => {}) });
  await draw(client, { selection: monthly });

  const loading = document.querySelector('[data-slot="checkout-summary-loading"]')!;
  expect(loading.getAttribute("aria-busy")).toBe("true");
});

test("a preview that something else holds is shown as it is, and nothing is asked", async () => {
  const client = unsubscribedSession();
  const preview = {
    status: "ready" as const,
    data: previewOf(1234, [line(1, "BASE", "Held elsewhere", 1234)]),
    isStale: false,
    voucher: "none" as const,
    problem: null,
    error: null,
    retry: () => {},
  };
  await draw(client, { preview });

  expect(within(summary()).getByText("Held elsewhere")).toBeTruthy();
  expect(within(summary()).getByRole("status").textContent).toBe("$12.34");
  await settle(5_000);
  expect(callsOf(client, "checkout")).toHaveLength(0);
});

test("unstyled, it is the same summary in plain markup", async () => {
  const { client } = scripted(() =>
    previewOf(4900, [line(1, "BASE", "Pro", 4900, "1 × 49.00 USD")]),
  );
  await draw(client, { selection: monthly, unstyled: true });

  const root = summary();
  expect(root.tagName).toBe("SECTION");
  expect(root.querySelector("li")!.textContent).toBe("Pro (1 × 49.00 USD): $49.00");
  expect(root.textContent).toContain("Due today: $49.00");
  expect(root.querySelector('[class*="bg-"]')).toBeNull();
});

test("in French, the words and the amounts are French", async () => {
  const { client } = scripted(() => previewOf(4900, [line(1, "BASE", "Pro", 4900)]));
  await draw(client, { selection: monthly }, { locale: fr });

  expect(within(summary()).getByText("Récapitulatif")).toBeTruthy();
  expect(within(summary()).getByText("À payer aujourd'hui")).toBeTruthy();
  expect(within(summary()).getByRole("status").textContent).toMatch(/^49,00\s\$US$/);
});
