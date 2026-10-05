import type { Meta, StoryObj } from "@storybook/react-vite";
import type * as React from "react";

import { KaitenStoryProvider, scenarioPortalDefault } from "../../../.storybook/kaiten-mock.tsx";
import { EntitlementStatusBar } from "../entitlement-status-bar/entitlement-status-bar.tsx";
import { PricingTable } from "../pricing-table/pricing-table.tsx";
import { BillingSummary } from "../billing-summary/billing-summary.tsx";

/**
 * The three ways a host actually places an SDK component, and the guard on the one
 * CSS property that breaks them.
 *
 * The responsive work replaces viewport breakpoints with container queries, which
 * means component roots gain `container-type: inline-size`. That property says "do
 * not look at my content to size me" — so a root whose width WAS derived from its
 * content stops having one. Measured in Chromium, a 600px host row:
 *
 *   host layout      no container    container      container + w-full
 *   block flow           600px          600px             600px
 *   flex item             94px            0px             529px
 *   grid item            312px          265px             265px
 *
 * Zero. Not narrow — gone. And a flex row is the common host layout, not an exotic
 * one, so this is the failure mode that would reach an integrator first.
 *
 * Reproduced on a real component rather than a probe: giving `BillingSummary` a
 * container with no `w-full` dropped its root from full width to 82px in `FlexRow`
 * below, and pairing it with `w-full` restored it with every other layout number
 * unchanged. Both runs are what set the rule in kaiten.css.
 *
 * These stories exist to be measured, not looked at.
 * `tests/layout/host-context.spec.ts` asserts every component here keeps a usable
 * width in every context, so a container added later without `w-full` fails there
 * instead of in someone's app.
 */

const scenario = scenarioPortalDefault();

/**
 * The caption sits OUTSIDE the host layout, never around the component.
 *
 * A wrapper between the host's `display: flex` and the SDK root would make the
 * wrapper the flex item and leave the component a plain block child at 100% width —
 * which is exactly how the first version of these stories reported a collapsed
 * container as healthy. Every story below puts the SDK root in direct contact with
 * the layout being tested.
 */
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        font: "600 11px/1.4 ui-monospace, monospace",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        opacity: 0.6,
        margin: "0 0 0.5rem",
      }}
    >
      {children}
    </p>
  );
}

/**
 * Host chrome, marked out by its dashed border rather than by being dimmed. An
 * `opacity` low enough to read as "not the SDK" also takes the label under the AA
 * contrast floor, and `a11y.test` is an error in this repo — correctly, since a
 * story that ships a contrast violation teaches the violation.
 */
const sidebarStyle: React.CSSProperties = {
  padding: "1rem",
  border: "1px dashed currentColor",
  font: "12px/1.5 ui-monospace, monospace",
};

const meta: Meta = {
  title: "Integration/Host layouts",
  parameters: {
    layout: "fullscreen",
    kaitenCanvas: "wide",
    docs: {
      description: {
        story:
          "How a host places the SDK: block flow, a flex row, a grid track. Container " +
          "queries require `container-type: inline-size` on component roots, which " +
          "collapses any root that was sized by its content — to 0px as a flex item. " +
          "Measured by tests/layout.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

/**
 * Block flow — the simple case, and the one that stays correct either way, because a
 * block element's width already comes from its parent rather than its content.
 */
export const BlockFlow: Story = {
  render: () => (
    <KaitenStoryProvider scenario={scenario}>
      <Caption>host: block flow</Caption>
      <div data-host-layout="block">
        <BillingSummary />
      </div>
    </KaitenStoryProvider>
  ),
};

/**
 * Flex row — the case that collapses. The SDK component sits beside host content, so
 * its width is negotiated by the flex algorithm from its content; take the content
 * out of that calculation and there is nothing left to negotiate with.
 */
export const FlexRow: Story = {
  render: () => (
    <KaitenStoryProvider scenario={scenario}>
      <Caption>host: flex row — SDK beside host content</Caption>
      <div data-host-layout="flex" style={{ display: "flex", gap: "1rem", alignItems: "start" }}>
        <BillingSummary />
        <aside style={{ ...sidebarStyle, flex: "0 0 12rem" }}>host sidebar</aside>
      </div>
    </KaitenStoryProvider>
  ),
};

/**
 * Grid track — sized by the track, so containment narrows it rather than collapsing
 * it. Included because "narrower than before" is a quieter failure than "gone", and
 * quieter failures are the ones that ship.
 */
export const GridTrack: Story = {
  render: () => (
    <KaitenStoryProvider scenario={scenario}>
      <Caption>host: grid track</Caption>
      <div
        data-host-layout="grid"
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 12rem", gap: "1rem" }}
      >
        <BillingSummary />
        <aside style={sidebarStyle}>host sidebar</aside>
      </div>
    </KaitenStoryProvider>
  ),
};

/**
 * The provider itself as the flex item — the shape a real embed actually has.
 *
 * Every other story here puts `KaitenStoryProvider` OUTSIDE the host layout, so the
 * flex item is a plain block wrapper and the provider's scope root never has to size
 * itself. A host does the opposite: it wraps the provider. That gap let a real
 * regression through CI-green local runs — the scope root shrink-to-fit, so a
 * `repeat(auto-fit, …)` grid asked it for an available width it had not decided and
 * settled on one column. A 1280px page rendered a one-column pricing table.
 *
 * `PricingTable` rather than `BillingSummary` because the symptom was a column count,
 * not a width: a component with no responsive grid stays wide enough to pass a width
 * check while still being laid out wrongly.
 */
export const ProviderInHostFlexRow: Story = {
  render: () => (
    <>
      <Caption>host: flex row — the PROVIDER is the flex item</Caption>
      <div data-host-layout="flex" style={{ display: "flex", gap: "1rem", alignItems: "start" }}>
        <KaitenStoryProvider scenario={scenario}>
          <PricingTable />
        </KaitenStoryProvider>
        <aside style={{ ...sidebarStyle, flex: "0 0 10rem" }}>host sidebar</aside>
      </div>
    </>
  ),
};

/**
 * A full-width bar in a flex row. `EntitlementStatusBar` is the component most likely
 * to be dropped into an existing app chrome, which is exactly where flex rows live.
 */
export const StatusBarInFlexRow: Story = {
  render: () => (
    <KaitenStoryProvider scenario={scenario}>
      <Caption>host: flex row — app chrome</Caption>
      <div data-host-layout="flex" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <EntitlementStatusBar />
        <aside style={{ ...sidebarStyle, flex: "0 0 8rem" }}>host menu</aside>
      </div>
    </KaitenStoryProvider>
  ),
};
