import { expect, test } from "@playwright/test";

import { STORIES } from "../visual/stories.ts";

/**
 * Every snapshotted story renders inside a style root.
 *
 * The one failure mode the split introduced, and the one nothing else catches:
 * `KaitenProvider` no longer renders the `.kaiten` element, so a story (or a
 * host) that mounts a styled component without a `KaitenStyleRoot` above it
 * renders with every scoped rule missing. Nothing throws. The unit suite passes,
 * the layout suite passes — a component with no styling rarely overflows — and
 * the only signal is a visual diff on Linux, days later, in CI.
 *
 * So this asserts the cause rather than the symptom: a `.kaiten` ancestor, the
 * tokens actually resolving on it, a portal host, and no development warning.
 * It reads the visual suite's own allowlist (`tests/visual/stories.ts`, a plain
 * module rather than the spec — importing a spec file registers its tests in the
 * importing project) so the two lists cannot drift, and it lives in the `layout`
 * project because it needs no baseline and runs the same on any platform.
 */
for (const { storyId } of STORIES) {
  test(`${storyId} renders inside a Kaiten style root`, async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });

    await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
    await page.waitForSelector("#storybook-root [data-slot]", { timeout: 15_000 });

    const probe = await page.evaluate(() => {
      const element = document.querySelector("#storybook-root [data-slot]") as HTMLElement;
      const scope = element.closest(".kaiten") as HTMLElement | null;
      return {
        hasScope: Boolean(scope),
        // Written by the theme's scoped token block; an out-of-scope render
        // resolves it to the empty string.
        primary: scope ? getComputedStyle(scope).getPropertyValue("--ktn-primary").trim() : "",
        portalHosts: document.querySelectorAll("[data-slot='kaiten-portal-host']").length,
      };
    });

    expect(probe.hasScope, "a .kaiten ancestor").toBe(true);
    expect(probe.primary, "--ktn-primary resolves").not.toBe("");
    expect(probe.portalHosts, "a portal host").toBeGreaterThanOrEqual(1);
    expect(warnings.filter((warning) => warning.includes("KaitenStyleRoot"))).toEqual([]);
  });
}
