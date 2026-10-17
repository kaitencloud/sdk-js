// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ThemePlayground } from "../../../.storybook/theme-playground/editor.tsx";

/**
 * A live editor over `appearance.variables`, in the spirit of tweakcn: change a token,
 * watch real components react in light and dark at once, copy a config you can commit.
 *
 * The editor lives in `.storybook/theme-playground/` rather than beside this file. It is
 * Storybook-only tooling, and `src/styles/kaiten.css` scans `src/**` for the utilities it
 * emits into the published stylesheet — keeping the editor out of that tree keeps its
 * chrome out of the CSS customers download.
 *
 * Two boundaries are worth knowing before trusting the output:
 *
 * - Only `variables` are editable. `elements` takes class names that must exist in the
 *   *host's* CSS build, which a generator cannot know, so anything emitted there would
 *   be a string that silently does nothing.
 * - `appearance.variables` beats the host's own CSS inside `.kaiten` — layered or not,
 *   in either import order. The one arrangement it gives way to is a host that imports
 *   the stylesheet into a cascade layer of its own (`@import … layer(kaiten)`), which
 *   is the documented way to override Kaiten wholesale. All three are pinned by
 *   `Integration/Appearance precedence`.
 */
const meta: Meta<typeof ThemePlayground> = {
  title: "Appearance/Theme playground",
  component: ThemePlayground,
  parameters: {
    layout: "fullscreen",
    // Escapes the shared `max-w-7xl` column: this is a tool, and the preview panels want
    // every pixel the screen has (see the decorator in `.storybook/preview.tsx`).
    kaitenCanvas: "wide",
    docs: {
      description: {
        component:
          "Live editor over `appearance.variables` with a light/dark preview of real components and a copyable, diff-only config.",
      },
    },
  },
  /**
   * Pinned light, because the panels render light and dark themselves.
   *
   * The dark token block is `.kaiten.dark, .dark .kaiten`, so a `.dark` on `<html>` from
   * the toolbar would reach into the light panel through the descendant branch and both
   * panels would render dark.
   */
  globals: { theme: "light" },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/**
 * The property that makes the export safe to paste: an untouched editor produces an
 * empty config, not a snapshot of every default.
 */
export const EmitsOnlyWhatChanged: Story = {
  name: "Emits only what changed",
  parameters: {
    // Asserting the generated source, not the rendered surface; the preview panels are
    // audited by the component stories that own them.
    a11y: { test: "off" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const code = canvasElement.querySelector('[data-ktnpg="config"]')!;
    await expect(code.textContent).toContain("Nothing overridden yet");

    // Typing rather than setting the swatch: the text field is the path that also
    // accepts values a colour input cannot express (`oklch(…)`, a `var()` reference).
    await userEvent.type(canvas.getByLabelText("Primary"), "#0f766e");

    await waitFor(() => expect(code.textContent).toContain('colorPrimary: "#0f766e"'));

    const source = code.textContent!;
    await expect(source).toContain("KaitenAppearance");
    // The pair keys stay out — they are derived from the fill, and freezing today's
    // derivation into a host's source is how a theme stops tracking its own brand colour.
    await expect(source).not.toContain("colorPrimaryForeground:");
    await expect(source).not.toContain("colorPrimaryHover:");
    await expect(source).toContain("colorPrimaryForeground is derived from colorPrimary");
    // Nothing else leaked in.
    await expect(source).not.toContain("colorMuted");
    await expect(source).not.toContain("borderRadius");
  },
};

/**
 * Card content must take its colour from the card, not from the page.
 *
 * This is the failure the playground caught first, and it was invisible until then:
 * components re-pinned `text-foreground` on elements already inside a `Card`, which
 * carries `text-card-foreground`. Both tokens hold the same value in every shipped
 * theme, so the two agreed right up until someone overrode one of them.
 *
 * The original bug arrived through a preset: they carried surfaces then, and one that
 * moved `colorForeground` without `colorCard` left `--ktn-foreground` at `#0f172a` on a
 * dark card — 1.06:1 against today's `#111019`, which rendered the pricing table's price
 * all but invisible. Presets are mode-free palettes now and carry no surfaces, so none
 * of them can still produce it; the story types the foreground directly instead (see
 * the play function). Asserted against the dark panel because the light panel cannot
 * see it: there the page and card foregrounds still agree.
 */
export const CardContentFollowsTheCard: Story = {
  name: "Card content follows the card, not the page",
  parameters: { a11y: { test: "off" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Type the page foreground rather than reaching for a preset: presets are
    // palettes now and carry no surfaces, so none of them can produce the
    // divergence this story needs. Moving `colorForeground` alone is exactly
    // the shape of the original bug — `colorCard` is untouched, so the card
    // keeps the dark theme's own pair while the page text moves.
    await userEvent.clear(canvas.getByLabelText("Foreground"));
    await userEvent.type(canvas.getByLabelText("Foreground"), "#0f172a");

    // Ask for dark explicitly: below the two-column width the other panel is
    // `display: none`, and a regression should be caught on the pixels a user
    // is actually looking at.
    await userEvent.click(canvas.getByRole("radio", { name: "dark" }));

    const dark = await waitFor(async () => {
      const root = canvasElement.querySelector<HTMLElement>(".ktnpg-panel-body > .kaiten.dark")!;
      await expect(getComputedStyle(root).getPropertyValue("--ktn-foreground").trim()).toBe(
        "#0f172a",
      );
      return root;
    });

    const styleOf = (element: Element) => getComputedStyle(element);
    const tokens = styleOf(dark);
    const pageForeground = tokens.getPropertyValue("--ktn-foreground").trim();
    const cardForeground = tokens.getPropertyValue("--ktn-card-foreground").trim();

    // We moved one and not the other; if both had moved there would be nothing
    // to tell apart and this story would pass without proving anything.
    await expect(cardForeground).not.toBe(pageForeground);

    // `#0f172a`, the page foreground we set. Nothing drawn on a card may use it.
    const pageForegroundRgb = "rgb(15, 23, 42)";

    // Assert the invariant over every card in the panel rather than one known element:
    // the same mistake sat in the pricing table, the comparison table and four portal
    // sections, so pinning it to a single price would let the others drift back. It also
    // keeps the story independent of the runner's locale, which decides how a price reads.
    const offenders = () =>
      // `:scope` matters: without it the ancestor `[data-slot='card']` is matched against
      // the whole document, and the panel frame is itself a `Card` — so every element in
      // the preview would count as card content and the assertion would mean nothing.
      [...dark.querySelectorAll<HTMLElement>(":scope [data-slot='card'] *")]
        .filter((element) => element.children.length === 0 && element.textContent?.trim())
        .filter((element) => styleOf(element).color === pageForegroundRgb)
        .map((element) => `${element.textContent?.trim().slice(0, 24)} [${element.className}]`);

    await waitFor(async () => {
      // Cards arrive with their data, so wait for real content before judging it.
      await expect(dark.querySelectorAll(":scope [data-slot='card']").length).toBeGreaterThan(0);
      await expect(offenders()).toEqual([]);
    });

    // And it is on screen, not merely in the DOM — otherwise the switch could hide the
    // panel this story exists to inspect and it would still pass.
    await expect(dark.closest<HTMLElement>(".ktnpg-panel")!.offsetParent).not.toBeNull();
  },
};
