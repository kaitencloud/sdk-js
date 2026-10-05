import { expect, test, type Page } from "@playwright/test";

/**
 * Containment guard — a component must survive the layout its host puts it in.
 *
 * Container queries need `container-type: inline-size` on component roots, and that
 * property means "do not look at my contents to size me". A root whose width used to
 * come from its contents therefore stops having one. Measured in Chromium inside a
 * 600px host row, before any of this landed:
 *
 *   host layout    no container    container    container + w-full
 *   block flow         600px          600px           600px
 *   flex item           94px            0px           529px
 *   grid item          312px          265px           265px
 *
 * Zero, as a flex item — and a flex row is the ordinary way a host places a widget
 * next to its own chrome. That is the failure an integrator would hit first, and it
 * would look like the SDK rendering nothing at all.
 *
 * So the rule is: `@container/ktn` is always paired with `w-full`, unless the root
 * already sets a definite width of its own (`CheckoutSummary` does). This suite is
 * what makes the rule enforceable rather than merely written down in kaiten.css —
 * it renders the three host layouts and fails if a component stops filling one.
 *
 * It passes today, when no root declares a container yet. That is the point: it is a
 * ratchet placed BEFORE the change it guards, so the commit that adds a container
 * without `w-full` is the commit that turns it red.
 */

/** Below this a component is not merely narrow, it is broken. A collapse reads 0. */
const MIN_USABLE_WIDTH = 240;

const STORIES: Array<{ name: string; storyId: string }> = [
  { name: "block flow", storyId: "integration-host-layouts--block-flow" },
  { name: "flex row", storyId: "integration-host-layouts--flex-row" },
  { name: "grid track", storyId: "integration-host-layouts--grid-track" },
  { name: "status bar in flex row", storyId: "integration-host-layouts--status-bar-in-flex-row" },
  {
    name: "provider in host flex row",
    storyId: "integration-host-layouts--provider-in-host-flex-row",
  },
];

/**
 * The story where the PROVIDER is the flex item, not a wrapper around it — the shape a
 * real embed has, and the one the width check above cannot police on its own.
 */
const PROVIDER_AS_FLEX_ITEM = "integration-host-layouts--provider-in-host-flex-row";

/**
 * The share of the host's row that the SDK's scope root must occupy when it is the only
 * flexible item on it. Generous on purpose: the failure this guards is not "a bit
 * narrow", it is the scope root shrink-wrapping to roughly a third of the row.
 */
const MIN_SLOT_SHARE = 0.6;

const HARNESS_WIDTHS = [768, 1280] as const;

async function gotoStory(page: Page, storyId: string, width: number) {
  await page.goto(
    `/iframe.html?id=${storyId}&viewMode=story&globals=kaitenWidth:${width};backgrounds.value:transparent`,
    { waitUntil: "networkidle" },
  );
  await page.locator("[data-host-layout]").waitFor({ state: "attached", timeout: 5000 });
  await page.waitForLoadState("networkidle");
}

/**
 * The widest SDK root in the story, with the host chrome around it excluded.
 *
 * `[data-slot]` is the SDK's own marker and the host wrappers in these stories carry
 * `data-host-layout` instead, so the two never get confused — which matters, because
 * measuring the host's flex container instead of the component inside it would report
 * a healthy width for a component that had collapsed to nothing.
 */
async function measureSdkRoot(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("[data-host-layout]");
    if (!host) throw new Error("host layout wrapper missing from the story");

    // `kaiten-portal-host` is the provider's portal host for a host app's own portals: `absolute h-0 w-0` by
    // design, and a top-level `[data-slot]` whenever the provider itself sits inside the
    // host layout. It is infrastructure, not a component, and measuring it would report
    // a deliberate 0px as a collapse.
    const roots = [...host.querySelectorAll<HTMLElement>("[data-slot]")].filter(
      (el) =>
        el.getAttribute("data-slot") !== "kaiten-portal-host" &&
        !el.parentElement?.closest("[data-slot]"),
    );
    if (roots.length === 0) throw new Error("no SDK root rendered — did the story fail to mount?");

    return roots.map((el) => ({
      slot: el.getAttribute("data-slot") ?? "?",
      width: Math.round(el.getBoundingClientRect().width),
    }));
  });
}

/**
 * The provider's scope root must FILL the space its host gives it, never shrink-wrap
 * its own content.
 *
 * This is a separate assertion from the width floor above because the regression it
 * catches was not a narrow component — it was a correctly-sized component laid out
 * wrongly. Without `w-full` the `<div class="kaiten">` sized itself from its content,
 * so `repeat(auto-fit, …)` asked it for an available width nobody had decided and
 * settled on a single column: a 1280px page rendering a one-column pricing table, at a
 * scope root 512px wide instead of 1200px.
 *
 * A width floor would not have seen it. The share of the row is what encodes the rule.
 */
test.describe("Layout — the SDK fills its slot rather than shrink-wrapping", () => {
  for (const width of HARNESS_WIDTHS) {
    test(`provider as a flex item @ ${width}px`, async ({ page }) => {
      await gotoStory(page, PROVIDER_AS_FLEX_ITEM, width);

      const measured = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>("[data-host-layout]");
        if (!host) throw new Error("host layout wrapper missing from the story");
        const scopeRoot = host.querySelector<HTMLElement>(":scope > .kaiten");
        if (!scopeRoot) throw new Error("the provider's scope root is not the flex item");

        const sidebar = host.querySelector<HTMLElement>(":scope > aside");
        const gap = parseFloat(getComputedStyle(host).columnGap) || 0;
        const available =
          host.getBoundingClientRect().width -
          (sidebar ? sidebar.getBoundingClientRect().width + gap : 0);

        return {
          scopeRootWidth: Math.round(scopeRoot.getBoundingClientRect().width),
          available: Math.round(available),
        };
      });

      expect(
        measured.scopeRootWidth / measured.available,
        `the provider's scope root took ${measured.scopeRootWidth}px of the ${measured.available}px ` +
          `its host row offered. A scope root that shrink-wraps reports an undecided width to ` +
          `everything under it, and \`auto-fit\` grids answer that with one column. It needs ` +
          `\`w-full\` — see SCOPE_ROOT_CLASS in providers/kaiten-provider.tsx.`,
      ).toBeGreaterThanOrEqual(MIN_SLOT_SHARE);
    });
  }
});

test.describe("Layout — the SDK survives its host's layout", () => {
  for (const story of STORIES) {
    for (const width of HARNESS_WIDTHS) {
      test(`${story.name} @ ${width}px`, async ({ page }) => {
        await gotoStory(page, story.storyId, width);

        for (const root of await measureSdkRoot(page)) {
          expect(
            root.width,
            `[data-slot="${root.slot}"] rendered ${root.width}px wide in a ${story.name} ` +
              `host at ${width}px. A root that collapses like this has usually just gained ` +
              `\`@container/ktn\` without \`w-full\`: inline-size containment drops the ` +
              `contents from the width calculation, and a flex item with no other width ` +
              `left goes to 0. See the table at the top of this file.`,
          ).toBeGreaterThanOrEqual(MIN_USABLE_WIDTH);
        }
      });
    }
  }
});
