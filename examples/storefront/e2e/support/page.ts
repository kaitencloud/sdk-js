// What a test finds on the storefront's pages. The words are the ones of `@kaitencloud/react-ui`'s
// English pack: a test that reads one says what a customer reads.

import type { Locator, Page } from "@playwright/test";

/** The card of a plan in the pricing table. */
export function planCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="pricing-table"] [data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${name}$`) }),
  });
}

/** The checkout, whichever step it is at. */
export const checkout = (page: Page) => page.locator('[data-slot="checkout-flow"]');

/** A card of the customer portal, by its title. */
const section = (page: Page, title: string): Locator =>
  page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${title}$`) }),
  });

/** The customer portal's sections that a customer's subscription is read in. */
export const portal = (page: Page) => ({
  currentPlan: section(page, "Current plan"),
  invoices: section(page, "Invoices"),
});

/** Goes to the checkout of a plan and gives the billing email the customer has none of yet. */
export async function startCheckout(page: Page, plan: string, email = "billing@acme.test") {
  await page.goto("/");
  await planCard(page, plan).getByRole("button", { name: "Select plan" }).click();
  await page.getByLabel("Billing email").fill(email);
}

/**
 * Gives the billing email when the checkout asks for one. It asks a customer that has none, and a
 * customer that gave one before is not asked again: a Kaiten that has seen this customer already
 * does not show the field.
 */
export async function giveBillingEmail(page: Page, email = "billing@acme.test") {
  const field = page.getByLabel("Billing email");
  const answered = checkout(page).getByText(
    /Due today|can't be bought online|already have a subscription/,
  );
  await field.or(answered).first().waitFor();
  if (await field.isVisible()) await field.fill(email);
}
