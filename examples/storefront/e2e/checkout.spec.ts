// A customer's way through the storefront, from its pricing table to its portal, against the
// stand-in for Kaiten: the page, the storefront's backend and the SDK's components, all of them
// real, and only Kaiten and the payment provider played.

import { checkout, planCard, portal, startCheckout } from "./support/page.ts";
import { expect, test } from "./support/stand-in.ts";

test("the pricing table sells the catalogue's plans, and sends each to its checkout", async ({
  page,
  standIn,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("double-notice")).toBeVisible();
  // Eight plans in the catalogue: six can be bought alone, one is priced on request, and one has no
  // price a customer could pay.
  await expect(page.locator('[data-slot="pricing-table"] [data-slot="card-title"]')).toHaveText([
    "Starter",
    "Pro",
    "Growth",
    "Lite",
    "Enterprise",
    "Solo",
    "Japan",
    "Kuwait",
    "Feature comparison",
  ]);
  await expect(page.getByRole("button", { name: "Select plan" })).toHaveCount(6);
  await expect(
    planCard(page, "Enterprise").getByRole("link", { name: "Contact us" }),
  ).toBeVisible();
  await expect(planCard(page, "Pro")).toContainText("€49.00");

  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await expect(page).toHaveURL(/\/checkout\/pro-v2\?price=00000000-0000-4000-8000-000000000201$/);
  await expect(page.getByRole("heading", { name: "Subscribe to Pro" })).toBeVisible();

  // The catalogue was read with the publishable key alone, and the portal with a customer session.
  const calls = await standIn.calls();
  expect(calls.find((call) => call.path === "/public/catalog")?.credential).toBe("pk_");
  expect(calls.find((call) => call.path === "/public/session/portal")?.credential).toBe("kst_");
});

test("a customer with no card subscribes through the provider's page, in a popup", async ({
  page,
  context,
  standIn,
}) => {
  await startCheckout(page, "Pro");

  // What is due today is the server's, once it has an address to send the invoices to.
  await expect(checkout(page)).toContainText("Due today");
  await expect(checkout(page)).toContainText("€49.00");

  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Subscribe" }).click();
  const provider = await opened;

  await expect(checkout(page)).toContainText("Save your payment method in the window we opened");
  await expect(provider.getByRole("heading", { name: "Payment provider" })).toBeVisible();
  expect(await standIn.state()).toMatchObject({ subscribed: false, cardOnFile: false });

  // The provider sends the customer back to the checkout, which says so to the page that is waiting and
  // closes. That page carries on with the card.
  await provider.getByRole("button", { name: /Save card/ }).click();
  await provider.waitForEvent("close");

  await expect(checkout(page)).toContainText("You're subscribed");
  await expect(checkout(page)).toContainText("Payment received.");
  expect(await standIn.state()).toMatchObject({
    subscribed: true,
    cardOnFile: true,
    billingEmail: "billing@acme.test",
    invoices: [{ status: "PAID", total: 4900 }],
  });

  // The checkout was made twice, and the second time with the setup session the first one gave.
  const checkouts = (await standIn.calls()).filter(
    (call) => call.method === "POST" && call.path === "/public/session/checkout",
  );
  const bodies = checkouts.map((call) => call.body as Record<string, unknown>);
  expect(bodies.filter((body) => body.dryRun === true).length).toBeGreaterThan(0);
  const real = bodies.filter((body) => body.dryRun !== true);
  expect(real).toHaveLength(2);
  expect(real[0]).toMatchObject({ licensePriceId: "00000000-0000-4000-8000-000000000201" });
  expect(real[0]).toHaveProperty("returnUrl");
  expect(real[1]).toHaveProperty("setupSessionId");
});

test("a page that cannot open a popup is sent to the provider's, and the checkout goes on when it is back", async ({
  page,
  standIn,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await startCheckout(page, "Pro");
  await expect(checkout(page)).toContainText("Due today");

  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByRole("heading", { name: "Payment provider" })).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/^\/kaiten-double\/provider\/setup\//);

  await page.getByRole("button", { name: /Save card/ }).click();

  // Back on the checkout it left, with what it had chosen, and no trace of the return in the address.
  await expect(page).toHaveURL(/\/checkout\/pro-v2\?price=/);
  await expect(checkout(page)).toContainText("You're subscribed");
  await expect(checkout(page)).toContainText("Payment received.");
  expect(page.url()).not.toContain("kaiten_");
  expect(await standIn.state()).toMatchObject({ subscribed: true, cardOnFile: true });
});

test("a customer with a card subscribes at once, and finds the subscription in the portal", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ card: true, email: true });
  await page.goto("/");
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();

  await expect(checkout(page)).toContainText("Due today");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(checkout(page)).toContainText("You're subscribed");
  expect(await standIn.state()).toMatchObject({ subscribed: true });

  await page.getByRole("link", { name: "Go to your account" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await expect(portal(page).currentPlan).toContainText("Pro");
  await expect(portal(page).currentPlan).toContainText("Renews on");
  // The activation invoice, paid, with the provider's page and PDF to read it on.
  await expect(portal(page).invoices).toContainText("Activation");
  await expect(portal(page).invoices).toContainText("Paid");
  await expect(portal(page).invoices.getByRole("link", { name: "PDF" })).toBeVisible();
});

test("a customer cancels the subscription at the end of its period, and withdraws it", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ card: true, email: true });
  await page.goto("/");
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(checkout(page)).toContainText("You're subscribed");
  await page.getByRole("link", { name: "Go to your account" }).click();

  await page.getByRole("button", { name: "Cancel subscription" }).click();
  await expect(page.getByText(/Your subscription will end on/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel at period end" }).click();

  await expect(portal(page).currentPlan).toContainText("Ends on");
  expect(await standIn.state()).toMatchObject({ subscribed: true, cancelAtPeriodEnd: true });

  await page.getByRole("button", { name: "Reactivate subscription" }).click();
  await expect(portal(page).currentPlan).not.toContainText("Ends on");
  await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeVisible();
  expect(await standIn.state()).toMatchObject({ subscribed: true, cancelAtPeriodEnd: false });
});

test("each credential stays on its own routes, and the page never holds the server's", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ card: true, email: true });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(`${request.headers()["authorization"] ?? ""}`));

  await page.goto("/");
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(checkout(page)).toContainText("You're subscribed");

  const calls = await standIn.calls();
  for (const call of calls) {
    if (call.path === "/public/catalog") expect(call.credential, call.path).toBe("pk_");
    else if (call.path.startsWith("/public/session/"))
      expect(call.credential, call.path).toBe("kst_");
    // The only caller of the minting route is the storefront's backend, which sends no `Origin`.
    else if (call.path === "/customer-sessions") {
      expect(call.credential).toBe("ksh_");
      expect(call.origin).toBeNull();
    }
  }
  expect(calls.some((call) => call.path === "/customer-sessions")).toBe(true);
  // A browser never sent a secret.
  expect(requests.some((header) => header.includes("ksh_"))).toBe(false);
});
