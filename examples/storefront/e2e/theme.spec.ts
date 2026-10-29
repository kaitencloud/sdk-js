// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The colour mode (Light, Dark or System) and the theme (Kaiten, Claude, Neo Brutalism), on the page
// and on the Kaiten components, remembered between visits, with no flash of the other look when the
// page loads. They are two choices: every theme has a Light and a Dark.

import type { Page } from "@playwright/test";

import { claude } from "../src/themes/claude.ts";
import { neoBrutalism } from "../src/themes/neo-brutalism.ts";
import type { ShadcnTheme, ShadcnToken } from "../src/themes/shadcn.ts";
import { expect, test } from "./support/stand-in.ts";

const html = (page: Page) => page.locator("html");
/** The scope root that every Kaiten component lives under. */
const kaitenRoot = (page: Page) => page.locator("div.kaiten").first();
const pageBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const picker = (page: Page) => page.getByRole("combobox", { name: "Theme" });
const modeGroup = (page: Page) => page.getByRole("group", { name: "Colour mode" });
/** A primary button of the components: the portal's "Change plan". */
const primaryButton = (page: Page) => page.getByRole("button", { name: "Change plan" });
/** A card of the components, the first the portal draws. */
const card = (page: Page) => page.locator('[data-slot="card"]').first();

/** `#b95c3d` as the browser reports a computed colour. */
function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/** What the page and the components should paint in a theme, from the theme's own tokens. */
function expected(theme: ShadcnTheme, mode: "light" | "dark") {
  const token = (name: ShadcnToken) => rgb(theme[mode][name]!);
  return {
    page: token("background"),
    primary: token("primary"),
    label: token("primary-foreground"),
    card: token("card"),
    border: token("border"),
  };
}

/** The look the storefront has always had, which the "Kaiten" theme must give back untouched. */
const KAITEN = {
  light: { page: rgb("#f6f6f9"), primary: rgb("#8f52ea") },
  dark: { page: rgb("#131417"), primary: rgb("#8f52ea") },
};

async function openPortal(
  page: Page,
  standIn: { reset: (o?: { subscribed?: boolean }) => Promise<void> },
) {
  await standIn.reset({ subscribed: true });
  await page.goto("/portal");
  await expect(primaryButton(page)).toBeVisible();
}

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

test("the theme is a second choice beside the colour mode, and Kaiten is the default", async ({
  page,
}) => {
  await page.goto("/");
  await expect(picker(page)).toHaveValue("kaiten");
  await expect(picker(page).getByRole("option")).toHaveText(["Kaiten", "Claude", "Neo Brutalism"]);
  await expect(html(page)).toHaveAttribute("data-palette", "kaiten");
  // Two controls, two names: the mode is no longer called "Theme".
  await expect(modeGroup(page).getByRole("radio")).toHaveCount(3);
  await expect(page.getByRole("group", { name: "Theme" })).toHaveCount(0);
});

test("Claude changes the components and the page, survives a reload, and gives its dark values in Dark", async ({
  page,
  standIn,
}) => {
  await openPortal(page, standIn);
  await expect(page.locator("body")).toHaveCSS("background-color", KAITEN.light.page);
  await expect(primaryButton(page)).toHaveCSS("background-color", KAITEN.light.primary);

  await picker(page).selectOption("claude");
  await expect(html(page)).toHaveAttribute("data-palette", "claude");
  const light = expected(claude, "light");
  await expect(page.locator("body")).toHaveCSS("background-color", light.page);
  await expect(primaryButton(page)).toHaveCSS("background-color", light.primary);
  await expect(primaryButton(page)).toHaveCSS("color", light.label);
  // The card's own surface is the theme's too: the components and the page change together.
  await expect(card(page)).toHaveCSS("background-color", light.card);

  // Remembered, and applied before the app runs: the page has the theme's background as soon as the
  // document is there, with no frame in the Kaiten look.
  await page.reload({ waitUntil: "commit" });
  await page.waitForLoadState("domcontentloaded");
  await expect(html(page)).toHaveAttribute("data-palette", "claude");
  await expect(page.locator("body")).toHaveCSS("background-color", light.page);
  await expect(picker(page)).toHaveValue("claude");
  await expect(primaryButton(page)).toHaveCSS("background-color", light.primary);

  // The colour mode is the other axis: Dark gives the theme's dark block, on the page and the components.
  await modeGroup(page).getByRole("radio", { name: "Dark" }).check();
  const dark = expected(claude, "dark");
  await expect(html(page)).toHaveAttribute("data-palette", "claude");
  await expect(page.locator("body")).toHaveCSS("background-color", dark.page);
  await expect(primaryButton(page)).toHaveCSS("background-color", dark.primary);
  await expect(primaryButton(page)).toHaveCSS("color", dark.label);
  await expect(card(page)).toHaveCSS("background-color", dark.card);
  expect(dark.page).not.toBe(light.page);

  // And so is System, which follows the operating system under any theme.
  await modeGroup(page).getByRole("radio", { name: "System" }).check();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", light.page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", dark.page);
  await expect(primaryButton(page)).toHaveCSS("background-color", dark.primary);
});

test("Neo Brutalism puts its offset shadow and its borders on the components", async ({
  page,
  standIn,
}) => {
  await openPortal(page, standIn);
  const kaitenShadow = await card(page).evaluate((element) => getComputedStyle(element).boxShadow);
  expect(kaitenShadow).not.toMatch(/4px 4px 0px 0px/);

  await picker(page).selectOption("neo-brutalism");
  const light = expected(neoBrutalism, "light");
  await expect(page.locator("body")).toHaveCSS("background-color", light.page);
  await expect(primaryButton(page)).toHaveCSS("background-color", light.primary);

  // The card: tweakcn's `shadow-sm` of the theme, a black block offset by 4px, and a 2px black edge.
  await expect(card(page)).toHaveCSS("box-shadow", /^rgb\(0, 0, 0\) 4px 4px 0px 0px/);
  await expect(card(page)).toHaveCSS("border-top-width", "2px");
  await expect(card(page)).toHaveCSS("border-top-color", light.border);
  // The button, which no slot of `appearance.elements` reaches: `shadow-xs` of the theme, half black.
  await expect(primaryButton(page)).toHaveCSS(
    "box-shadow",
    /^rgba\(0, 0, 0, 0\.5\) 4px 4px 0px 0px/,
  );
  await expect(primaryButton(page)).toHaveCSS("border-top-width", "2px");
  await expect(primaryButton(page)).toHaveCSS("border-top-left-radius", "0px");
  // The page's own panels follow: the stand-in's journey page is made of them.
  await page.goto("/journey");
  await expect(page.locator(".panel").first()).toHaveCSS(
    "box-shadow",
    /^rgba?\(0, 0, 0(, 1)?\) 4px 4px 0px 0px/,
  );
  await expect(page.locator(".panel").first()).toHaveCSS("border-top-width", "2px");

  // Dark, with the theme's own dark colours: white edges, and the red of its dark block.
  await modeGroup(page).getByRole("radio", { name: "Dark" }).check();
  const dark = expected(neoBrutalism, "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", dark.page);
  await expect(page.locator(".panel").first()).toHaveCSS("border-top-color", dark.border);
});

test("going back to Kaiten gives today's look again, whatever the colour mode", async ({
  page,
  standIn,
}) => {
  await openPortal(page, standIn);
  const kaitenShadow = await card(page).evaluate((element) => getComputedStyle(element).boxShadow);

  for (const palette of ["claude", "neo-brutalism"]) {
    await picker(page).selectOption(palette);
    await expect(html(page)).toHaveAttribute("data-palette", palette);
    await picker(page).selectOption("kaiten");
    await expect(html(page)).toHaveAttribute("data-palette", "kaiten");
    await expect(page.locator("body")).toHaveCSS("background-color", KAITEN.light.page);
    await expect(primaryButton(page)).toHaveCSS("background-color", KAITEN.light.primary);
    await expect(primaryButton(page)).toHaveCSS("box-shadow", "none");
    await expect(primaryButton(page)).toHaveCSS("border-top-width", "0px");
    await expect(card(page)).toHaveCSS("border-top-width", "1px");
    await expect(card(page)).toHaveCSS("box-shadow", kaitenShadow);
  }

  await modeGroup(page).getByRole("radio", { name: "Dark" }).check();
  await picker(page).selectOption("claude");
  await picker(page).selectOption("kaiten");
  await expect(page.locator("body")).toHaveCSS("background-color", KAITEN.dark.page);
  await expect(primaryButton(page)).toHaveCSS("background-color", KAITEN.dark.primary);

  // Kaiten is what is remembered: a reload does not bring a theme back.
  await page.reload();
  await expect(picker(page)).toHaveValue("kaiten");
});

test("no theme makes the page scroll sideways on a phone", async ({ page, standIn }) => {
  await standIn.reset({ subscribed: true });
  for (const width of [380, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const palette of ["kaiten", "claude", "neo-brutalism"]) {
      await page.goto("/");
      await picker(page).selectOption(palette);
      for (const path of ["/", "/portal", "/journey"]) {
        await page.goto(path);
        await expect(picker(page)).toHaveValue(palette);
        await expect(page.locator("main h1").first()).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${palette} at ${width}px on ${path}`).toBe(0);
        // The two controls of the header are whole: neither cut nor off the screen.
        const box = await page.locator(".site-controls").boundingBox();
        expect(box!.x + box!.width, `${palette} at ${width}px`).toBeLessThanOrEqual(width);
      }
    }
  }
});

test("a theme that is not known, or storage that refuses, gives the Kaiten look", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("storefront-palette", "not-a-theme"));
  await page.goto("/");
  await expect(html(page)).toHaveAttribute("data-palette", "kaiten");
  await expect(picker(page)).toHaveValue("kaiten");
});

test("with storage that refuses to answer, a theme can still be picked for the visit", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await expect(html(page)).toHaveAttribute("data-palette", "kaiten");
  await picker(page).selectOption("neo-brutalism");
  await expect(html(page)).toHaveAttribute("data-palette", "neo-brutalism");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    expected(neoBrutalism, "light").page,
  );
});
