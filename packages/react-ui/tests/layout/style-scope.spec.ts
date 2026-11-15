// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from "@playwright/test";

import { STORIES } from "../visual/stories.ts";

const EMPTY_STORY = `
  <div id="storybook-root">
    <div class="kaiten" style="--ktn-primary: red">
      <div data-slot="kaiten-portal-host" style="position: absolute; width: 0; height: 0"></div>
    </div>
  </div>
`;

test("style-scope probe accepts an empty component with a zero-size portal host", async ({
  page,
}) => {
  await page.setContent(EMPTY_STORY);
  await expectStyleScope(page);
});

test("style-scope probe rejects an unscoped component after a styled portal host", async ({
  page,
}) => {
  await page.setContent(EMPTY_STORY);
  await page.locator("#storybook-root").evaluate((root) => {
    const card = document.createElement("div");
    card.dataset.slot = "card";
    root.append(card);
  });
  await expect(expectStyleScope(page)).rejects.toThrow("a .kaiten ancestor for card");
});

test("style-scope probe rejects a style root without theme tokens", async ({ page }) => {
  await page.setContent(EMPTY_STORY);
  await page.locator(".kaiten").evaluate((root) => root.removeAttribute("style"));
  await expect(expectStyleScope(page)).rejects.toThrow("--ktn-primary resolves");
});

async function expectStyleScope(page: Page) {
  // Portal hosts are intentionally zero-sized. A component may render nothing,
  // so attachment, not visibility, is the readiness condition for this probe.
  await page.locator("#storybook-root [data-slot]").first().waitFor({
    state: "attached",
    timeout: 15_000,
  });

  const probe = await page.evaluate(() => ({
    elements: [...document.querySelectorAll<HTMLElement>("#storybook-root [data-slot]")].map(
      (element) => {
        const scope = element.closest<HTMLElement>(".kaiten");
        return {
          slot: element.dataset.slot,
          hasScope: Boolean(scope),
          primary: scope ? getComputedStyle(scope).getPropertyValue("--ktn-primary").trim() : "",
        };
      },
    ),
    portalHosts: document.querySelectorAll("[data-slot='kaiten-portal-host']").length,
  }));

  // Check every SDK element: a styled portal host must not mask an unstyled card.
  for (const element of probe.elements) {
    expect(element.hasScope, `a .kaiten ancestor for ${element.slot}`).toBe(true);
    expect(element.primary, `--ktn-primary resolves for ${element.slot}`).not.toBe("");
  }
  expect(probe.portalHosts, "a portal host").toBeGreaterThanOrEqual(1);
}

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
    // As in the visual suite, wait for play functions to finish before probing.
    await page.waitForFunction(() => {
      const preview = (
        window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } }
      ).__STORYBOOK_PREVIEW__;
      const phase = preview?.currentRender?.phase;
      return phase === "finished" || phase === "completed";
    });

    await expectStyleScope(page);
    expect(warnings.filter((warning) => warning.includes("KaitenStyleRoot"))).toEqual([]);
  });
}
