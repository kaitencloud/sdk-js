// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// A customer session's subscription, said by the three components that show where it stands: the
// current plan, the billing summary and the paywall. The portals are the ones Kaiten recorded for
// Initech, and the states are the ones a subscription is in: running, in its trial, canceled and
// ending with its period, past due, over, waiting for the first payment of its checkout, and the
// two sessions with no subscription to speak of.
// Nothing here reads a licence, and nothing reads the end date of one.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { fr } from "@kaitencloud/react/locales";

import { BillingSummary, CurrentPlan, Paywall, formatKaitenDate } from "../src/index.ts";
import { sessionServer, type PortalName } from "../.storybook/session-server.ts";
import { flat, mount } from "./support/session-mount.tsx";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const day = (iso: string) => formatKaitenDate(iso);
const NOV_1 = day("2026-11-01T00:00:00Z");

const trial = (() => {
  const portal: Record<string, any> = structuredClone(answers.portal);
  portal.subscription.status = "TRIAL";
  portal.subscription.trialEndsAt = "2026-11-01T00:00:00Z";
  return portal;
})();

const canceled = (() => {
  const portal: Record<string, any> = structuredClone(answers.portal);
  portal.subscription.status = "CANCELED";
  portal.upcomingInvoice = null;
  portal.capabilities = { ...portal.capabilities, unsubscribe: false, checkout: true };
  return portal;
})();

/**
 * A checkout that waits for its first payment: the instance still has its plan, Pro, and its limits.
 * It is live and not ending, so the customer may cancel it, which ends it at once.
 */
const incomplete = (() => {
  const portal: Record<string, any> = structuredClone(answers.portal);
  portal.subscription.status = "INCOMPLETE";
  portal.capabilities = { ...portal.capabilities, unsubscribe: true };
  return portal;
})();

type Portal = PortalName | Record<string, any>;

// ---------------------------------------------------------------------------
// CurrentPlan
// ---------------------------------------------------------------------------

test("CurrentPlan: a running subscription renews, and has no status to announce", async () => {
  const { container } = mount(sessionServer({ portal: "portal" }), <CurrentPlan />);
  expect(await screen.findByText(`Renews on ${NOV_1}`)).toBeTruthy();
  expect(container.querySelector('[data-slot="current-plan-status"]')).toBeNull();
});

test("CurrentPlan: a trial says so and when it ends", async () => {
  const { container } = mount(sessionServer({ portal: trial }), <CurrentPlan />);
  expect(await screen.findByText(`Trial ends on ${NOV_1}`)).toBeTruthy();
  expect(container.querySelector('[data-slot="current-plan-status"]')?.textContent).toBe("Trial");
  expect(screen.queryByText(/^Renews on/)).toBeNull();
});

test("CurrentPlan: a subscription ending with its period ends, it does not renew", async () => {
  mount(sessionServer({ portal: "portalCanceling" }), <CurrentPlan />);
  expect(await screen.findByText(`Ends on ${NOV_1}`)).toBeTruthy();
  expect(screen.queryByText(/^Renews on/)).toBeNull();
});

test("CurrentPlan: past due says the payment failed, and says nothing of access", async () => {
  const { container } = mount(sessionServer({ portal: "portalPastDue" }), <CurrentPlan />);
  expect(await screen.findByText("Your latest payment didn't go through.")).toBeTruthy();
  expect(container.querySelector('[data-slot="current-plan-status"]')?.textContent).toBe(
    "Payment failed",
  );
  expect(screen.queryByText(/^Renews on/)).toBeNull();
  // Billing status is not an access countdown, and there is none to show.
  expect(container.textContent).not.toMatch(/access|suspend|restrict|days? left/i);
});

test("CurrentPlan: a subscription that is over says so, and shows no price", async () => {
  const { container } = mount(sessionServer({ portal: canceled }), <CurrentPlan />);
  expect(
    await screen.findByText("Your subscription has ended. Your current plan is Pro."),
  ).toBeTruthy();
  expect(container.querySelector('[data-slot="current-plan-status"]')?.textContent).toBe(
    "Canceled",
  );
  expect(container.querySelector('[data-slot="current-plan-price"]')).toBeNull();
});

test("CurrentPlan: a checkout that waits for its payment says the plan starts once it is confirmed", async () => {
  const { container } = mount(sessionServer({ portal: incomplete }), <CurrentPlan />);
  expect(await screen.findByText("Your plan starts once your payment is confirmed.")).toBeTruthy();
  expect(container.querySelector('[data-slot="current-plan-status"]')?.textContent).toBe(
    "Awaiting payment",
  );
  // Nothing it bought has started: it does not renew, and the price of the plan it bought is not
  // shown beside the plan the instance still has.
  expect(screen.queryByText(/^Renews on|^Ends on/)).toBeNull();
  expect(container.querySelector('[data-slot="current-plan-price"]')).toBeNull();
});

test("CurrentPlan: a plan change that is scheduled is said once, with its price and its day", async () => {
  mount(sessionServer({ portal: "portalScheduledChange" }), <CurrentPlan />);
  expect(await screen.findByText(`Changes to €490.00/year on ${NOV_1}`)).toBeTruthy();
});

test("CurrentPlan: an instance that was never subscribed shows its plan and nothing about a subscription", async () => {
  const { container } = mount(sessionServer({ portal: "portalNeverSubscribed" }), <CurrentPlan />);
  expect(await screen.findByText("Starter")).toBeTruthy();
  expect(container.querySelector('[data-slot="current-plan-status"]')).toBeNull();
  expect(container.querySelector('[data-slot="current-plan-price"]')).toBeNull();
  expect(screen.queryByText(/^Renews on|^Ends on/)).toBeNull();
});

test("CurrentPlan: a session bound to the customer only has no plan to show", async () => {
  const server = sessionServer({ portal: "portalCustomerWide" });
  const { container } = mount(server, <CurrentPlan />);
  await vi.waitFor(() => expect(server.to("GET", "portal")).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
});

test("CurrentPlan: in French", async () => {
  mount(sessionServer({ portal: "portalPastDue" }), <CurrentPlan />, fr);
  expect(await screen.findByText("Votre dernier paiement n'a pas abouti.")).toBeTruthy();
  expect(screen.getByText("Paiement échoué")).toBeTruthy();
  cleanup();

  mount(sessionServer({ portal: incomplete }), <CurrentPlan />, fr);
  expect(
    await screen.findByText("Votre offre démarre dès que votre paiement est confirmé."),
  ).toBeTruthy();
  expect(screen.getByText("Paiement en attente")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// BillingSummary
// ---------------------------------------------------------------------------

const summary = () => document.querySelector('[data-slot="billing-summary"]') as HTMLElement;

test("BillingSummary: a running subscription — its plan, its price, its renewal, its card", async () => {
  mount(sessionServer({ portal: "portal" }), <BillingSummary />);
  await screen.findByText("Active");
  const text = flat(summary().textContent);
  expect(text).toContain("Pro");
  expect(text).toContain("€49.00/month");
  expect(text).toContain(`Renews on ${NOV_1}`);
  expect(text).toContain("Visa •••• 4242 · 12/2030");
});

test("BillingSummary: a quarterly subscription is every 3 months, and is past due", async () => {
  mount(sessionServer({ portal: "portalPastDue" }), <BillingSummary />);
  await screen.findAllByText("Payment failed");
  const text = flat(summary().textContent);
  expect(text).toContain("€135.00 every 3 months");
  expect(text).not.toContain("/month");
  // A warning, said once, and no renewal.
  const warning = summary().querySelector('[data-slot="billing-summary-warning"]');
  expect(warning?.textContent).toBe("Your latest payment didn't go through.");
  expect(text).not.toContain("Renews on");
});

test("BillingSummary: a trial", async () => {
  mount(sessionServer({ portal: trial }), <BillingSummary />);
  await screen.findByText("Trial");
  expect(summary().textContent).toContain(`Trial ends on ${NOV_1}`);
});

test("BillingSummary: a cancellation scheduled", async () => {
  mount(sessionServer({ portal: "portalCanceling" }), <BillingSummary />);
  await screen.findByText("Active");
  expect(summary().textContent).toContain(`Ends on ${NOV_1}`);
  expect(summary().textContent).not.toContain("Renews on");
});

test("BillingSummary: a subscription that is over", async () => {
  mount(sessionServer({ portal: canceled }), <BillingSummary />);
  await screen.findByText("Canceled");
  expect(summary().textContent).toContain("Your subscription has ended.");
  // It costs nothing any more.
  expect(flat(summary().textContent)).not.toContain("€49.00");
});

test("BillingSummary: a checkout that waits for its payment, with no price until the plan starts", async () => {
  mount(sessionServer({ portal: incomplete }), <BillingSummary />);
  await screen.findByText("Awaiting payment");
  const text = flat(summary().textContent);
  expect(text).toContain("Your plan starts once your payment is confirmed.");
  expect(text).not.toContain("€49.00");
  expect(text).not.toContain("Renews on");
});

test("BillingSummary: a session bound to the customer has no subscription to summarise, and says so", async () => {
  mount(sessionServer({ portal: "portalCustomerWide" }), <BillingSummary />);
  expect(await screen.findByText("There's no subscription to show.")).toBeTruthy();
  expect(screen.queryByText("Active")).toBeNull();
});

test("BillingSummary: what the host says of the money wins over the portal's", async () => {
  mount(
    sessionServer({ portal: "portal" }),
    <BillingSummary
      billing={{
        amount: 100_00,
        currencyCode: "EUR",
        interval: "month",
        paymentMethodLabel: "Our own label",
      }}
    />,
  );
  await screen.findByText("Active");
  const text = flat(summary().textContent);
  expect(text).toContain("€100.00 / month");
  expect(text).toContain("Our own label");
  expect(text).not.toContain("Visa");
});

test("BillingSummary: in French", async () => {
  mount(sessionServer({ portal: "portalCanceling" }), <BillingSummary />, fr);
  await screen.findByText("Actif");
  expect(summary().textContent).toContain("Se termine le");
});

test("BillingSummary: unstyled", async () => {
  mount(sessionServer({ portal: "portalPastDue" }), <BillingSummary unstyled />);
  await screen.findByText("Payment failed");
  expect(summary().querySelector('[role="status"]')?.textContent).toBe(
    "Your latest payment didn't go through.",
  );
});

// ---------------------------------------------------------------------------
// Paywall
// ---------------------------------------------------------------------------

/** A wall on a limit the recorded instance is at (8 of 8 seats), with an upgrade to offer. */
function wall(portal: Portal, entitlement = "seats") {
  const onUpgrade = vi.fn();
  mount(
    sessionServer({ portal }),
    <Paywall entitlement={entitlement} onUpgrade={onUpgrade}>
      <p>The feature</p>
    </Paywall>,
  );
  return onUpgrade;
}

const wallEl = () => document.querySelector('[data-slot="paywall"]') as HTMLElement | null;

test("Paywall: a running subscription adds nothing to the wall, and the CTA is an upgrade", async () => {
  wall("portal");
  await screen.findByRole("button", { name: /^Upgrade/ });
  expect(wallEl()!.getAttribute("data-subscription")).toBe("active");
  expect(wallEl()!.querySelector('[data-slot="paywall-subscription-note"]')).toBeNull();
});

test("Paywall: says when a trial or a cancellation will run out", async () => {
  wall(trial);
  expect(await screen.findByText(`Trial ends on ${NOV_1}`)).toBeTruthy();
  cleanup();
  wall("portalCanceling");
  expect(await screen.findByText(`Ends on ${NOV_1}`)).toBeTruthy();
});

test("Paywall: a payment that failed is said, and the wall is the same wall", async () => {
  wall("portalPastDue");
  expect(await screen.findByText("Your latest payment didn't go through.")).toBeTruthy();
  expect(wallEl()!.getAttribute("data-subscription")).toBe("past_due");
  // The reason is the entitlement's, never the billing status's.
  expect(["near_limit", "over_limit"]).toContain(wallEl()!.getAttribute("data-reason"));
});

test("Paywall: a plan that waits for its payment explains a wall the plan it bought would lift", async () => {
  wall(incomplete);
  expect(await screen.findByText("Your plan starts once your payment is confirmed.")).toBeTruthy();
  expect(wallEl()!.getAttribute("data-subscription")).toBe("incomplete");
  // The limits are the plan's the instance still has, and the reason is theirs.
  expect(["near_limit", "over_limit"]).toContain(wallEl()!.getAttribute("data-reason"));
});

test("Paywall: a customer who can buy a plan by themselves is offered to subscribe", async () => {
  const onUpgrade = wall(canceled);
  expect(
    await screen.findByText("Your subscription has ended. Your current plan is Pro."),
  ).toBeTruthy();
  const button = screen.getByRole("button", { name: /^Subscribe/ });
  button.click();
  expect(onUpgrade).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: /^Upgrade/ })).toBeNull();
  cleanup();

  // An instance that was never subscribed is offered the same, and has nothing to be told.
  wall("portalNeverSubscribed", "enterprise-sso");
  expect(await screen.findByRole("button", { name: /^Subscribe/ })).toBeTruthy();
  expect(wallEl()!.getAttribute("data-subscription")).toBe("unsubscribed");
  expect(wallEl()!.querySelector('[data-slot="paywall-subscription-note"]')).toBeNull();
});

test("Paywall: billing status closes no wall", async () => {
  // Plenty of room on this limit, whatever state the subscription is in.
  for (const portal of ["portalPastDue", canceled, "portalCanceling"] as Portal[]) {
    wall(portal, "ai-credits");
    expect(await screen.findByText("The feature")).toBeTruthy();
    expect(wallEl()).toBeNull();
    cleanup();
  }
});

test("Paywall: a session bound to the customer only has nothing to say of a subscription", async () => {
  wall("portalCustomerWide");
  const root = await vi.waitFor(() => {
    const el = wallEl();
    expect(el).toBeTruthy();
    return el!;
  });
  expect(root.getAttribute("data-subscription")).toBe("unbound");
  expect(root.querySelector('[data-slot="paywall-subscription-note"]')).toBeNull();
});

test("Paywall: in French", async () => {
  mount(
    sessionServer({ portal: canceled }),
    <Paywall entitlement="seats" onUpgrade={() => {}}>
      <p>The feature</p>
    </Paywall>,
    fr,
  );
  expect(
    await screen.findByText("Votre abonnement est terminé. Votre offre actuelle est Pro."),
  ).toBeTruthy();
  expect(within(wallEl()!).getByRole("button", { name: /^Souscrire/ })).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The end of a licence
// ---------------------------------------------------------------------------

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !entry.includes(".stories.") ? [path] : [];
  });
}

test("no component reads the end date of a licence: billing never moves it", () => {
  // Comments are stripped first: prose that names the date is not a read of it.
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const readers = sources(join(import.meta.dirname, "../src")).filter((file) =>
    /endLicenseDate|startLicenseDate/.test(code(file)),
  );
  expect(readers).toEqual([]);
});

test("the billing summary of a session does not consult the licence's term", () => {
  const source = readFileSync(
    join(import.meta.dirname, "../src/components/billing-summary/billing-summary.tsx"),
    "utf8",
  );
  // The term is taken only when no portal speaks for the subscription.
  expect(source).toMatch(/const term = sessionState \? null : /);
});
