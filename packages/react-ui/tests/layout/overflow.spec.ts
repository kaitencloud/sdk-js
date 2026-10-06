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
  { name: "billing-summary", storyId: "flows-billingsummary--default" },
  { name: "checkout-summary", storyId: "flows-checkoutsummary--plan-and-addons" },
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
