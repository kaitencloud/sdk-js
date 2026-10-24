// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The way a customer changes plan, and the journey page that walks a presenter through the payment
// lifecycle: upgrading from the free plan, the portal's "Change plan", and scenarios of the journey
// page driven through its own buttons. The stand-in for Kaiten plays the other side.

import type { Locator, Page } from "@playwright/test";

import { checkout, giveBillingEmail, planCard, portal } from "./support/page.ts";
import { expect, test } from "./support/stand-in.ts";

/** A scenario of the journey page, by its title. */
const scenario = (page: Page, title: string) => page.getByRole("article", { name: title });
const stateOf = (page: Page) => page.getByTestId("stand-in-state");
/** What a step says after the button of that name was pressed. */
const outcomeOf = (scene: Locator, button: string) =>
  scene
    .getByRole("listitem")
    .filter({ has: scene.page().getByRole("button", { name: button }) })
    .getByRole("status");

test("a customer on the free plan buys Pro from the pricing table, and the free subscription ends with no invoice", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ email: true });

  // Starter first: nothing is due and no card is asked for.
  await page.goto("/");
  await planCard(page, "Starter").getByRole("button", { name: "Select plan" }).click();
  await giveBillingEmail(page);
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(checkout(page)).toContainText("You're subscribed");
  expect(await standIn.state()).toMatchObject({
    plan: "starter-v1",
    free: true,
    cardOnFile: false,
    invoices: [],
  });

  // Then Pro, from the pricing table, with the card saved on the provider's page.
  await page.goto("/");
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await expect(checkout(page)).toContainText("Due today");
  await expect(checkout(page)).not.toContainText("already have a subscription");
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Subscribe" }).click();
  const provider = await opened;
  await provider.getByRole("button", { name: /Save card/ }).click();
  await provider.waitForEvent("close");
  await expect(checkout(page)).toContainText("You're subscribed");
  await expect(checkout(page)).toContainText("Payment received.");

  // One invoice, Pro's: the free subscription was cancelled at once, with none.
  expect(await standIn.state()).toMatchObject({
    plan: "pro-v2",
    free: false,
    status: "ACTIVE",
    invoices: [{ kind: "ACTIVATION", status: "PAID", total: 4900 }],
  });
  const events = await standIn.events();
  const types = events.map((event) => event.type);
  expect(types.slice(0, 2)).toEqual([
    "instance.billing.started",
    "customer.payment_method.attached",
  ]);
  // In the checkout's one step: the free subscription ends, with no invoice, and Pro starts.
  expect(types.slice(2, 4)).toEqual(["instance.billing.canceled", "instance.billing.started"]);
  expect(events[2]?.detail).toContain("no final invoice");
  expect(types.filter((type) => type === "instance.invoice.issued")).toHaveLength(1);

  await page.goto("/portal");
  await expect(portal(page).currentPlan).toContainText("Pro");
});

test("a customer on a paid plan who tries another checkout is told they already have a subscription", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true });
  await page.goto("/checkout/growth-v1");
  await expect(checkout(page)).toContainText("You already have a subscription.");
  expect(await standIn.state()).toMatchObject({ plan: "pro-v2" });
});

test("Change plan opens the plan's commercial link: the sales page, with the plan the customer is on", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true });
  await page.goto("/portal");

  await page.getByRole("button", { name: "Change plan" }).click();
  await expect(page).toHaveURL(/\/sales\?plan=pro-v2$/);
  await expect(page.getByRole("heading", { name: "Let's talk about Pro" })).toBeVisible();
  await expect(page.getByRole("link", { name: "sales@acme.test" })).toHaveAttribute(
    "href",
    /^mailto:sales@acme\.test\?subject=About%20the%20Pro%20plan$/,
  );

  // Nothing about the subscription moved: a plan change is not something the customer does.
  expect(await standIn.state()).toMatchObject({ plan: "pro-v2", scheduledChange: null });
  const changed = (await standIn.calls()).filter(
    (call) => call.method !== "GET" && call.path.startsWith("/public/session/"),
  );
  expect(changed).toEqual([]);

  await page.getByRole("link", { name: "Back to your account" }).click();
  await expect(page).toHaveURL(/\/portal$/);
});

test("Change plan from the free plan goes to the pricing table", async ({ page, standIn }) => {
  await standIn.reset({ free: true });
  await page.goto("/portal");
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(planCard(page, "Pro")).toBeVisible();
});

test("the journey page lists what the stand-in plays, and what comes with the v3.1 contract", async ({
  page,
}) => {
  await page.goto("/journey");
  await expect(page.getByRole("heading", { level: 1, name: /payment journey/ })).toBeVisible();

  for (const title of [
    "Buy a plan with a trial",
    "A voucher: WELCOME20",
    "Add-on increase",
    "Card declined, then retried",
    "3-D Secure",
    "An outcome that is not known yet",
    "A renewal fails: past due, then paid from the portal",
    "Change the payment method",
    "Cancel, then withdraw",
    "Upgrade from the free plan",
    "Change plan: a commercial request",
    "The vendor schedules a plan change",
  ]) {
    await expect(scenario(page, title)).toBeVisible();
  }

  // What is not played is said, and has no button.
  const coming = page.getByRole("region", { name: "Coming with the v3.1 contract" });
  for (const id of [
    "incomplete",
    "trial-end",
    "fallback",
    "addon-decrease",
    "true-up",
    "trial-will-end",
  ]) {
    await expect(coming.getByTestId(`coming-${id}`)).toBeVisible();
  }
  await expect(coming.getByRole("button")).toHaveCount(0);
});

test("journey: a trial is bought, then ended now into a conversion invoice", async ({
  page,
  context,
  standIn,
}) => {
  await page.goto("/journey");
  const trial = scenario(page, "Buy a plan with a trial");
  await trial.getByRole("button", { name: "Start over" }).click();
  await expect(outcomeOf(trial, "Start over")).toContainText("starting point");
  await expect(stateOf(page)).toContainText("No subscription");

  // The checkout of Growth is a real page: the customer subscribes there, with a card saved on the
  // provider's page. Nothing is due today.
  await trial.getByRole("link", { name: "Open Growth's checkout" }).click();
  await expect(page).toHaveURL(/\/checkout\/growth-v1/);
  await giveBillingEmail(page);
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Subscribe" }).click();
  const provider = await opened;
  await provider.getByRole("button", { name: /Save card/ }).click();
  await provider.waitForEvent("close");
  await expect(checkout(page)).toContainText("You're subscribed");
  expect(await standIn.state()).toMatchObject({ plan: "growth-v1", status: "TRIAL", invoices: [] });

  // Back on the journey page, the stand-in's state is the trial; ending it converts it.
  await page.getByRole("link", { name: "Journey" }).click();
  await expect(stateOf(page).getByTestId("state-plan")).toContainText("Trial", {
    timeout: 10_000,
  });
  await trial.getByRole("button", { name: "End the trial now" }).click();
  await expect(outcomeOf(trial, "End the trial now")).toContainText(
    "The trial ended. An invoice was issued.",
  );
  await expect(stateOf(page).getByTestId("state-plan")).toContainText("Active");
  await expect(stateOf(page)).toContainText("€99.00");
  expect(await standIn.state()).toMatchObject({
    status: "ACTIVE",
    invoices: [{ kind: "ACTIVATION", status: "PAID", total: 9900 }],
  });

  await trial.getByRole("link", { name: "Open the account" }).click();
  await expect(portal(page).currentPlan).toContainText("Growth");
  await expect(portal(page).invoices).toContainText("Activation");
  await expect(portal(page).invoices).toContainText("Paid");
});

test("journey: a renewal fails, the subscription is past due, and the customer pays the invoice from the portal", async ({
  page,
  context,
  standIn,
}) => {
  await page.goto("/journey");
  const scene = scenario(page, "A renewal fails: past due, then paid from the portal");
  await scene.getByRole("button", { name: "Start over, card declined" }).click();
  await expect(outcomeOf(scene, "Start over, card declined")).toBeVisible();
  await expect(stateOf(page)).toContainText("will be declined");

  await scene.getByRole("button", { name: "Advance to the boundary" }).click();
  await expect(outcomeOf(scene, "Advance to the boundary")).toContainText(
    "The period renewed. An invoice was issued.",
  );
  await expect(stateOf(page).getByTestId("state-plan")).toContainText("Past due");
  await expect(stateOf(page)).toContainText("Payment failed");
  expect(await standIn.state()).toMatchObject({
    status: "PAST_DUE",
    invoices: [{ kind: "RENEWAL", status: "PAYMENT_FAILED", total: 4900 }, { status: "PAID" }],
  });

  // The portal has the unpaid invoice, with a Pay button that opens the provider's page.
  await scene.getByRole("link", { name: "Open the account" }).click();
  const unpaid = portal(page).invoices.getByText("Payment failed");
  await expect(unpaid).toBeVisible();
  const opened = context.waitForEvent("page");
  await portal(page).invoices.getByRole("link", { name: /^Pay / }).first().click();
  const provider = await opened;
  await provider.getByRole("button", { name: "Confirm payment" }).click();
  await expect(provider.getByText("Paid.")).toBeVisible();

  expect(await standIn.state()).toMatchObject({ status: "ACTIVE" });
  await page.bringToFront();
  await expect(portal(page).invoices).not.toContainText("Payment failed", { timeout: 15_000 });
});

test("journey: the vendor schedules Growth with the server token, and the boundary applies it", async ({
  page,
  standIn,
}) => {
  await page.goto("/journey");
  const scene = scenario(page, "The vendor schedules a plan change");
  await scene.getByRole("button", { name: "Start over" }).click();
  await expect(stateOf(page).getByTestId("state-plan")).toContainText("Pro");

  await scene.getByRole("button", { name: "Schedule Growth" }).click();
  await expect(outcomeOf(scene, "Schedule Growth")).toContainText(
    "scheduled for the next boundary",
  );
  await expect(stateOf(page).getByTestId("state-scheduled")).toContainText("Growth");

  // It was the storefront's backend, with the server token, that asked Kaiten.
  const vendor = (await standIn.calls()).find((call) => call.path.endsWith("/scheduled-change"));
  expect(vendor).toMatchObject({ method: "PUT", credential: "ksh_", origin: null, status: 200 });

  // The customer sees what waits in their own account.
  await scene.getByRole("link", { name: "Open the account" }).click();
  await expect(portal(page).currentPlan).toContainText("Pro");
  await expect(portal(page).currentPlan).toContainText("Changes to €99.00/month on");

  await page.getByRole("link", { name: "Journey" }).click();
  await scene.getByRole("button", { name: "Advance to the boundary" }).click();
  await expect(outcomeOf(scene, "Advance to the boundary")).toContainText(
    "renewed on the new plan",
  );
  expect(await standIn.state()).toMatchObject({
    plan: "growth-v1",
    scheduledChange: null,
    invoices: [{ kind: "RENEWAL", total: 9900 }, { total: 4900 }],
  });
});

test("journey: a refusal of the stand-in is shown, not hidden", async ({ page }) => {
  await page.goto("/journey");
  const scene = scenario(page, "Buy a plan with a trial");
  await scene.getByRole("button", { name: "Start over" }).click();
  await scene.getByRole("button", { name: "End the trial now" }).click();
  await expect(outcomeOf(scene, "End the trial now")).toContainText(/no subscription/i);
});

test("a link of the journey opens the page from its title, not where the link was", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true });
  await page.setViewportSize({ width: 380, height: 700 });
  await page.goto("/journey");
  const link = scenario(page, "Change plan: a commercial request").getByRole("link", {
    name: "Open the account",
  });
  await link.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);

  await link.click();
  await expect(page).toHaveURL(/\/portal$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test("on a phone the journey page links to the stand-in's state, which sits below the scenarios", async ({
  page,
}) => {
  await page.setViewportSize({ width: 380, height: 700 });
  await page.goto("/journey");
  await page.getByRole("link", { name: "Jump to what the stand-in holds" }).click();
  await expect(stateOf(page)).toBeInViewport();
  await page.getByRole("link", { name: "Back to the scenarios" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /payment journey/ })).toBeInViewport();
});
