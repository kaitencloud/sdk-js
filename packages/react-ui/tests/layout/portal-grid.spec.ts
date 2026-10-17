// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from "@playwright/test";

/**
 * Layout invariant — the customer portal's sections sit on one grid, whatever it holds.
 *
 * The portal draws up to eight sections, and a customer's plan decides which of them have
 * anything to say: a plan with no entitlements has no included features, no usage meters and
 * no add-ons. A section that says nothing renders nothing, and the portal must leave no trace
 * of it. What this suite holds, at every width from a phone's to a wide desktop's, in
 * every state below:
 *
 * - one gap, 16px, between two cards of a row and between two rows;
 * - the cards of a row are as tall as their row, so a row never ends in a ragged edge;
 * - a row is filled edge to edge: a card that is alone in its row takes all of it, and there
 *   is no empty half beside it.
 *
 * Like the overflow suite, the box is the story's own, never the window's. The assertions are
 * integers, the same on a developer's machine and in CI.
 */

const WIDTHS = [320, 480, 768, 1150, 1280, 1440] as const;

const GAP = 16;

/** Layout is measured to the pixel, and Chromium lays out in 1/64ths. */
const TOLERANCE = 1;

const STORIES: Array<{ name: string; storyId: string; columns: boolean }> = [
  { name: "a session portal", storyId: "flows-customer-portal-session--full", columns: true },
  {
    name: "a plan with no entitlements",
    storyId: "flows-customer-portal-session--nothing-to-list",
    columns: true,
  },
  { name: "a licence portal", storyId: "flows-customerportal--full", columns: true },
  { name: "a licence portal, vertical", storyId: "flows-customerportal--vertical", columns: false },
  {
    name: "two sections of a licence portal",
    storyId: "flows-customerportal--entitlements-and-usage",
    columns: true,
  },
];

async function gotoStory(page: Page, storyId: string, width: number) {
  await page.goto(
    `/iframe.html?id=${storyId}&viewMode=story&globals=kaitenWidth:${width};backgrounds.value:transparent`,
    { waitUntil: "networkidle" },
  );
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important; animation-delay: 0s !important;
      transition-duration: 0s !important; transition-delay: 0s !important;
    }`,
  });
  await page.locator("[data-kaiten-harness]").waitFor({ state: "attached", timeout: 5000 });
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => {
    const preview = (
      window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } }
    ).__STORYBOOK_PREVIEW__;
    const phase = preview?.currentRender?.phase;
    return phase === "finished" || phase === "completed";
  });
}

interface Cell {
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** The card inside the cell, which is what the eye sees. */
  card: { top: number; bottom: number } | null;
}

/** The cells the portal draws, in order: an absent section has no box and is not among them. */
async function cells(page: Page): Promise<{ box: { left: number; right: number }; cells: Cell[] }> {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('[data-slot="customer-portal"] > div');
    if (!grid) throw new Error("the portal's grid is missing");
    const box = grid.getBoundingClientRect();
    const found = [...grid.children]
      .map((child) => {
        const rect = child.getBoundingClientRect();
        const card = child
          .querySelector<HTMLElement>('[data-slot="card"]')
          ?.getBoundingClientRect();
        return {
          name:
            child.querySelector("[data-slot]")?.getAttribute("data-slot") ??
            child.tagName.toLowerCase(),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          card: card ? { top: card.top, bottom: card.bottom } : null,
          shown: getComputedStyle(child).display !== "none",
        };
      })
      .filter((cell) => cell.shown)
      .map(({ shown: _shown, ...cell }) => cell);
    return { box: { left: box.left, right: box.right }, cells: found };
  });
}

/** Groups the cells into the rows they sit in: the ones that start at the same height. */
function rowsOf(all: Cell[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const cell of all) {
    const row = rows.find((each) => Math.abs(each[0]!.top - cell.top) <= TOLERANCE);
    if (row) row.push(cell);
    else rows.push([cell]);
  }
  return rows;
}

test.describe("Layout — the customer portal's grid", () => {
  for (const story of STORIES) {
    for (const width of WIDTHS) {
      test(`${story.name} @ ${width}px`, async ({ page }) => {
        await gotoStory(page, story.storyId, width);
        const { box, cells: drawn } = await cells(page);
        expect(drawn.length, "the portal drew nothing").toBeGreaterThan(1);

        const rows = rowsOf(drawn);

        for (const [index, row] of rows.entries()) {
          const where = `row ${index + 1} (${row.map((cell) => cell.name).join(", ")})`;

          // The row is filled edge to edge, with one gap between its cards.
          const ordered = [...row].sort((a, b) => a.left - b.left);
          expect(
            Math.abs(ordered[0]!.left - box.left),
            `${where} starts at the edge`,
          ).toBeLessThanOrEqual(TOLERANCE);
          expect(
            Math.abs(ordered.at(-1)!.right - box.right),
            `${where} ends at the edge: a hole to its right`,
          ).toBeLessThanOrEqual(TOLERANCE);
          for (let i = 1; i < ordered.length; i++) {
            expect(
              Math.abs(ordered[i]!.left - ordered[i - 1]!.right - GAP),
              `${where}: the gap between two cards is ${GAP}px`,
            ).toBeLessThanOrEqual(TOLERANCE);
          }

          // The cards of a row are as tall as the row.
          for (const cell of row) {
            if (!cell.card) continue;
            expect(
              Math.abs(cell.card.top - cell.top) + Math.abs(cell.card.bottom - cell.bottom),
              `${where}: ${cell.name} is shorter than its row`,
            ).toBeLessThanOrEqual(TOLERANCE);
          }
          const heights = new Set(row.map((cell) => Math.round(cell.bottom - cell.top)));
          expect(heights.size, `${where}: the cards of a row share a height`).toBe(1);

          // One gap between this row and the next.
          const next = rows[index + 1];
          if (next) {
            const bottom = Math.max(...row.map((cell) => cell.bottom));
            expect(
              Math.abs(next[0]!.top - bottom - GAP),
              `${where}: the gap to row ${index + 2} is ${GAP}px`,
            ).toBeLessThanOrEqual(TOLERANCE);
          }
        }

        // `two-column` has two columns where two fit; at a phone's width every row holds one.
        if (story.columns && width >= 768) {
          expect(
            rows.some((row) => row.length === 2),
            "two columns where two fit",
          ).toBe(true);
        }
        if (width <= 480 || !story.columns) {
          expect(
            rows.every((row) => row.length === 1),
            "one column where two do not fit",
          ).toBe(true);
        }
      });
    }
  }
});
