// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import {
  distCss,
  EXPECTED,
  HOST_TAILWIND_V4,
  HOST_UNLAYERED,
  PrecedenceHarness,
} from "../../../.storybook/appearance-precedence.tsx";

/**
 * What survives when the SDK lands in a host that runs its own Tailwind build.
 *
 * The harness lives in `.storybook/` because `src/**` is scanned for the utilities that
 * go into the published stylesheet; see the note at the top of that file. It renders
 * `dist/kaiten.css` — the file customers install — inside an isolated iframe together
 * with a conflicting host stylesheet.
 */
const meta: Meta<typeof PrecedenceHarness> = {
  title: "Integration/Appearance precedence",
  component: PrecedenceHarness,
  parameters: {
    layout: "fullscreen",
    // The harness renders the published stylesheet in an isolated document; the addon
    // would audit the surrounding explanatory chrome, not the SDK.
    a11y: { test: "off" },
    docs: {
      description: {
        component:
          "Asserts what `appearance.variables` survives — against `dist/kaiten.css`, the file customers install, rather than the unscoped stylesheet Storybook otherwise renders with. It wins in both host arrangements and either import order, and gives way only to a host that imports it into a cascade layer.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

/** Proves the SDK stylesheet is actually in the document, so red never passes by default. */
async function probes(canvasElement: HTMLElement) {
  const doc = canvasElement.querySelector("iframe")!.contentDocument!;

  await expect(
    distCss,
    "dist/kaiten.css must be built before this story can assert anything",
  ).toBeTruthy();
  await expect(
    doc.querySelector("#sdk")!.textContent,
    "the harness must load the scoped stylesheet, not an empty string",
  ).toContain(".bg-primary:is(.kaiten,.kaiten *)");

  const styleOf = (id: string) =>
    doc.defaultView!.getComputedStyle(doc.querySelector<HTMLElement>(id)!);
  return { themed: styleOf("#themed-probe"), host: styleOf("#host-probe") };
}

export const OverrideWinsOverTailwindV4Host: Story = {
  name: "Wins over a Tailwind v4 host",
  args: { hostCss: HOST_TAILWIND_V4 },
  play: async ({ canvasElement }) => {
    const { themed, host } = await probes(canvasElement);

    // The override reaches the component. Before `ac12ec3` the host's `.bg-primary`
    // won here whenever it loaded last, and this read as the host's red.
    await expect(themed.backgroundColor).toBe(EXPECTED.primary);
    await expect(themed.borderRadius).toBe(EXPECTED.radius);

    // Only the fill was overridden; the readable foreground is derived. Omitting it is
    // a supported way to theme, so the playground must be free to emit a lone fill.
    await expect(themed.color).toBe(EXPECTED.primaryForeground);

    // The other half: SDK utilities stay inside their subtree, so the host's own button
    // keeps the host's colour rather than an undefined `--ktn-primary`.
    await expect(host.backgroundColor).toBe(EXPECTED.hostPrimary);
    await expect(host.borderRadius).toBe(EXPECTED.hostRadius);
  },
};

export const UnlayeredHostOverridesTheSdk: Story = {
  name: "Wins over an unlayered host",
  args: { hostCss: HOST_UNLAYERED },
  play: async ({ canvasElement }) => {
    const { themed, host } = await probes(canvasElement);

    // This story used to assert the opposite, and the assertion was correct: while the
    // SDK shipped inside `@layer utilities`, an unlayered host rule outranked it however
    // specific the layered selector was, so the `:is()` headroom never got consulted and
    // `appearance.variables` was inert against Tailwind v3, plain CSS and most CSS-in-JS.
    // The published stylesheet is now unlayered, so the two compete on specificity — two
    // classes against the host's one — and the override lands in either import order.
    await expect(themed.backgroundColor).toBe(EXPECTED.primary);
    await expect(themed.borderRadius).toBe(EXPECTED.radius);
    await expect(themed.color).toBe(EXPECTED.primaryForeground);

    // Winning inside `.kaiten` must not mean reaching outside it: the scope is what
    // makes unlayering safe, so the host's own button is the other half of the claim.
    await expect(host.backgroundColor).toBe(EXPECTED.hostPrimary);
    await expect(host.borderRadius).toBe(EXPECTED.hostRadius);
  },
};

/**
 * The way out, for a host that wants its own CSS to win instead.
 *
 * Unlayering makes the SDK win by default, which is only the right default because it
 * is reversible: `@import … layer(kaiten)` puts the whole stylesheet in a layer the
 * host names, and every unlayered host rule then outranks it wholesale. Asserted
 * because it is the only remaining answer for a host that wants to restyle Kaiten
 * beyond `appearance` — the README points at it, so it has to keep working.
 */
export const HostCanTakeItBackWithALayer: Story = {
  name: "Host wins when it imports the SDK into a layer",
  args: { hostCss: HOST_UNLAYERED, sdkLayer: "kaiten" },
  play: async ({ canvasElement }) => {
    const { themed, host } = await probes(canvasElement);

    await expect(themed.backgroundColor).toBe(EXPECTED.hostPrimary);
    await expect(themed.borderRadius).toBe(EXPECTED.hostRadius);
    await expect(host.backgroundColor).toBe(EXPECTED.hostPrimary);
  },
};
