// Ambient `*.css` typing for the side-effect import below. Under `moduleResolution: nodenext`
// a program-level ambient wildcard does not match a relative specifier, so a file-local
// reference is required here.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./global.d.ts" />

import type { Preview } from "@storybook/react-vite";
import { withThemeByClassName } from "@storybook/addon-themes";

import "../src/styles/kaiten.css";

/**
 * Container widths offered in the toolbar and driven by the layout tests.
 *
 * These are the width of the BOX THE HOST GIVES THE SDK, not the viewport. The SDK is
 * embedded: a `PricingTable` can sit full-bleed on a marketing page while a `Paywall`
 * sits in a 320px drawer on the same screen, under the same provider. Sizing the
 * browser window — what `@media` queries and Playwright's `setViewportSize` both do —
 * measures the one number the SDK does not control and cannot see.
 */
const CONTAINER_WIDTHS = ["auto", "320", "480", "768", "1280"] as const;

const preview: Preview = {
  globalTypes: {
    kaitenWidth: {
      description: "Width of the box the host gives the SDK",
      toolbar: {
        title: "Container",
        icon: "grow",
        items: CONTAINER_WIDTHS.map((value) => ({
          value,
          title: value === "auto" ? "Auto" : `${value}px`,
        })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    kaitenWidth: "auto",
  },
  parameters: {
    layout: "fullscreen",
    /**
     * Accessibility gating for `vp test --project storybook` (and CI):
     * - `test: "error"` makes axe-core violations fail the test run.
     * - `config.runOnly` pins us to WCAG 2.0/2.1 levels A and AA.
     *
     * Override per-story with `parameters: { a11y: { test: "off" | "todo" } }`
     * if a deliberate violation is being demonstrated.
     */
    a11y: {
      test: "error",
      config: {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
      },
    },
    backgrounds: {
      disabled: true,
    },
  },
  decorators: [
    withThemeByClassName({
      themes: {
        light: "light",
        dark: "dark",
      },
      defaultTheme: "light",
      parentSelector: "html",
    }),
    (Story, context) => {
      /**
       * Component stories are centred in a `max-w-7xl` column, which is the right frame
       * for looking at one component. A tool is not a component: the theme playground
       * puts an editor beside two live previews, and that cap held it to 1280px however
       * wide the screen was — the pricing cards it exists to show were the ones squeezed.
       * Opt out with `parameters: { kaitenCanvas: "wide" }`.
       */
      const wide = context.parameters.kaitenCanvas === "wide";

      /**
       * The container harness. When a width is picked (toolbar, or `&globals=
       * kaitenWidth:320` from the layout tests) the story is put in a box of exactly
       * that many pixels and nothing else: no padding, no centring, no max-width. The
       * box has to be the only constraint on the story, because the layout suite
       * asserts that nothing inside it overflows — a padded or centred wrapper would
       * either mask an overflow or invent one.
       */
      const harnessWidth = Number(context.globals.kaitenWidth);

      if (Number.isFinite(harnessWidth) && harnessWidth > 0) {
        return (
          <div className="kaiten min-h-screen bg-background text-foreground">
            <div data-kaiten-harness={harnessWidth} style={{ width: `${harnessWidth}px` }}>
              <Story />
            </div>
          </div>
        );
      }

      return (
        <div className="kaiten min-h-screen bg-background text-foreground">
          <div
            className={
              wide
                ? "w-full p-4"
                : "mx-auto flex min-h-screen w-full max-w-7xl items-start justify-center p-6 md:p-10"
            }
          >
            <Story />
          </div>
        </div>
      );
    },
  ],
};

export default preview;
