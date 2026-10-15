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

  // What is due today is the server's.
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

  // Once the checkout subscribed the instance, nothing more was previewed: the stand-in would have
  // refused it with a 409, which the customer would have been told.
  const checkouts = (await standIn.calls()).filter(
    (call) => call.method === "POST" && call.path === "/public/session/checkout",
  );
  const lastReal = checkouts.findLastIndex(
    (call) => (call.body as { dryRun?: boolean }).dryRun !== true,
  );
  expect(lastReal).toBeGreaterThan(0);
  expect(checkouts.slice(lastReal + 1)).toEqual([]);
  expect(checkouts.filter((call) => call.status === 409)).toEqual([]);
  await expect(checkout(page)).not.toContainText("already have a subscription");
});

test("a customer with no billing email sees what is due before giving one, and needs it to subscribe", async ({
  page,
  standIn,
}) => {
  await page.goto("/");
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();

  // Kaiten prices a preview without an address: the amounts are there, and no address was sent.
  await expect(checkout(page)).toContainText("Due today");
  await expect(checkout(page)).toContainText("€49.00");
  await expect(checkout(page)).toContainText("Enter your billing email to subscribe.");
  await expect(page.getByRole("button", { name: "Subscribe" })).toBeDisabled();
  const previews = (await standIn.calls()).filter(
    (call) => call.method === "POST" && call.path === "/public/session/checkout",
  );
  expect(previews.length).toBeGreaterThan(0);
  for (const call of previews) {
    expect(call.body).toMatchObject({ dryRun: true });
    expect(call.body).not.toHaveProperty("billingEmail");
    expect(call.status).toBe(200);
  }

  // The address is only needed to subscribe: typing it keeps the summary and enables the button.
  await page.getByLabel("Billing email").fill("billing@acme.test");
  await expect(page.getByRole("button", { name: "Subscribe" })).toBeEnabled();
  await expect(checkout(page)).toContainText("€49.00");
  await expect(checkout(page)).not.toContainText("Enter your billing email to subscribe.");
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

test("a plan with a trial offers to start without it, with the console's checkbox", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ email: true });
  await page.goto("/");
  await planCard(page, "Growth").getByRole("button", { name: "Select plan" }).click();

  // A button with the role of a checkbox, not the browser's blue square.
  const skip = page.getByRole("checkbox", { name: "Start without the free trial" });
  await expect(skip).toHaveAttribute("data-slot", "checkbox");
  await expect(skip).toHaveAttribute("aria-checked", "false");
  await expect(checkout(page)).toContainText("Trial ends on");

  // The label's own words tick it, and the checkout is priced again without the trial.
  await checkout(page).getByText("Start without the free trial").click();
  await expect(skip).toHaveAttribute("aria-checked", "true");
  await expect(checkout(page)).not.toContainText("Trial ends on");

  // The space bar takes the trial back.
  await skip.focus();
  await page.keyboard.press("Space");
  await expect(skip).toHaveAttribute("aria-checked", "false");
  await expect(checkout(page)).toContainText("Trial ends on");
});

for (const width of [1280, 1150, 768, 380]) {
  test(`the portal of a customer on the free plan fills its rows, at ${width}px`, async ({
    page,
    standIn,
  }) => {
    await standIn.reset({ free: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/portal");
    await expect(portal(page).currentPlan).toBeVisible();
    await expect(page.getByText("No invoices yet.")).toBeVisible();

    const grid = await page.evaluate(() => {
      const root = document.querySelector('[data-slot="customer-portal"] > div') as HTMLElement;
      const box = root.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        cells: [...root.children]
          .filter((cell) => getComputedStyle(cell).display !== "none")
          .map((cell) => {
            const rect = cell.getBoundingClientRect();
            const card = cell.querySelector('[data-slot="card"]')!.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              cardHeight: card.height,
            };
          }),
      };
    });

    // The cards of a plan with nothing to add on: the plan, its features and meters, the payment
    // method, a voucher and the invoices. No add-ons card, and no empty cell where it would be.
    expect(grid.cells).toHaveLength(6);
    const rows = new Map<number, typeof grid.cells>();
    for (const cell of grid.cells) {
      const key = [...rows.keys()].find((top) => Math.abs(top - cell.top) < 1) ?? cell.top;
      rows.set(key, [...(rows.get(key) ?? []), cell]);
    }
    const ordered = [...rows.values()];
    for (const [index, row] of ordered.entries()) {
      const left = Math.min(...row.map((cell) => cell.left));
      const right = Math.max(...row.map((cell) => cell.right));
      // Edge to edge: a card alone in its row takes all of it.
      expect(Math.abs(left - grid.left)).toBeLessThan(1);
      expect(Math.abs(right - grid.right)).toBeLessThan(1);
      // As tall as the row, so a row ends in a straight line.
      for (const cell of row) {
        expect(Math.abs(cell.cardHeight - (cell.bottom - cell.top))).toBeLessThan(1);
      }
      // One gap between rows.
      const next = ordered[index + 1];
      if (next) {
        const gap = next[0]!.top - Math.max(...row.map((cell) => cell.bottom));
        expect(Math.abs(gap - 16)).toBeLessThan(1);
      }
    }
  });
}

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
