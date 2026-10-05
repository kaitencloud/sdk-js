import { expect, test, type Page } from "@playwright/test";

import { STORIES } from "./stories.ts";

async function gotoStory(page: Page, storyId: string) {
  // `viewMode=story` opens the iframe without the Storybook chrome
  await page.goto(
    `/iframe.html?id=${storyId}&viewMode=story&globals=backgrounds.value:transparent`,
    {
      waitUntil: "networkidle",
    },
  );

  // Stop animations / transitions globally to keep screenshots deterministic.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      /* Hide the scrollbar gutter — its width differs across platforms. */
      html { scrollbar-gutter: stable; overflow-y: hidden !important; }
    `,
  });

  // Wait for the SDK shell to be present. Every story is wrapped by a
  // `.kaiten` div via `.storybook/preview.tsx`.
  await page.locator(".kaiten").first().waitFor({ state: "visible", timeout: 5000 });

  // Give SWR + React Suspense one tick to settle after the SDK shell mounts.
  await page.waitForLoadState("networkidle");
}

test.describe("Visual regression — Storybook stories", () => {
  for (const story of STORIES) {
    test(`${story.name} matches baseline`, async ({ page }) => {
      await gotoStory(page, story.storyId);
      await expect(page).toHaveScreenshot(`${story.name}.png`, {
        fullPage: true,
      });
    });
  }
});
