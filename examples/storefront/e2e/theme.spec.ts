// The theme switcher: Light, Dark or System, on the page and on the Kaiten components, remembered
// between visits, with no flash of the other theme when the page loads.

import type { Page } from "@playwright/test";

import { expect, test } from "./support/stand-in.ts";

const html = (page: Page) => page.locator("html");
/** The scope root that every Kaiten component lives under. */
const kaitenRoot = (page: Page) => page.locator("div.kaiten").first();
const pageBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("the theme follows the system until the customer chooses, and is remembered", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
  await expect(page.locator('[data-slot="pricing-table"]')).toBeVisible();
  await expect(html(page)).not.toHaveClass(/dark/);
  const light = await pageBackground(page);

  // System follows the operating system while the page is open: the page and the components.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).toHaveClass(/dark/);
  await expect(kaitenRoot(page)).toHaveClass(/dark/);
  expect(await pageBackground(page)).not.toBe(light);

  // A choice holds against the system's.
  await page.getByRole("radio", { name: "Light" }).check();
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect(html(page)).not.toHaveClass(/dark/);
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(kaitenRoot(page)).not.toHaveClass(/dark/);
  expect(await pageBackground(page)).toBe(light);

  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(html(page)).toHaveClass(/dark/);
  await expect(kaitenRoot(page)).toHaveClass(/dark/);
  expect(await pageBackground(page)).not.toBe(light);

  // Remembered, and applied before the app runs: the page is dark as soon as the document is.
  await page.reload({ waitUntil: "commit" });
  await page.waitForLoadState("domcontentloaded");
  await expect(html(page)).toHaveClass(/dark/);
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(kaitenRoot(page)).toHaveClass(/dark/);

  // It holds on the other pages: the choice belongs to the storefront, not to a page.
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(html(page)).toHaveClass(/dark/);
  await expect(kaitenRoot(page)).toHaveClass(/dark/);
});

test("a page with storage that refuses to answer still has a theme", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(html(page)).toHaveClass(/dark/);

  await page.getByRole("radio", { name: "Light" }).check();
  await expect(html(page)).not.toHaveClass(/dark/);
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
});
