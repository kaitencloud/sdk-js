// What the storefront does when a customer's way is not the happy one: a card that is declined, a
// payment that needs the customer's confirmation, a page whose origin the key does not allow, a
// session that has expired, a request that has to wait, and a change to an add-on that is refused. The stand-in for Kaiten is told what to
// refuse, and each test reads what the customer reads.

import { checkout, planCard, portal } from "./support/page.ts";
import { expect, refusal, test } from "./support/stand-in.ts";

/** A customer who has a card and an email, on the checkout of Pro with what is due today in view. */
async function atTheCheckout(page: import("@playwright/test").Page) {
  await page.goto("/");
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await expect(checkout(page)).toContainText("Due today");
}

test("a card that is declined still subscribes the customer, who can pay the invoice", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ card: true, email: true });
  await standIn.payment("failed");
  await atTheCheckout(page);
  await page.getByRole("button", { name: "Subscribe" }).click();

  await expect(checkout(page)).toContainText("You're subscribed");
  await expect(checkout(page)).toContainText("your card was declined");
  await expect(page.getByRole("button", { name: "Update payment method" })).toBeVisible();
  expect(await standIn.state()).toMatchObject({
    subscribed: true,
    invoices: [{ status: "PAYMENT_FAILED", total: 4900 }],
  });

  // The customer pays the invoice on the provider's page. The checkout waits for it, and says so.
  const pay = page.getByRole("link", { name: "Pay invoice" });
  await expect(pay).toHaveAttribute("href", /\/kaiten-double\/provider\/invoice\//);
  const opened = context.waitForEvent("page");
  await pay.click();
  const provider = await opened;
  await provider.getByRole("button", { name: "Confirm payment" }).click();
  await expect(provider.getByText("Paid.")).toBeVisible();

  await page.bringToFront();
  await expect(checkout(page)).toContainText("Payment received.", { timeout: 15_000 });
});

test("a payment that needs the customer's confirmation is waited on until they have given it", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ card: true, email: true });
  await standIn.payment("requires_action");
  await atTheCheckout(page);
  await page.getByRole("button", { name: "Subscribe" }).click();

  await expect(checkout(page)).toContainText("You're subscribed");
  await expect(checkout(page)).toContainText("Confirm your payment to finish.");
  await expect(checkout(page)).toContainText("Waiting for your payment");
  expect(await standIn.state()).toMatchObject({ invoices: [{ status: "PAYMENT_FAILED" }] });

  // The provider's page is where a 3-D Secure challenge is answered.
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Complete payment" }).click();
  const provider = await opened;
  await provider.getByRole("button", { name: "Confirm payment" }).click();
  await expect(provider.getByText("Paid.")).toBeVisible();

  await page.bringToFront();
  await expect(checkout(page)).toContainText("Payment received.", { timeout: 15_000 });
  await expect(checkout(page)).not.toContainText("Waiting for your payment");
});

test("a page on an origin the key does not allow gets no catalogue, and can ask again", async ({
  page,
  standIn,
}) => {
  await standIn.script(
    "GET /public/catalog",
    refusal(403, "PublicAuth.OriginNotAllowed", "this origin is not allowed"),
  );
  await page.goto("/");

  await expect(page.getByRole("alert").filter({ hasText: "Failed to load" })).toBeVisible();
  await expect(planCard(page, "Pro")).toHaveCount(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(planCard(page, "Pro")).toBeVisible();
});

test("a session the API no longer takes is renewed, and the request is made again", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true });
  await standIn.script(
    "GET /public/session/portal",
    refusal(401, "PublicAuth.InvalidCredential", "the session has expired"),
  );
  await page.goto("/portal");

  await expect(portal(page).currentPlan).toContainText("Pro");
  // The first session was refused and the page asked its backend for another, which is the one that read the portal.
  expect((await standIn.state()).minted).toBe(2);
  const reads = (await standIn.calls()).filter((call) => call.path === "/public/session/portal");
  expect(reads.map((call) => call.status)).toEqual([401, 200]);
  await expect(page.getByText("Your session has ended")).toHaveCount(0);
});

test("a session that cannot be renewed ends the customer's visit, and says so", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true });
  const expired = refusal(401, "PublicAuth.InvalidCredential", "the session has expired");
  await standIn.script("GET /public/session/portal", expired, expired);
  await page.goto("/portal");

  await expect(page.getByRole("alert").filter({ hasText: "Your session has ended" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Failed to load" })).toBeVisible();
  expect((await standIn.state()).minted).toBe(2);
});

test("a customer who is asked to wait is told so, and subscribes when they ask again", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ card: true, email: true });
  // The preview goes through, and the checkout that subscribes is the one that is made to wait.
  await standIn.script("POST /public/session/checkout", {
    ...refusal(429, "PublicAuth.RateLimited", "too many requests", 30),
    dryRun: false,
  });
  await atTheCheckout(page);
  await page.getByRole("button", { name: "Subscribe" }).click();

  await expect(checkout(page)).toContainText("Too many attempts. Try again in a moment.");
  expect(await standIn.state()).toMatchObject({ subscribed: false });

  // Nothing was lost: the choice is where it was, and the same button goes through.
  await expect(checkout(page)).toContainText("Due today");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(checkout(page)).toContainText("You're subscribed");
  expect(await standIn.state()).toMatchObject({ subscribed: true });
});

test("a backend that cannot mint a session leaves the page with an error it can retry", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true });
  // Kaiten limits the minting of sessions: the storefront's route answers 429, and the page cannot read its portal.
  await standIn.script(
    "POST /customer-sessions",
    refusal(429, "CreateCustomerSession.RateLimited", "too many sessions", 2),
  );
  await page.goto("/portal");

  await expect(page.getByRole("alert").filter({ hasText: "Failed to load" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(portal(page).currentPlan).toContainText("Pro");
});

test("the portal offers no add-on the subscription cannot be billed, and says why a change was refused", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true });
  await page.goto("/portal");

  // Pro, in euros: the seats are sold in euros and offered, the GPU pack in dollars only and not.
  const addOns = page.locator('[data-slot="addon"]');
  await expect(addOns).toHaveCount(1);
  await expect(addOns).toContainText("Extra seats");
  await expect(page.getByRole("button", { name: "Add one GPU pack" })).toHaveCount(0);

  // A refusal is said with its reason, not as a failure to try again.
  await standIn.script(
    "PUT /public/session/addons/extra-seats-v1",
    refusal(409, "SetSessionAddonQuantity.OtherVersionAttached", "another version is attached"),
  );
  await page.getByRole("button", { name: "Add one Extra seats" }).click();
  await expect(
    page.getByText("Your plan already includes another version of this add-on."),
  ).toBeVisible();
  await expect(page.getByText("That didn't work. Please try again.")).toHaveCount(0);
  expect((await standIn.state()).addOns).toEqual([]);

  // The next one goes through, and the sentence goes with it.
  await page.getByRole("button", { name: "Add one Extra seats" }).click();
  await expect(page.getByRole("status", { name: "Quantity of Extra seats" })).toHaveText("1");
  await expect(
    page.getByText("Your plan already includes another version of this add-on."),
  ).toHaveCount(0);
});
