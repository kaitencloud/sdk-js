// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A visitor who is not a customer yet. Kaiten V1 has no anonymous checkout: the storefront's backend makes
// the customer and its instance when the visitor signs up, mints their session, and the checkout goes on
// where it was. The stand-in for Kaiten plays the sign-up scenario (`reset({ signUp: true })`), and the
// page, the backend and the SDK's components are the real ones.

import type { BrowserContext, Page } from "@playwright/test";

import { checkout, planCard } from "./support/page.ts";
import { expect, refusal, test, type StandIn } from "./support/stand-in.ts";

const PRO_PRICE = "00000000-0000-4000-8000-000000000201";
const STARTER_LICENCE = "00000000-0000-4000-8000-000000000001";
const COOKIE = "storefront_account";

const signUpHeading = (page: Page) => page.getByRole("heading", { name: /^Create your account/ });
const createAccount = (page: Page) => page.getByRole("button", { name: "Create account" });

/** The names of the calls the stand-in saw whose path starts with `prefix`. */
const callsTo = async (standIn: StandIn, method: string, path: string) =>
  (await standIn.calls()).filter((call) => call.method === method && call.path === path);

/** Types a name and an address into the sign-up step and submits it. */
async function fillAndSubmit(page: Page, name: string, email: string) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await createAccount(page).click();
}

/** The account cookie of the context, as the browser holds it. */
const accountCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((cookie) => cookie.name === COOKIE);

test("a visitor signs up from the pricing table, buys a plan, and is still signed in on return", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true });
  await page.goto("/");
  await expect(planCard(page, "Pro")).toBeVisible();

  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/pro-v2\\?price=${PRO_PRICE}$`));
  await expect(
    page.getByRole("heading", { name: "Create your account to subscribe to Pro" }),
  ).toBeVisible();

  // The pricing table is public: the catalogue was read with the publishable key alone, and no
  // session was minted for a visitor who has nobody to be.
  const before = await standIn.calls();
  expect(before.find((call) => call.path === "/public/catalog")?.credential).toBe("pk_");
  expect(
    before.filter(
      (call) => call.path === "/customer-sessions" || call.path.startsWith("/public/session/"),
    ),
  ).toEqual([]);

  // Nothing is asked of Kaiten for a form that is not right.
  await createAccount(page).click();
  await expect(page.getByText("Enter your name, or your company\u2019s.")).toBeVisible();
  await expect(page.getByText("Enter an e-mail address.")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  // Both fields say they are required, to a screen reader and in words: the form is checked on submit.
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-required", "true");
  await expect(page.getByLabel("E-mail")).toHaveAttribute("aria-required", "true");
  await expect(page.getByText("(required)")).toHaveCount(2);
  await expect(page.getByRole("alert").filter({ hasText: "Check the fields" })).toBeVisible();
  await page.getByLabel("Name").fill("Initech");
  await page.getByLabel("E-mail").fill("nope");
  await createAccount(page).click();
  await expect(page.getByText("Enter an address like name@company.com.")).toBeVisible();
  await expect(page.getByLabel("Name")).not.toHaveAttribute("aria-invalid", "true");
  expect(await callsTo(standIn, "POST", "/customers")).toEqual([]);

  await fillAndSubmit(page, "Initech", "billing@initech.test");

  // The checkout of the plan the visitor picked goes on, at the same address.
  await expect(page.getByRole("heading", { name: "Subscribe to Pro" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/checkout/pro-v2\\?price=${PRO_PRICE}$`));
  await expect(checkout(page)).toContainText("Due today");
  // The customer already has an address: the checkout does not ask for another.
  await expect(page.getByLabel("Billing email")).toHaveCount(0);

  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Subscribe" }).click();
  const provider = await opened;
  await provider.getByRole("button", { name: /Save card/ }).click();
  await provider.waitForEvent("close");
  await expect(checkout(page)).toContainText("You're subscribed");
  await expect(checkout(page)).toContainText("Payment received.");

  const state = await standIn.state();
  expect(state).toMatchObject({
    subscribed: true,
    plan: "pro-v2",
    billingEmail: "billing@initech.test",
    customers: [{ name: "Initech", billingEmail: "billing@initech.test" }],
  });
  const [customer] = state.customers;
  const [instance] = state.instances;
  expect(customer!.slug).toMatch(/^initech-[0-9a-f]{6}$/);
  expect(instance).toMatchObject({ customerSlug: customer!.slug, licenseSlug: "starter-v1" });

  // The backend made them with the server token, and no `Origin`: a browser never did. The instance
  // started on the free plan, and the checkout moved it.
  const calls = await standIn.calls();
  const customerCall = calls.find((call) => call.method === "POST" && call.path === "/customers")!;
  const instanceCall = calls.find((call) => call.method === "POST" && call.path === "/instances")!;
  for (const call of [customerCall, instanceCall]) {
    expect(call).toMatchObject({ credential: "ksh_", origin: null, status: 201 });
  }
  expect(customerCall.body).toMatchObject({
    name: "Initech",
    billingEmail: "billing@initech.test",
  });
  expect(instanceCall.body).toMatchObject({ licenseId: STARTER_LICENCE, slug: instance!.slug });
  const minted = calls.find((call) => call.path === "/customer-sessions")!;
  expect(minted.body).toMatchObject({ customerSlug: customer!.slug, instanceSlug: instance!.slug });
  // Every session was minted for the account the sign-up made, and for no other.
  for (const call of calls.filter((each) => each.path === "/customer-sessions")) {
    expect(call.body).toMatchObject({
      customerSlug: customer!.slug,
      instanceSlug: instance!.slug,
    });
  }

  // The browser holds the account, and a script on the page cannot read it.
  expect(await accountCookie(context)).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);

  // Back another day, in another tab: still Initech, still subscribed, and nothing was created again.
  const again = await context.newPage();
  await again.goto("/portal");
  await expect(again.getByTestId("signed-in-as")).toHaveText("Signed in as Initech");
  await expect(
    again.locator('[data-slot="card"]').filter({ hasText: "Current plan" }),
  ).toContainText("Pro");
  expect(await callsTo(standIn, "POST", "/customers")).toHaveLength(1);
  expect(await callsTo(standIn, "POST", "/instances")).toHaveLength(1);
});

test("signing out forgets the account: the next visitor is new, and the sessions are revoked", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true });
  // The Account entry leads to the same step as Select plan, without a plan to name.
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await fillAndSubmit(page, "Initech", "billing@initech.test");

  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await expect(page.getByTestId("signed-in-as")).toHaveText("Signed in as Initech");
  const first = (await standIn.state()).customers[0]!.slug;
  expect((await standIn.state()).minted).toBeGreaterThan(0);
  expect((await standIn.state()).revoked).toBe(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(planCard(page, "Pro")).toBeVisible();
  expect(await accountCookie(context)).toBeUndefined();
  expect((await standIn.state()).revoked).toBeGreaterThan(0);

  // A new visitor: the account page asks for an account again.
  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await fillAndSubmit(page, "Globex", "ap@globex.test");
  await expect(page.getByTestId("signed-in-as")).toHaveText("Signed in as Globex");

  const state = await standIn.state();
  expect(state.customers.map((each) => each.name)).toEqual(["Initech", "Globex"]);
  expect(state.customers[1]!.slug).not.toBe(first);
  // A customer who has never subscribed, on the free plan's licence.
  expect(state).toMatchObject({ subscribed: false, plan: "starter-v1" });
});

test("an account the stand-in no longer knows is a visitor again, and a cookie it did not sign is ignored", async ({
  page,
  context,
  standIn,
  baseURL,
}) => {
  await standIn.reset({ signUp: true });
  await page.goto("/portal");
  await fillAndSubmit(page, "Initech", "billing@initech.test");
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
  expect(await accountCookie(context)).toBeDefined();

  // Kaiten forgot the customer (a deleted one, here a stand-in that started over): the cookie is signed,
  // and Kaiten says there is nobody. The page shows a visitor, and the cookie is dropped.
  await standIn.reset({ signUp: true });
  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect.poll(() => accountCookie(context)).toBeUndefined();

  // A cookie that holds slugs but was not signed by this server is no account.
  const forged = `v1.${Buffer.from(JSON.stringify({ c: "initech-abcdef", i: "initech-abcdef" })).toString("base64url")}.${"A".repeat(43)}`;
  await context.addCookies([{ name: COOKIE, value: forged, url: baseURL! }]);
  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  expect((await standIn.calls()).filter((call) => call.path === "/customer-sessions")).toHaveLength(
    1,
  );
});

test("a copy of the cookie with anything added to its signature is ignored, and a whole one is not", async ({
  page,
  context,
  baseURL,
  standIn,
}) => {
  await standIn.reset({ signUp: true });
  await page.goto("/portal");
  await fillAndSubmit(page, "Initech", "billing@initech.test");
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
  const whole = (await accountCookie(context))!.value;
  const [version, payload, mac] = whole.split(".") as [string, string, string];

  // Junk that a base64 decoder skips decodes to the very same signature: the server must not accept it.
  for (const tampered of [
    `${version}.${payload}.${mac.slice(0, 10)}*${mac.slice(10)}`,
    `${version}.${payload}.${mac}!`,
  ]) {
    await context.clearCookies();
    await context.addCookies([{ name: COOKIE, value: tampered, url: baseURL! }]);
    await page.goto("/portal");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  }

  // The cookie as the server wrote it is the account.
  await context.clearCookies();
  await context.addCookies([{ name: COOKIE, value: whole, url: baseURL! }]);
  await page.goto("/portal");
  await expect(page.getByTestId("signed-in-as")).toHaveText("Signed in as Initech");
});

test("a signed-up visitor can sign out from any page, and the Account page keeps its own button", async ({
  page,
  context,
  standIn,
}) => {
  const pages = page.getByRole("navigation", { name: "Pages" });
  await standIn.reset({ signUp: true });
  await page.goto("/");
  // A visitor has nothing to sign out of.
  await expect(pages.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  await pages.getByRole("link", { name: "Account", exact: true }).click();
  await fillAndSubmit(page, "Initech", "billing@initech.test");
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
  // On Account, the button is beside the customer's name, and only there.
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(1);
  await expect(pages.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  await pages.getByRole("link", { name: "Pricing" }).click();
  await expect(planCard(page, "Pro")).toBeVisible();
  await pages.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(pages.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  expect(await accountCookie(context)).toBeUndefined();

  // A new visitor again: Select plan asks for an account.
  await planCard(page, "Pro").getByRole("button", { name: "Select plan" }).click();
  await expect(signUpHeading(page)).toBeVisible();
});

test("a refusal at sign-up is said in words a developer understands, and leaves nothing behind", async ({
  page,
  context,
  standIn,
}) => {
  await standIn.reset({ signUp: true });
  await page.goto("/portal");

  // The token can create customers and not instances: the customer made for this sign-up is deleted.
  await standIn.script(
    "POST /instances",
    refusal(403, "Auth.MissingScope", "missing required scope: write:instances"),
  );
  await fillAndSubmit(page, "Initech", "billing@initech.test");
  await expect(page.getByText(/Accounts can.t be created right now\./)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("write:instances");
  await expect(signUpHeading(page)).toBeVisible();

  const calls = await standIn.calls();
  const made = calls.find((call) => call.method === "POST" && call.path === "/customers")!;
  expect(made.status).toBe(201);
  const removed = calls.filter((call) => call.method === "DELETE");
  expect(removed).toHaveLength(1);
  expect(removed[0]).toMatchObject({ status: 204, credential: "ksh_" });
  expect(removed[0]!.path).toMatch(/^\/customers\/initech-[0-9a-f]{6}$/);
  expect(await standIn.state()).toMatchObject({ customers: [], instances: [] });
  expect(await accountCookie(context)).toBeUndefined();

  // The keyboard is on the message, not on a page that lost its button to the disabled state: a keyboard
  // user can read it and tab straight back to the form.
  await expect(page.locator(".signup-alert")).toBeFocused();

  // Kaiten is unavailable and asks to wait (the contract's 503 with Retry-After for the creation of a
  // customer): the visitor is told for how long.
  await standIn.script(
    "POST /customers",
    refusal(503, "CreateCustomer.ProviderUnavailable", "later", 5),
  );
  await createAccount(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Try again in 5 seconds");
  await expect(page.locator(".signup-alert")).toBeFocused();
  expect(await accountCookie(context)).toBeUndefined();

  // An address Kaiten does not accept is said at the field.
  await standIn.script(
    "POST /customers",
    refusal(422, "CreateCustomer.InvalidBillingEmail", "not an address"),
  );
  await createAccount(page).click();
  await expect(page.getByLabel("E-mail")).toHaveAttribute("aria-invalid", "true");

  // And the visitor can try again once it is fine: a slug that was taken is not their concern.
  await standIn.script("POST /customers", refusal(409, "CreateCustomer.SlugConflict", "taken"));
  await createAccount(page).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  expect(await callsTo(standIn, "POST", "/customers")).toHaveLength(5);
});

test("the sign-up step has the storefront's look in every theme and colour mode, down to 320 px", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ signUp: true });
  const picker = page.getByRole("combobox", { name: "Theme" });
  const modes = page.getByRole("group", { name: "Colour mode" });

  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const palette of ["kaiten", "claude", "neo-brutalism"]) {
      for (const mode of ["Light", "Dark"]) {
        const where = `${palette}, ${mode}, ${width}px`;
        await page.goto("/portal");
        await picker.selectOption(palette);
        await modes.getByRole("radio", { name: mode }).check();
        await createAccount(page).click();

        for (const label of ["Name", "E-mail"])
          await expect(page.getByLabel(label), where).toBeVisible();
        await expect(
          page.getByText("Enter your name, or your company\u2019s."),
          where,
        ).toBeVisible();
        await expect(page.getByText("Enter an e-mail address."), where).toBeVisible();
        await expect(createAccount(page), where).toBeVisible();

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, where).toBe(0);

        // What a person has to see: a field's edge against the card it sits on (3:1), and the error's
        // words against the same card (4.5:1).
        const colours = await page.evaluate(() => {
          // A computed colour is `rgb(r, g, b)`, or `color(srgb r g b)` with each channel from 0 to 1
          // when it was made by mixing.
          const read = (css: string): [number, number, number] => {
            const scale = css.startsWith("color(") ? 255 : 1;
            const [r, g, b] = (css.replace(/^color\(srgb/, "").match(/[\d.]+/g) ?? []).map(
              (channel) => Number(channel) * scale,
            );
            return [r!, g!, b!];
          };
          const luminance = ([r, g, b]: number[]) => {
            const [lr, lg, lb] = [r, g, b].map((value) => {
              const channel = value! / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
          };
          const ratio = (a: number[], b: number[]) => {
            const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
            return (hi! + 0.05) / (lo! + 0.05);
          };
          const input = document.querySelector<HTMLInputElement>("input[name=name]")!;
          const card = input.closest(".panel")!;
          const error = document.querySelector(".field-error")!;
          const cardColour = read(getComputedStyle(card).backgroundColor);
          return {
            border: ratio(read(getComputedStyle(input).borderTopColor), cardColour),
            error: ratio(read(getComputedStyle(error).color), cardColour),
            text: ratio(
              read(getComputedStyle(input).color),
              read(getComputedStyle(input).backgroundColor),
            ),
          };
        });
        expect(colours.border, `field border, ${where}`).toBeGreaterThanOrEqual(3);
        expect(colours.error, `error text, ${where}`).toBeGreaterThanOrEqual(4.5);
        expect(colours.text, `typed text, ${where}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

test("the storefront's one customer is untouched: no step, no sign out", async ({
  page,
  standIn,
}) => {
  await standIn.reset({ subscribed: true });
  const account = await page.request.get("/storefront-api/account");
  expect(await account.json()).toEqual({ accounts: "fixed", signedIn: true });

  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await expect(
    page.locator('[data-slot="card"]').filter({ hasText: "Current plan" }),
  ).toContainText("Pro");
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Create your account/ })).toHaveCount(0);

  // Signing up is not a route of a storefront that has one customer.
  const refused = await page.request.post("/storefront-api/signup", {
    data: { name: "Initech", email: "billing@initech.test" },
  });
  expect(refused.status()).toBe(404);
  expect(await callsTo(standIn, "POST", "/customers")).toEqual([]);
});

test("the journey page starts the stand-in as a visitor, and back as the customer it has by default", async ({
  page,
}) => {
  await page.goto("/journey");
  const scenario = page.getByRole("article", { name: "A visitor signs up and buys a plan" });
  await scenario.getByRole("button", { name: "Start as a visitor" }).click();
  await expect(scenario.getByRole("status")).toContainText("back to this starting point");

  // The page learnt, without a reload, that its visitor has no account.
  await scenario.getByRole("link", { name: "Open Pro's checkout" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your account to subscribe to Pro" }),
  ).toBeVisible();

  await page.goto("/journey");
  await page
    .getByRole("article", { name: "Buy a plan with a trial" })
    .getByRole("button", { name: "Start over" })
    .click();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Create your account/ })).toHaveCount(0);
});
