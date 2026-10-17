// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from "@playwright/test";

/**
 * Layout invariant — nothing the SDK renders may escape the box the host gives it.
 *
 * The SDK is embedded. A host drops `<PricingTable />` into whatever slot it has: a
 * marketing page's full bleed, a 720px settings column, a 320px drawer. The one number
 * the SDK does not control is the browser window — and that is precisely the number
 * every `sm:`/`md:`/`lg:` utility in the package currently reads, because those compile
 * to `@media (width >= …)`.
 *
 * The consequence is measurable in both directions. At a 1600px window, `PricingTable`
 * renders three columns in a 300px container (51px per plan card). At a narrow window
 * it renders one column in a 1230px container. Same markup, same stylesheet; the
 * layout tracks the window and ignores the slot.
 *
 * So this suite sizes the CONTAINER and never the viewport. `setViewportSize` would
 * reproduce the very bug it is meant to catch: it would make the media queries fire
 * "correctly" and hide the fact that they are keyed to the wrong number. The width is
 * pushed into the Storybook harness instead (`&globals=kaitenWidth:…`, see
 * `.storybook/preview.tsx`), which puts the story in a box of exactly N pixels with no
 * padding and no centring.
 *
 * The window therefore stays at the config's 1280×800 for every case below, and that
 * is the point rather than an oversight: wide window, narrow slot is the embed a host
 * actually produces, and the only condition under which a viewport breakpoint misfires.
 * Narrow window with a narrow slot — a phone — is the case that already works today,
 * because there the two numbers happen to agree. Do not "fix" this suite by resizing
 * the viewport alongside the container; that change makes every assertion below pass
 * for the wrong reason.
 *
 * Unlike the screenshot baselines next door, these assertions are integers, not
 * pixels: they do not drift with font rasterisation, so they mean the same thing on a
 * developer's macOS machine and on the Linux CI runner. Run them anywhere.
 */

const WIDTHS = [320, 480, 768, 1280] as const;

/**
 * One story per layout archetype, plus every component that carries a viewport
 * breakpoint today. Loading and skeleton states are deliberately absent — they measure
 * the placeholder, not the component.
 */
const STORIES: Array<{ name: string; storyId: string }> = [
  // Grid of cards — `md:grid-cols-2 xl:grid-cols-3`, the archetype where the column
  // count is decided by the window instead of by how wide a card needs to be.
  { name: "pricing-table", storyId: "elements-pricingtable--default" },
  { name: "pricing-table (4 plans)", storyId: "elements-pricingtable--four-columns" },
  // A "Contact us" link in place of a plan's button, beside a priceless plan.
  { name: "pricing-table (billing catalog)", storyId: "elements-pricingtable--billing-catalog" },
  // The catalogue Kaiten serves for Acme: eight plans, a price in dinars at three decimals
  // that is the widest a card carries, and a plan with no price at all.
  { name: "pricing-table (served catalog)", storyId: "elements-pricingtable--billing-v-3" },
  // The error a refused catalogue read leaves in the slot, with its retry.
  {
    name: "pricing-table (origin not allowed)",
    storyId: "elements-pricingtable--origin-not-allowed",
  },
  { name: "feature-catalog", storyId: "elements-featurecatalog--default" },
  // Wide table — switches to stacked cards at a viewport breakpoint (`ktn-only-*`).
  { name: "feature-comparison", storyId: "elements-featurecomparison--default" },
  // Row of meters — `flex` with no `flex-wrap` and `w-[100px]` children.
  { name: "entitlement-status-bar", storyId: "elements-entitlementstatusbar--default" },
  // Five quotas rather than two. How many meters the bar carries is the host's call,
  // and at two it fits everywhere — so without this fixture the suite reports a row
  // that cannot wrap as sound at 320px.
  { name: "entitlement-status-bar (crowded)", storyId: "elements-entitlementstatusbar--crowded" },
  // Composite surfaces — several sections under one root.
  { name: "customer-portal", storyId: "flows-customerportal--full" },
  { name: "customer-portal (vertical)", storyId: "flows-customerportal--vertical" },
  // The current plan of a customer session, whose quarterly price is the longest line it draws.
  {
    name: "current-plan (customer session, quarterly)",
    storyId: "flows-customerportal--current-plan-in-a-session-quarterly",
  },
  // The portal of a customer session: the controls of the plan, the add-ons and the panel that
  // changes them, the invoices with their links, a voucher check, and the sentences of a refusal.
  { name: "customer portal (session)", storyId: "flows-customer-portal-session--full" },
  // A plan with no entitlements: three of the portal's cells are empty, and its rows are filled by what remains.
  {
    name: "customer portal (session, nothing to list)",
    storyId: "flows-customer-portal-session--nothing-to-list",
  },
  {
    name: "customer portal (session, cancelling)",
    storyId: "flows-customer-portal-session--cancel-asked",
  },
  {
    name: "customer portal (session, past due)",
    storyId: "flows-customer-portal-session--past-due",
  },
  {
    name: "customer portal (session, limits)",
    storyId: "flows-customer-portal-session--provenance",
  },
  {
    name: "customer portal (session, add-ons)",
    storyId: "flows-customer-portal-session--add-ons-held",
  },
  {
    name: "customer portal (session, add-ons panel)",
    storyId: "flows-customer-portal-session--manage-add-ons",
  },
  {
    name: "customer portal (session, add-on refused)",
    storyId: "flows-customer-portal-session--manage-add-ons-refused",
  },
  {
    name: "customer portal (session, closing a period)",
    storyId: "flows-customer-portal-session--manage-add-ons-closing-period",
  },
  {
    name: "customer portal (session, invoices)",
    storyId: "flows-customer-portal-session--invoices",
  },
  {
    name: "customer portal (session, voucher)",
    storyId: "flows-customer-portal-session--voucher-rate-limited",
  },
  {
    name: "customer portal (session, French)",
    storyId: "flows-customer-portal-session--in-french",
  },
  { name: "billing-summary", storyId: "flows-billingsummary--default" },
  // What is due today: the server's lines and total, a trial, and what stands in their place.
  { name: "checkout-summary", storyId: "flows-checkoutsummary--plan-and-add-ons" },
  { name: "checkout-summary (voucher)", storyId: "flows-checkoutsummary--with-a-voucher" },
  { name: "checkout-summary (trial)", storyId: "flows-checkoutsummary--free-trial" },
  { name: "checkout-summary (refused)", storyId: "flows-checkoutsummary--over-quota" },
  // A checkout, in every state a customer meets: choosing, with a code, then paying and what
  // became of the payment. Each draws the widest line it can: the period choices, the stepper
  // rows, the voucher row and the provider's link.
  { name: "checkout-flow", storyId: "flows-checkoutflow--default" },
  {
    name: "checkout-flow (add-ons and voucher)",
    storyId: "flows-checkoutflow--add-ons-and-voucher",
  },
  { name: "checkout-flow (voucher refused)", storyId: "flows-checkoutflow--voucher-refused" },
  { name: "checkout-flow (trial)", storyId: "flows-checkoutflow--free-trial" },
  { name: "checkout-flow (billing email)", storyId: "flows-checkoutflow--billing-email-needed" },
  { name: "checkout-flow (processing)", storyId: "flows-checkoutflow--processing" },
  {
    name: "checkout-flow (saving a payment method)",
    storyId: "flows-checkoutflow--saving-a-payment-method",
  },
  { name: "checkout-flow (subscribed)", storyId: "flows-checkoutflow--subscribed" },
  { name: "checkout-flow (payment to confirm)", storyId: "flows-checkoutflow--payment-to-confirm" },
  { name: "checkout-flow (card declined)", storyId: "flows-checkoutflow--card-declined" },
  { name: "checkout-flow (already subscribed)", storyId: "flows-checkoutflow--already-subscribed" },
  { name: "checkout-flow (over quota)", storyId: "flows-checkoutflow--over-quota" },
  // How a customer session pays: its labels, a badge, the sentence under it and the actions that
  // wrap; and the summary and the walls that say where its subscription stands.
  { name: "payment-method-card", storyId: "flows-paymentmethodcard--default" },
  { name: "payment-method-card (expired)", storyId: "flows-paymentmethodcard--expired" },
  { name: "payment-method-card (none yet)", storyId: "flows-paymentmethodcard--no-payment-method" },
  {
    name: "payment-method-card (provider down)",
    storyId: "flows-paymentmethodcard--provider-down",
  },
  { name: "billing-summary (session)", storyId: "flows-billingsummary-session--running" },
  {
    name: "billing-summary (session, past due)",
    storyId: "flows-billingsummary-session--past-due-quarterly",
  },
  {
    name: "billing-summary (session, scheduled change)",
    storyId: "flows-billingsummary-session--scheduled-change",
  },
  { name: "billing-summary (session, unbound)", storyId: "flows-billingsummary-session--unbound" },
  { name: "paywall (session, past due)", storyId: "flows-paywall-session--past-due" },
  { name: "paywall (session, over)", storyId: "flows-paywall-session--over" },
  { name: "paywall (session, over, hard)", storyId: "flows-paywall-session--over-hard" },
  // The rest of the checkout and the portal: plain markup, French, dark, and the states that end a flow.
  { name: "checkout-flow (unstyled)", storyId: "flows-checkoutflow--unstyled" },
  { name: "checkout-flow (french)", storyId: "flows-checkoutflow--french" },
  { name: "checkout-flow (dark)", storyId: "flows-checkoutflow--dark" },
  { name: "checkout-summary (unstyled)", storyId: "flows-checkoutsummary--unstyled" },
  { name: "checkout-summary (french)", storyId: "flows-checkoutsummary--french" },
  { name: "checkout-summary (dark)", storyId: "flows-checkoutsummary--dark" },
  {
    name: "customer-portal-session (cancel-afterwards)",
    storyId: "flows-customer-portal-session--cancel-afterwards",
  },
  {
    name: "customer-portal-session (invoices-paged)",
    storyId: "flows-customer-portal-session--invoices-paged",
  },
  {
    name: "customer-portal-session (invoices-hidden)",
    storyId: "flows-customer-portal-session--invoices-hidden",
  },
  {
    name: "customer-portal-session (unstyled)",
    storyId: "flows-customer-portal-session--unstyled",
  },
  {
    name: "customer-portal-session (plan-card-alone)",
    storyId: "flows-customer-portal-session--plan-card-alone",
  },
  {
    name: "payment-method-card (sent-to-the-provider)",
    storyId: "flows-paymentmethodcard--sent-to-the-provider",
  },
  {
    name: "payment-method-card (not-available)",
    storyId: "flows-paymentmethodcard--not-available",
  },
  { name: "payment-method-card (unstyled)", storyId: "flows-paymentmethodcard--unstyled" },
  {
    name: "paywall-session (cancellation-scheduled)",
    storyId: "flows-paywall-session--cancellation-scheduled",
  },
  // Overlay — already container-queried, and the model the rest should follow.
  { name: "paywall (soft)", storyId: "flows-paywall--soft-near-limit" },
  { name: "paywall (hard)", storyId: "flows-paywall--hard-over-limit" },
];

/**
 * Overflow that exists today, in pixels, keyed `"<storyId>@<width>"`.
 *
 * Empty, and that is the finish line rather than a starting state: it held fourteen
 * entries when this suite was written, and every one of them has been measured back to
 * zero. Anything not listed here must not overflow at all, so with the map empty the
 * assertion is simply "nothing escapes its container, at any of the four widths".
 *
 * It remains a ratchet, not decoration. A new overflow fails on the commit that
 * introduces it. If one is ever recorded here again it may only be removed, never
 * raised — the assertion is equality, so a component that gets fixed fails until its
 * line is deleted, and a component that gets worse fails immediately.
 */
const KNOWN_OVERFLOW: Record<string, number> = {};

async function gotoStory(page: Page, storyId: string, width: number) {
  await page.goto(
    `/iframe.html?id=${storyId}&viewMode=story&globals=kaitenWidth:${width};backgrounds.value:transparent`,
    { waitUntil: "networkidle" },
  );

  // Transitions can be mid-flight when we measure; a width caught halfway through one
  // is not the width the component settles at.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important; animation-delay: 0s !important;
      transition-duration: 0s !important; transition-delay: 0s !important;
    }`,
  });

  await page.locator("[data-kaiten-harness]").waitFor({ state: "attached", timeout: 5000 });
  await page.waitForLoadState("networkidle");

  // A story that drives its component ends in its state when its `play` function has finished.
  await page.waitForFunction(() => {
    const preview = (
      window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } }
    ).__STORYBOOK_PREVIEW__;
    const phase = preview?.currentRender?.phase;
    return phase === "finished" || phase === "completed";
  });
}

/**
 * Measures the harness box and, when it overflows, names what is sticking out.
 *
 * The offenders are filtered to those with no overflowing element child: an ancestor
 * overflows *because* a descendant does, so listing the whole chain buries the culprit
 * under its parents. `data-slot` is preferred as the label because the SDK puts one on
 * every component root and section — it is the name a developer will grep for.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const harness = document.querySelector<HTMLElement>("[data-kaiten-harness]");
    if (!harness) throw new Error("harness missing — check the preview decorator");

    const overflow = harness.scrollWidth - harness.clientWidth;
    if (overflow <= 0) return { overflow: 0, offenders: [] as string[] };

    const limit = harness.getBoundingClientRect().right;
    const over = new Set<Element>();
    for (const el of harness.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      // Sub-pixel rounding makes exact comparison noisy; a real overflow is never 0.5px.
      if (box.width > 0 && box.right > limit + 1) over.add(el);
    }

    const describe = (el: Element) => {
      const slot = el.getAttribute("data-slot");
      const label = slot
        ? `[data-slot="${slot}"]`
        : el.tagName.toLowerCase() +
          (el.className && typeof el.className === "string"
            ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
            : "");
      return `${label} +${Math.round(el.getBoundingClientRect().right - limit)}px`;
    };

    const innermost = [...over].filter((el) => ![...el.children].some((c) => over.has(c)));
    return {
      overflow,
      offenders: innermost
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
        .slice(0, 5)
        .map(describe),
    };
  });
}

test.describe("Layout — the SDK stays inside its container", () => {
  for (const story of STORIES) {
    for (const width of WIDTHS) {
      test(`${story.name} @ ${width}px`, async ({ page }) => {
        await gotoStory(page, story.storyId, width);
        const { overflow, offenders } = await measure(page);

        const expected = KNOWN_OVERFLOW[`${story.storyId}@${width}`] ?? 0;
        const detail = offenders.length
          ? `\n  sticking out: ${offenders.join("\n                ")}`
          : "";

        expect(
          overflow,
          expected === 0
            ? `${story.name} overflows its ${width}px container by ${overflow}px.${detail}`
            : `${story.name} @ ${width}px is a recorded overflow of ${expected}px; ` +
                `measured ${overflow}px. If you fixed it, delete its line from ` +
                `KNOWN_OVERFLOW — that map only ever shrinks.${detail}`,
        ).toBe(expected);
      });
    }
  }
});
