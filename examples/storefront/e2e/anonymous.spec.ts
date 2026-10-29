// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A visitor who buys with no account. The publishable key opens the anonymous checkout, so the pricing table
// leads a visitor straight to a checkout of their own: their company, optionally their name, an email,
// Cloudflare's security check and, for a paid plan, a card on the provider's page. Kaiten makes the customer,
// its instance and the subscription when the checkout completes, and names the customer after the email; the
// storefront's backend then renames them after the company, once it has checked Kaiten's own record. The stand-in for Kaiten plays
// Kaiten (`reset({ signUp: true, anonymousCheckout: true })`), a stand-in for Cloudflare's script plays the
// security check (see `support/cloudflare.ts`), and the page, its backend and the SDK's components are real.

import type { BrowserContext, Page } from "@playwright/test";

import { planCard } from "./support/page.ts";
import { expect, test, type StandIn } from "./support/stand-in.ts";

const STARTER_PRICE = "00000000-0000-4000-8000-000000000101";
const PRO_PRICE = "00000000-0000-4000-8000-000000000201";

/** The visitor's checkout, whichever step it is at. */
const flow = (page: Page) => page.locator('[data-slot="anonymous-checkout-flow"]');

/** The calls the stand-in saw to the anonymous routes, in order. */
const anonymousCalls = async (standIn: StandIn) =>
  (await standIn.calls()).filter((call) => call.path.startsWith("/public/checkout-sessions"));

/** What the visitor types besides the email: the company is asked for, the name is not. */
interface Who {
  company?: string;
  name?: string;
}

/** From the pricing table to the form, and the form filled in and the security check passed. */
async function chooseAndFill(
  page: Page,
  plan: string,
  email = "ada@acme.test",
  who: Who = { company: "Analytical Engines" },
) {
  await page.goto("/");
  await planCard(page, plan).getByRole("button", { name: "Select plan" }).click();
  await expect(page.getByRole("heading", { name: `Subscribe to ${plan}` })).toBeVisible();
  if (who.company !== undefined) await page.getByLabel("Company").fill(who.company);
  if (who.name !== undefined) await page.getByLabel(/^Name/).fill(who.name);
  await page.getByLabel("Email").fill(email);
  await expect(flow(page)).toContainText("Security check passed.");
}

test("a visitor buys a free plan with no account: a company, a name if they like, an email and the security check", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await chooseAndFill(page, "Starter", "ada@acme.test", {
    company: "Analytical Engines",
    name: "Ada Lovelace",
  });

  // No account was asked for, and the page has none: a visitor, with no session minted for them.
  await expect(page.getByRole("heading", { name: /Create your account/ })).toHaveCount(0);
  await expect(page.getByTestId("turnstile-stand-in")).toBeVisible();
  expect((await standIn.state()).customers).toEqual([]);

  await page.getByRole("button", { name: "Start for free" }).click();
  await expect(flow(page)).toContainText("You're subscribed");
  await expect(flow(page)).toContainText("Nothing is due today.");
  await expect(flow(page)).toContainText("Your order is registered for ada@acme.test.");
  await expect(page.getByTestId("visitor-done")).toContainText("checkout_session.v1.completed");
  // The company is on the page once the backend has named the customer after it.
  await expect(page.getByTestId("visitor-company")).toHaveText(
    "Your account is registered for Analytical Engines.",
  );
  // The buyer has a next step of their own, and the note for the vendor is labelled as one and folded
  // away: it is for whoever builds the shop, not for the person who just bought.
  await expect(
    page.getByTestId("visitor-done").getByRole("link", { name: "Back to the plans" }),
  ).toBeVisible();
  const note = page.getByTestId("visitor-dev-note");
  await expect(note.getByText("For the vendor, not the buyer")).toBeVisible();
  await expect(note.getByTestId("visitor-reference")).toBeHidden();
  await note.getByText("For the vendor, not the buyer").click();
  await expect(note.getByTestId("visitor-reference")).toBeVisible();

  // Kaiten made the customer from the address and its instance on the plan, and subscribed it with no
  // provider, no card and no invoice.
  const state = await standIn.state();
  // Kaiten named the customer after the address; the storefront's backend renamed it after the company, and
  // its instance too, with the person as the contact. The billing address is still the buyer's.
  expect(state.customers).toMatchObject([
    { name: "Analytical Engines", billingEmail: "ada@acme.test", createdBy: "system" },
  ]);
  expect(state.customers[0]!.slug).toMatch(/^ada-acme-test-[0-9a-f]{6}$/);
  expect(state.instances).toMatchObject([
    { name: "Analytical Engines", description: "Contact: Ada Lovelace" },
  ]);
  expect(state).toMatchObject({
    subscribed: true,
    free: true,
    plan: "starter-v1",
    status: "ACTIVE",
    cardOnFile: false,
    invoices: [],
    instances: [{ licenseSlug: "starter-v1" }],
    checkoutSessions: [
      {
        status: "COMPLETED",
        email: "ada@acme.test",
        licenseSlug: "starter-v1",
        customerSlug: state.customers[0]!.slug,
        instanceSlug: state.instances[0]!.slug,
        payment: null,
      },
    ],
  });
  // The reference the page gave is echoed for the vendor to link the buyer by, and it is the session's own
  // that the page prints.
  expect(state.checkoutSessions[0]!.clientReferenceId).toMatch(/^order-[0-9a-f]{8}$/);
  await expect(page.getByTestId("visitor-reference")).toHaveText(
    state.checkoutSessions[0]!.clientReferenceId!,
  );
  // One token for the one start, and no token sent twice.
  expect(state.turnstileReused).toBe(0);
  expect((await standIn.events()).map((event) => event.type)).toContain(
    "checkout_session.completed",
  );

  // The page used the publishable key to start and the session's own token for the rest, and never
  // reached the storefront's backend for an account or a session.
  const calls = await standIn.calls();
  const anonymous = await anonymousCalls(standIn);
  expect(anonymous.map((call) => `${call.method} ${call.credential} ${call.status}`)).toEqual([
    "POST pk_ 201",
    "POST ksc_ 200",
  ]);
  expect(anonymous[0]!.body).toMatchObject({
    priceId: STARTER_PRICE,
    email: "ada@acme.test",
    turnstileToken: "…",
  });
  // A real start, not a preview: a preview spends a security check of its own.
  expect(anonymous[0]!.body).toMatchObject({ dryRun: false });
  expect(
    calls.filter(
      (call) => call.path === "/customer-sessions" || call.path.startsWith("/public/session/"),
    ),
  ).toEqual([]);
  expect(calls.filter((call) => call.path === "/customers" || call.path === "/instances")).toEqual(
    [],
  );
  // The storefront's backend read the customer and the instance, then wrote both, with the server token. The
  // page reached it once, and never reached Kaiten's customer routes itself.
  const vendor = calls.filter((call) => call.credential === "ksh_");
  expect(vendor.map((call) => `${call.method} ${call.path.split("/")[1]} ${call.status}`)).toEqual([
    "GET customers 200",
    "GET instances 200",
    "PUT customers 204",
    "PUT instances 204",
  ]);
  expect(
    calls
      .filter((call) => call.credential === "pk_" || call.credential === "ksc_")
      .every((call) => call.path.startsWith("/public/")),
  ).toBe(true);
  // And the browser kept nothing of an account.
  expect(
    (await context.cookies()).filter((cookie) => cookie.name === "storefront_account"),
  ).toEqual([]);
});

test("a visitor who gives a company and no name names the customer after the company, with no contact", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await chooseAndFill(page, "Starter", "ada@acme.test", { company: "Analytical Engines" });
  await page.getByRole("button", { name: "Start for free" }).click();
  await expect(page.getByTestId("visitor-company")).toContainText("Analytical Engines");

  const state = await standIn.state();
  expect(state.customers).toMatchObject([{ name: "Analytical Engines" }]);
  expect(state.instances).toMatchObject([{ name: "Analytical Engines", description: "" }]);
});

test("the company is asked for and the name is not: the form says which, and the button waits for the company only", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await page.goto("/");
  await planCard(page, "Starter").getByRole("button", { name: "Select plan" }).click();
  await expect(flow(page)).toContainText("Security check passed.");

  // Company, name, email, in that order, with the browser's own words for each.
  const fields = page.locator('[data-slot="anonymous-checkout-flow"] input[data-field]');
  await expect(fields).toHaveCount(3);
  expect(
    await fields.evaluateAll((all) => all.map((each) => each.getAttribute("data-field"))),
  ).toEqual(["company", "name", "email"]);
  await expect(page.getByLabel("Company")).toHaveAttribute("autocomplete", "organization");
  await expect(page.getByLabel("Company")).toHaveAttribute("required", "");
  await expect(page.getByLabel(/^Name/)).toHaveAttribute("autocomplete", "name");
  await expect(page.getByLabel(/^Name/)).not.toHaveAttribute("required", "");
  await expect(page.getByText("Name (optional)")).toBeVisible();

  const start = page.getByRole("button", { name: "Start for free" });
  await page.getByLabel("Email").fill("ada@acme.test");
  await expect(start).toHaveAttribute("aria-disabled", "true");
  // Pressed anyway, it says what is missing and goes to the field.
  // (Playwright takes an `aria-disabled` button for one that is not enabled, which the keyboard and a finger can press.)
  await start.click({ force: true });
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter your company name." }),
  ).toBeVisible();
  await expect(page.getByLabel("Company")).toBeFocused();
  await page.getByLabel("Company").fill("Analytical Engines");
  await expect(start).not.toHaveAttribute("aria-disabled", "true");
  expect(await standIn.state()).toMatchObject({ customers: [], checkoutSessions: [] });
});

test("a post the backend cannot match to Kaiten's record is refused: the customer keeps the address and the buyer is told", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  // A page whose report was changed on the way: the address is not the customer's.
  await page.route("**/storefront-api/checkout/completed", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.continue({ postData: JSON.stringify({ ...body, email: "mallory@evil.test" }) });
  });
  await chooseAndFill(page, "Starter", "ada@acme.test", {
    company: "Evil Corp",
    name: "Mallory",
  });
  await page.getByRole("button", { name: "Start for free" }).click();

  await expect(flow(page)).toContainText("You're subscribed");
  await expect(page.getByTestId("visitor-company-failed")).toHaveText(
    "Your order is complete, but we could not register your company name.",
  );
  await expect(page.getByTestId("visitor-company")).toHaveCount(0);
  const state = await standIn.state();
  expect(state.customers).toMatchObject([{ name: "ada@acme.test" }]);
  expect(state.instances).toMatchObject([{ name: "ada@acme.test", description: "" }]);
  // Kaiten was asked to read the customer and nothing more: no write was made.
  const writes = (await standIn.calls()).filter((call) => call.method === "PUT");
  expect(writes).toEqual([]);
});

test("a visitor buys a paid plan through the provider's page, and the plan starts once it is paid", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await chooseAndFill(page, "Pro");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // The review is the server's: what is due today, for the address the visitor gave.
  await expect(flow(page)).toContainText("For ada@acme.test");
  await expect(flow(page)).toContainText("€49.00");
  expect(await standIn.state()).toMatchObject({
    customers: [],
    checkoutSessions: [{ status: "OPEN", licenseSlug: "pro-v2" }],
  });

  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const provider = await opened;
  await expect(flow(page)).toContainText("Save your payment method in the window we opened");
  await expect(provider.getByRole("heading", { name: "Payment provider" })).toBeVisible();
  // Nothing exists but the session until the card is saved and the checkout confirmed again.
  expect(await standIn.state()).toMatchObject({ customers: [], subscribed: false });

  // The provider sends the visitor back to the checkout, naming the session, which says so to the page that
  // waits and closes. That page carries on.
  await provider.getByRole("button", { name: /Save card/ }).click();
  await provider.waitForEvent("close");

  await expect(flow(page)).toContainText("You're subscribed");
  await expect(flow(page)).toContainText("Payment received.");
  await expect(page).toHaveURL(new RegExp(`/checkout/pro-v2\\?price=${PRO_PRICE}$`));

  const state = await standIn.state();
  expect(state).toMatchObject({
    subscribed: true,
    plan: "pro-v2",
    status: "ACTIVE",
    card: "Visa 4242",
    billingEmail: "ada@acme.test",
    invoices: [{ kind: "ACTIVATION", status: "PAID", total: 4900 }],
    instances: [{ licenseSlug: "pro-v2" }],
    checkoutSessions: [{ status: "COMPLETED", payment: "paid" }],
  });
  expect((await standIn.events()).map((event) => event.type)).toEqual([
    "checkout_session.started",
    "customer.payment_method.attached",
    "instance.invoice.issued",
    "instance.invoice.paid",
    "instance.billing.started",
    "checkout_session.completed",
  ]);

  // One start with the key; the session's token for what followed. Neither credential strayed.
  const anonymous = await anonymousCalls(standIn);
  expect(anonymous[0]).toMatchObject({ method: "POST", credential: "pk_", status: 201 });
  expect(anonymous.slice(1).every((call) => call.credential === "ksc_")).toBe(true);
  expect(anonymous.filter((call) => call.path.endsWith("/confirm")).map((c) => c.status)).toEqual([
    200, 200,
  ]);
  const starts = anonymous.filter((call) => call.method === "POST" && call.credential === "pk_");
  // One start per attempt: no preview on the way, which would have spent a security check.
  expect(starts).toHaveLength(1);
});

test("a visitor whose security check Kaiten refuses passes it again, and nothing was made meanwhile", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await standIn.turnstile("fail", 1);
  await chooseAndFill(page, "Pro");

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(flow(page).getByText("We couldn't verify the security check.")).toBeVisible();
  // The token was spent: the widget gave another, and the form is as the visitor left it. The new
  // check is not said to have passed beside the refusal; the button is back, which says it.
  await expect(page.getByLabel("Email")).toHaveValue("ada@acme.test");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(flow(page)).not.toContainText("Security check passed.");
  expect(await standIn.state()).toMatchObject({ customers: [], checkoutSessions: [] });

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(flow(page)).toContainText("For ada@acme.test");

  const starts = (await anonymousCalls(standIn)).filter((call) => call.credential === "pk_");
  expect(starts.map((call) => call.status)).toEqual([422, 201]);
  // The two starts did not share a token: Kaiten refuses one it has seen, as Cloudflare does.
  expect(await standIn.state()).toMatchObject({ turnstileChecks: 2, turnstileReused: 0 });
});

test("a visitor says the security check could not be reached, and goes on once it can", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await standIn.turnstile("unavailable", 1);
  await chooseAndFill(page, "Pro");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    flow(page).getByText(/can't be reached right now. Try again in 30 seconds/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(flow(page)).toContainText("For ada@acme.test");
});

test("a checkout nobody confirmed is closed, says so, and starts again; a trial that asks for no card begins at once", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await chooseAndFill(page, "Lite");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Lite has a trial and asks for no payment method: nothing is due, and nothing is asked for.
  await expect(flow(page)).toContainText("For ada@acme.test");
  await expect(flow(page)).toContainText("No payment method is asked for.");
  await expect(page.getByRole("button", { name: "Start free trial" })).toBeVisible();

  // The visitor leaves it open for more than a day.
  expect(await standIn.expireCheckout()).toMatchObject({ status: "ABANDONED" });
  await page.getByRole("button", { name: "Start free trial" }).click();
  await expect(
    flow(page).getByText(
      "This checkout stayed open for too long and was closed. Nothing was charged.",
    ),
  ).toBeVisible();
  expect(await standIn.state()).toMatchObject({
    customers: [],
    subscribed: false,
    checkoutSessions: [{ status: "ABANDONED" }],
  });
  const confirms = (await anonymousCalls(standIn)).filter((call) => call.path.endsWith("/confirm"));
  expect(confirms.map((call) => call.status)).toEqual([409]);

  // Start again: the choices are asked for afresh, and a new session goes through.
  await page.getByRole("button", { name: "Start again" }).click();
  await page.getByLabel("Company").fill("Analytical Engines");
  await page.getByLabel("Email").fill("ada@acme.test");
  await expect(flow(page)).toContainText("Security check passed.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Start free trial" }).click();
  await expect(flow(page)).toContainText("You're subscribed");

  const state = await standIn.state();
  expect(state).toMatchObject({
    status: "TRIAL",
    plan: "lite-v1",
    cardOnFile: false,
    invoices: [],
    checkoutSessions: [{ status: "ABANDONED" }, { status: "COMPLETED", licenseSlug: "lite-v1" }],
  });
  expect(state.trialEndsAt).not.toBeNull();
  expect((await standIn.events()).map((event) => event.type)).toEqual([
    "checkout_session.started",
    "checkout_session.abandoned",
    "checkout_session.started",
    "instance.billing.started",
    "checkout_session.completed",
  ]);

  // The same address has had Lite's trial: a second visit is shown the price it is due today.
  await page.goto("/");
  await planCard(page, "Lite").getByRole("button", { name: "Select plan" }).click();
  await page.getByLabel("Company").fill("Analytical Engines");
  await page.getByLabel("Email").fill("Ada@Acme.test ");
  await expect(flow(page)).toContainText("Security check passed.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(flow(page)).toContainText("This email has already had this plan's trial");
  await expect(flow(page)).toContainText("€19.00");
});

test("a payment that never comes closes the session as expired, and the customer stays on the free plan", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await standIn.payment("failed");
  await chooseAndFill(page, "Pro");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const provider = await opened;
  await provider.getByRole("button", { name: /Save card/ }).click();
  await provider.waitForEvent("close");

  // The card was refused: the checkout offers the invoice, and the instance is not on the plan.
  await expect(flow(page)).toContainText("Your payment didn't go through.");
  await expect(flow(page).getByRole("link", { name: "Pay invoice" })).toBeVisible();
  expect(await standIn.state()).toMatchObject({
    subscribed: false,
    plan: "starter-v1",
    instances: [{ licenseSlug: "starter-v1" }],
    checkoutSessions: [{ status: "AWAITING_PAYMENT", payment: "failed" }],
  });

  expect(await standIn.expireCheckout()).toMatchObject({ status: "EXPIRED" });
  await expect(
    flow(page).getByText("The payment didn't come through in time, so this checkout was closed."),
  ).toBeVisible({ timeout: 20_000 });
  expect(await standIn.state()).toMatchObject({
    subscribed: false,
    checkoutSessions: [{ status: "EXPIRED", customerSlug: expect.any(String) }],
  });
});

test("a trial that asks for a card is started only once the card is saved, with nothing charged", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await chooseAndFill(page, "Growth");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(flow(page)).toContainText("For ada@acme.test");

  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const provider = await opened;
  expect(await standIn.state()).toMatchObject({ customers: [], subscribed: false });
  await provider.getByRole("button", { name: /Save card/ }).click();
  await provider.waitForEvent("close");

  await expect(flow(page)).toContainText("You're subscribed");
  expect(await standIn.state()).toMatchObject({
    status: "TRIAL",
    plan: "growth-v1",
    cardOnFile: true,
    invoices: [],
    checkoutSessions: [{ status: "COMPLETED", licenseSlug: "growth-v1", payment: null }],
  });
});

test("the key's anonymous checkout is read from the catalogue: off, a visitor makes an account first", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: false });
  await page.goto(`/checkout/pro-v2?price=${PRO_PRICE}`);
  await expect(
    page.getByRole("heading", { name: "Create your account to subscribe to Pro" }),
  ).toBeVisible();
  await expect(flow(page)).toHaveCount(0);

  // Switched on, the same visit leads to the visitor's checkout, with no account.
  await standIn.anonymousCheckout(true);
  await page.goto(`/checkout/pro-v2?price=${PRO_PRICE}`);
  await expect(page.getByRole("heading", { name: "Subscribe to Pro" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Create your account/ })).toHaveCount(0);
});

test("the one-customer mode is left as it was, and the account page still offers an account", async ({
  page,
  standIn,
}) => {
  // One customer is signed in for everyone: there is no visitor to sell to, whatever the key opens.
  await standIn.reset({ anonymousCheckout: true });
  await page.goto("/");
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await expect(page.locator('[data-slot="checkout-flow"]')).toBeVisible();
  await expect(flow(page)).toHaveCount(0);
  expect(await anonymousCalls(standIn)).toEqual([]);

  // A visitor of the sign-up mode can still make an account from the Account page.
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: /Create your account/ })).toBeVisible();
});

test("the journey page starts the visitor's anonymous checkout, and the security check it refuses once", async ({
  page,
  standIn,
}) => {
  await page.goto("/journey");
  const scenario = page.getByRole("article", { name: "A visitor buys with no account" });
  await scenario.getByRole("button", { name: "Start as a visitor" }).click();
  await expect(scenario.getByRole("status").first()).toContainText("back to its starting point");
  expect(await standIn.state()).toMatchObject({ anonymousCheckout: true, customers: [] });

  // No checkout is waiting yet, and the presenter is told so in words.
  await scenario.getByRole("button", { name: "Let a checkout expire" }).click();
  await expect(
    scenario.getByRole("status").filter({ hasText: "No checkout is waiting" }),
  ).toHaveText("No checkout is waiting: open a plan's checkout first.");

  await scenario.getByRole("button", { name: "Refuse the next security check" }).click();
  await expect(
    scenario.getByRole("status").filter({ hasText: "The next verification is refused" }),
  ).toBeVisible();

  // The page learnt, without a reload, that the key opens the anonymous checkout.
  await scenario.getByRole("link", { name: "Open Starter's checkout" }).click();
  await expect(page.getByRole("heading", { name: "Subscribe to Starter" })).toBeVisible();
  await page.getByLabel("Company").fill("Difference Engines");
  await page.getByLabel("Email").fill("grace@acme.test");
  await expect(flow(page)).toContainText("Security check passed.");
  await page.getByRole("button", { name: "Start for free" }).click();
  await expect(flow(page).getByText("We couldn't verify the security check.")).toBeVisible();
  await page.getByRole("button", { name: "Start for free" }).click();
  await expect(flow(page)).toContainText("You're subscribed");

  // The stand-in's panel lists the visitor's checkouts.
  await page.goto("/journey");
  await expect(page.getByTestId("checkout-sessions")).toContainText("grace@acme.test");
});

test("a visitor sent to the provider's page in the same tab comes back to a page that is loaded again, and it prints the session's reference", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  // The browser blocks the popup, so the checkout sends this very tab to the provider's page.
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await chooseAndFill(page, "Pro");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(flow(page)).toContainText("For ada@acme.test");
  await page.evaluate(() => {
    (window as unknown as { loadedOnce: boolean }).loadedOnce = true;
  });

  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment provider" })).toBeVisible();
  await page.getByRole("button", { name: /Save card/ }).click();

  await expect(flow(page)).toContainText("You're subscribed");
  // The page was loaded again on the way, so its own reference (made when it mounted) is not the one that
  // was sent to Kaiten.
  expect(
    await page.evaluate(() => (window as unknown as { loadedOnce?: boolean }).loadedOnce),
  ).toBeUndefined();
  const [session] = (await standIn.state()).checkoutSessions;
  expect(session).toMatchObject({ status: "COMPLETED", licenseSlug: "pro-v2" });
  expect(session!.clientReferenceId).toMatch(/^order-[0-9a-f]{8}$/);
  // What the vendor is told is the reference of the session, which the SDK reads back from it.
  await expect(page.getByTestId("visitor-reference")).toHaveText(session!.clientReferenceId!);
  // The company typed before the provider's page, in the tab that was sent away, is still the visitor's
  // when they are back, and names the customer.
  await expect(page.getByTestId("visitor-company")).toContainText("Analytical Engines");
  expect((await standIn.state()).customers).toMatchObject([{ name: "Analytical Engines" }]);
});

/** A second tab of another visitor with the same address buys Growth to the end: the trial is used up. */
async function useUpTheTrial(context: BrowserContext, email: string) {
  const other = await context.newPage();
  await chooseAndFill(other, "Growth", email);
  await other.getByRole("button", { name: "Continue", exact: true }).click();
  const opened = context.waitForEvent("page");
  await other.getByRole("button", { name: "Continue to payment" }).click();
  const provider = await opened;
  await provider.getByRole("button", { name: /Save card/ }).click();
  await provider.waitForEvent("close");
  await expect(flow(other)).toContainText("You're subscribed");
  await other.close();
}

test("a trial another checkout used up before the card is saved is shown at its new price, both amounts side by side", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await chooseAndFill(page, "Growth");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(flow(page)).toContainText("For ada@acme.test");

  await useUpTheTrial(context, "ada@acme.test");

  // The confirm finds the trial gone: nothing is captured, and the visitor sees what changed first.
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(flow(page)).toContainText(
    "The amount due changed from €0.00 to €99.00. Check it before you continue.",
  );
  expect(await standIn.state()).toMatchObject({ customers: [expect.anything()] });
});

test("a trial another checkout used up while the card was being saved is refused for the new amount, and the visitor starts again", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await chooseAndFill(page, "Growth");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const provider = await opened;

  // While this visitor is on the provider's page, the same address takes the trial in another tab.
  await useUpTheTrial(context, "ada@acme.test");

  await provider.getByRole("button", { name: /Save card/ }).click();
  await provider.waitForEvent("close");
  await expect(
    flow(page).getByText(/The amount due changed after your payment method was saved\./),
  ).toBeVisible();
  // Nothing was charged and nothing more was made: the other visitor's customer is the only one.
  expect(await standIn.state()).toMatchObject({
    customers: [expect.anything()],
    invoices: [],
  });
  await page.getByRole("button", { name: "Start again" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("a long address stays inside the card on a phone, in the review and once bought", async ({
  page,
  standIn,
}) => {
  const long = "ada.lovelace.with.a.very.long.address@subdomain.example-company.test";
  const sideways = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  await page.setViewportSize({ width: 320, height: 800 });

  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await chooseAndFill(page, "Pro", long);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(flow(page)).toContainText(`For ${long}`);
  expect(await sideways()).toBeLessThanOrEqual(0);

  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await chooseAndFill(page, "Starter", long);
  await page.getByRole("button", { name: "Start for free" }).click();
  await expect(flow(page)).toContainText(`Your order is registered for ${long}.`);
  await expect(page.getByTestId("visitor-done")).toBeVisible();
  expect(await sideways()).toBeLessThanOrEqual(0);
});

test("the checkout is a new page to the keyboard and the screen reader: titled, with focus on its heading", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await page.goto("/");
  await expect(page).toHaveTitle("Pricing · Acme");
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await expect(page).toHaveTitle("Subscribe to Pro · Acme");
  const heading = page.getByRole("heading", { name: "Subscribe to Pro" });
  await expect(heading).toBeFocused();
  // The same when the page is loaded at its address, with the catalogue still to be read.
  await page.goto(`/checkout/pro-v2?price=${PRO_PRICE}`);
  await expect(heading).toBeFocused();
});

test("a button that is not available says why, and a link to a tab of its own says so", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await page.goto("/");
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await expect(flow(page)).toContainText("Security check passed.");
  const next = page.getByRole("button", { name: "Continue", exact: true });
  // Focusable and dimmed, not disabled; the sentence under it is its description.
  await expect(next).toHaveAttribute("aria-disabled", "true");
  expect(await next.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
  // The company is asked for first, then the email.
  await expect(next).toHaveAccessibleDescription("Enter your company name.");
  await page.getByLabel("Company").fill("Analytical Engines");
  await expect(next).toHaveAccessibleDescription("Enter your email address to continue.");

  await page.getByLabel("Email").fill("ada@acme.test");
  await expect(next).not.toHaveAttribute("aria-disabled", "true");
  await next.click();
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await opened;
  await expect(page.getByRole("link", { name: "Open the page again" })).toHaveAccessibleDescription(
    "opens in a new tab",
  );
});

test("a plan the catalogue does not have is a page of its own, titled and focused, with a way back", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await page.goto("/checkout/no-such-plan");
  const heading = page.getByRole("heading", { name: "Plan not found" });
  await expect(heading).toBeFocused();
  await expect(page).toHaveTitle("Plan not found · Acme");
  await expect(page.getByText("No plan is called “no-such-plan”.")).toBeVisible();
  await page.getByRole("link", { name: "Back to the plans" }).click();
  await expect(page).toHaveTitle("Pricing · Acme");
});

test("a plan sold by contact only says so, with a way to ask and a way back, and no form", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true, anonymousCheckout: true });
  await page.goto("/checkout/enterprise-v1");
  await expect(flow(page)).toContainText("This plan isn't sold online. Contact us to get it.");
  await expect(flow(page).getByLabel("Email")).toHaveCount(0);
  await expect(flow(page).getByRole("link", { name: "Contact us" })).toBeVisible();
  await flow(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveTitle("Pricing · Acme");
});
