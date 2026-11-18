// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The licence a customer holds and what it has used: the page the nav calls License, which draws
// `LicenseUsage` from the same customer session as the account page, against the stand-in for
// Kaiten. The page, the storefront's backend and the SDK's components are real, and only Kaiten is played.

import type { Page } from "@playwright/test";

import { licenseUsage } from "./support/page.ts";
import { expect, test } from "./support/stand-in.ts";

/** What a scenario of the journey page says after the button of that name was pressed. */
const scenario = (page: Page, title: string) => page.getByRole("article", { name: title });

test('a licence of capped and unlimited quotas: bars for the first, what is used out of "Unlimited" for the others', async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true, unlimitedQuotas: true });
  await page.goto("/license");
  const { block, quota } = licenseUsage(page);

  await expect(page).toHaveTitle("License usage \u00b7 Acme");
  await expect(page.getByRole("heading", { level: 1, name: "License usage" })).toBeVisible();
  // The block is the plan the customer's portal names.
  await expect(block.getByRole("heading", { level: 2, name: "Pro" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pro" })).toBeVisible();

  // Pro's own quotas are capped, and their bars follow the usage rule: 15,000 of 100,000 API calls
  // on a track that runs to the 120,000 its 20% allowance lets through.
  const calls = block.getByRole("progressbar", { name: "API calls: 15,000 / 100,000" });
  await expect(calls).toHaveAttribute("data-usage-state", "healthy");
  await expect(calls).toHaveAttribute("aria-valuemax", "120000");
  await expect(quota("API calls")).toContainText("15%");
  await expect(block.getByRole("progressbar", { name: "Seats: 2 / 5" })).toBeVisible();

  // The ones nothing caps say what is used and that nothing caps it: no ratio, no percentage, no bar.
  for (const [name, used] of [
    ["Workspaces", "12"],
    ["Webhooks", "4"],
    ["Environments", "3"],
  ] as const) {
    const row = quota(name);
    await expect(row.getByText(`${used} / Unlimited`, { exact: true }), name).toBeVisible();
    await expect(row.getByRole("progressbar"), name).toHaveCount(0);
    await expect(row, name).not.toContainText("%");
  }
  await expect(block.getByRole("progressbar")).toHaveCount(2);

  // A feature is not a quantity: single sign-on is the included features' to list, not this block's.
  await expect(block).not.toContainText("Single sign-on");
  await expect(page.getByText("No metered quota")).toHaveCount(0);
});

test('a plan of capped quotas alone never says "Unlimited"', async ({ page, standIn }) => {
  await standIn.reset({ subscribed: true });
  await page.goto("/license");
  const { block } = licenseUsage(page);

  await expect(block.getByRole("heading", { level: 2, name: "Pro" })).toBeVisible();
  await expect(block.getByRole("progressbar")).toHaveCount(2);
  await expect(block).not.toContainText("Unlimited");
});

test("a plan that grants a quantity of nothing says there is none to measure", async ({
  page,
  standIn,
}) => {
  // A customer with no subscription holds the instance's licence, which the catalogue lists no quota of.
  await standIn.reset({ email: true });
  await page.goto("/license");

  await expect(page.locator('[data-slot="license-usage-empty"]')).toHaveText(
    "No metered quota on this plan.",
  );
});

test("the nav leads to it, and the account page's own meters stay where they were", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true, unlimitedQuotas: true });
  await page.goto("/");
  const pages = page.getByRole("navigation", { name: "Pages" });
  await pages.getByRole("link", { name: "License" }).click();

  await expect(page).toHaveURL(/\/license$/);
  await expect(pages.getByRole("link", { name: "License" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The page is shown from its title, as every page of the storefront is.
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  // The account page's "Usage meters" lists the capped quotas only: it has no meter for what nothing caps.
  await pages.getByRole("link", { name: "Account" }).click();
  await expect(page.getByText("Usage meters")).toBeVisible();
  await expect(page.locator('[data-slot="license-usage"]')).toHaveCount(0);
});

test("a presenter reaches it from the journey page, with quotas nothing caps", async ({
  page,
  standIn,
}) => {
  await page.goto("/journey");
  const scene = scenario(page, "Follow what a licence has used");
  await scene.getByRole("button", { name: "Start over" }).click();
  await expect(scene.getByRole("status")).toBeVisible();

  await scene.getByRole("link", { name: "Open the license usage" }).click();
  await expect(page).toHaveURL(/\/license$/);
  await expect(
    licenseUsage(page).quota("Workspaces").getByText("12 / Unlimited", { exact: true }),
  ).toBeVisible();
  expect(await standIn.state()).toMatchObject({ plan: "pro-v2", status: "ACTIVE" });
});

test("a visitor with no account is asked to make one, as on the account page", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true });
  await page.goto("/license");

  await expect(page.getByRole("heading", { level: 1, name: /account/i })).toBeVisible();
  await expect(page.locator('[data-slot="license-usage"]')).toHaveCount(0);
});

for (const width of [1280, 768, 380, 320]) {
  test(`the block fits its screen, at ${width}px`, async ({ page, standIn }) => {
    await standIn.reset({ subscribed: true, unlimitedQuotas: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/license");
    const { block, quota } = licenseUsage(page);
    await expect(quota("Workspaces")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `the page at ${width}px`).toBe(0);
    // Nothing of the block is drawn outside it: a long name or a figure stays in its row.
    const outside = await block.evaluate((root) => {
      const box = root.getBoundingClientRect();
      return [...root.querySelectorAll("*")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.left < box.left - 1 || rect.right > box.right + 1);
        })
        .map((element) => element.tagName.toLowerCase());
    });
    expect(outside, `the block at ${width}px`).toEqual([]);
  });
}
