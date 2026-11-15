// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The storefront against a Kaiten of your own, with whatever payment provider it has. Skipped
// without the variables of the `live` project (see `playwright.config.ts`), so that it never runs
// by accident: it subscribes an instance.
//
// It takes the paths that need no card, so it runs against a Kaiten with no payment provider (the
// one that bills nothing, `NOOP`) as well as against one with Stripe: a free plan is bought alone,
// and a paid plan that no provider can charge says so. What needs a card saved on a provider's page,
// a declined card or a 3-D Secure challenge waits for a provider that can be driven without a
// person, which is what the stand-in plays in `checkout.spec.ts` and `failures.spec.ts`.
//
// The instance it subscribes must have no subscription, a new one for each run: a subscribed
// instance cannot be subscribed again.

import { expect, test, type APIRequestContext } from "@playwright/test";

import { checkout, giveBillingEmail, planCard, portal } from "./support/page.ts";

const live = !!process.env.STOREFRONT_LIVE_API_URL;

test.skip(
  !live,
  "needs a Kaiten: set STOREFRONT_LIVE_API_URL, STOREFRONT_LIVE_SERVER_TOKEN, STOREFRONT_LIVE_PUBLISHABLE_KEY, STOREFRONT_LIVE_CUSTOMER_SLUG and STOREFRONT_LIVE_INSTANCE_SLUG",
);
// Each test goes on from where the one before left the instance.
test.describe.configure({ mode: "serial" });

interface Plan {
  licenseSlug: string;
  name: string;
  pricingType: "FREE" | "PAID" | "CUSTOM";
  selfServe: boolean;
  prices: Array<{ id: string; billingModel: string; isDefault: boolean; billingPeriod?: string }>;
}

/** The plans the storefront's own catalogue read gets, as Kaiten serves them. */
async function plansOf(request: APIRequestContext): Promise<Plan[]> {
  const config = (await (await request.get("/storefront-api/config")).json()) as {
    mode: string;
    apiUrl: string;
    publishableKey: string;
  };
  expect(config.mode).toBe("live");
  const response = await request.get(`${config.apiUrl}/public/catalog`, {
    headers: { "X-Kaiten-Publishable-Key": config.publishableKey },
  });
  expect(response.status(), "the publishable key reads the catalogue").toBe(200);
  return ((await response.json()) as { plans: Plan[] }).plans;
}

const free = (plans: Plan[]) => plans.find((plan) => plan.pricingType === "FREE" && plan.selfServe);
/** A paid plan that cannot be bought alone: the provider has no way to charge a card. */
const paidWithoutCard = (plans: Plan[]) =>
  plans.find(
    (plan) =>
      plan.pricingType === "PAID" &&
      !plan.selfServe &&
      plan.prices.some((price) => price.billingModel === "FLAT_FEE" && price.isDefault),
  );

test("the pricing table sells the plans of the catalogue, and a free one can be bought", async ({
  page,
  request,
}) => {
  const plans = await plansOf(request);
  const plan = free(plans);
  test.skip(!plan, "the catalogue has no free plan that a customer can buy alone");

  await page.goto("/");
  await expect(page.getByTestId("double-notice")).toHaveCount(0);
  for (const each of plans) {
    await expect(planCard(page, each.name), `${each.name} is in the table`).toBeVisible();
  }
  // Only a plan that can be bought alone has a button to buy it with.
  await expect(page.getByRole("button", { name: "Select plan" })).toHaveCount(
    plans.filter((each) => each.selfServe).length,
  );
});

test("a paid plan that Kaiten has no provider to charge for cannot be bought, and says so", async ({
  page,
  request,
}) => {
  const plan = paidWithoutCard(await plansOf(request));
  test.skip(
    !plan,
    "every paid plan of the catalogue can be bought alone: the provider takes cards",
  );

  // The pricing table does not offer it. A customer who gets to its checkout is refused before
  // anything is priced.
  const price = plan!.prices.find((each) => each.billingModel === "FLAT_FEE" && each.isDefault)!;
  await page.goto(`/checkout/${plan!.licenseSlug}?price=${price.id}`);
  await giveBillingEmail(page);
  await expect(checkout(page)).toContainText("This plan can't be bought online.");
  await expect(page.getByRole("button", { name: "Subscribe" })).toBeDisabled();
});

test("a customer subscribes to a free plan, and finds it in the portal", async ({
  page,
  request,
}) => {
  const plan = free(await plansOf(request));
  test.skip(!plan, "the catalogue has no free plan that a customer can buy alone");

  // What the page sends to Kaiten, by credential: the catalogue with the publishable key, a
  // customer's own routes with their session, and never the vendor's token.
  const sent: Array<{ url: string; authorization: string; key: string }> = [];
  page.on("request", async (outgoing) => {
    if (!outgoing.url().includes("/public/")) return;
    const headers = await outgoing.allHeaders();
    sent.push({
      url: new URL(outgoing.url()).pathname,
      authorization: (headers["authorization"] ?? "").slice(0, "Bearer kst_".length),
      key: (headers["x-kaiten-publishable-key"] ?? "").slice(0, "pk_".length),
    });
  });

  await page.goto("/");
  await planCard(page, plan!.name).getByRole("button", { name: "Select plan" }).click();
  await giveBillingEmail(page);
  await expect(checkout(page)).toContainText("Due today");
  await page.getByRole("button", { name: "Subscribe" }).click();

  // Nothing is due for a free plan, and nothing is asked of a provider.
  await expect(checkout(page)).toContainText("You're subscribed");
  await expect(checkout(page)).toContainText("Nothing is due today.");

  await page.getByRole("link", { name: "Go to your account" }).click();
  await expect(portal(page).currentPlan).toContainText(plan!.name);
  // The invoice the subscription started with is listed, though nothing was due on it.
  await expect(portal(page).invoices).toContainText("Activation");
  await expect(portal(page).invoices).toContainText("Paid");

  for (const call of sent) {
    if (call.url.endsWith("/public/catalog")) expect(call, call.url).toMatchObject({ key: "pk_" });
    else expect(call, call.url).toMatchObject({ authorization: "Bearer kst_", key: "" });
  }
  expect(sent.some((call) => call.url.includes("/public/session/"))).toBe(true);
});

test("an instance that is subscribed already is sent to its portal instead of a second checkout", async ({
  page,
  request,
}) => {
  const plan = free(await plansOf(request));
  test.skip(!plan, "the catalogue has no free plan that a customer can buy alone");

  await page.goto(`/checkout/${plan!.licenseSlug}`);
  await giveBillingEmail(page);
  await expect(checkout(page)).toContainText("You already have a subscription.");

  await checkout(page).getByRole("link", { name: "Manage your subscription" }).click();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(portal(page).currentPlan).toContainText(plan!.name);
});

test("the customer cancels the subscription at the end of its period, and withdraws it", async ({
  page,
}) => {
  await page.goto("/portal");

  await page.getByRole("button", { name: "Cancel subscription" }).click();
  await page.getByRole("button", { name: "Cancel at period end" }).click();
  await expect(portal(page).currentPlan).toContainText("Ends on");

  await page.getByRole("button", { name: "Reactivate subscription" }).click();
  await expect(portal(page).currentPlan).not.toContainText("Ends on");
  await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeVisible();
});
