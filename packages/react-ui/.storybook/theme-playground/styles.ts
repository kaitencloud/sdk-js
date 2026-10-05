/**
 * Layout for the playground, and nothing else.
 *
 * The chrome is built from the SDK's own primitives (`Card`, `Button`, `Input`,
 * `Badge`, `Separator`) wearing SDK utilities, so colour, border, radius and type all
 * come from `--ktn-*` — this file used to carry a parallel palette and now carries none.
 * What is left is the part Tailwind cannot express against a *container*: the responsive
 * grids, which read the playground's own width rather than the viewport's.
 *
 * Two things make dogfooding the SDK here safe rather than circular:
 *
 * 1. The chrome is themed by the SDK's *defaults*, not by the draft. It lives in the
 *    story's outer `.kaiten`, while the draft is applied by the `KaitenStyleRoot` inside
 *    each preview panel — so setting `colorBackground` to black themes the previews and
 *    leaves the controls you need to undo it readable.
 * 2. None of it reaches the published stylesheet. `src/styles/kaiten.css` scans `src/**`
 *    to decide which utilities to emit, and this directory is not in it. The SDK classes
 *    used here are already emitted for the components themselves, so the chrome costs
 *    customers nothing.
 *
 * Rules here are unlayered, so they win over Tailwind's `@layer utilities` — which is
 * what lets `display: none` below beat a `flex` utility set in the markup.
 */
export const PLAYGROUND_CSS = `
/*
 * Breakpoints read the playground's own width, not the viewport's. It renders inside a
 * Storybook iframe, and on the docs page inside a narrower column still, so a viewport
 * media query describes the wrong box — it would put the editor beside the preview on a
 * wide screen even when the story itself had 700px to work with.
 */
.ktnpg { container-type: inline-size; }

/* Stacked by default. The sidebar is an enhancement, applied once there is room for it
   without squeezing the preview — which is the whole point of the panel beside it. */
.ktnpg-layout { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }

@container (min-width: 60rem) {
  .ktnpg-layout { grid-template-columns: minmax(0, 320px) minmax(0, 1fr); }
  /* Sticky only alongside the preview. Stacked, a pinned column with its own scrollbar
     means two nested scroll areas and no way to see a control and its effect at once. */
  .ktnpg-editor { max-height: 90vh; overflow-y: auto; position: sticky; top: 8px; }
}

/* Auto-fit rather than a fixed column count: the same toolbar sits in a 320px sidebar
   and in a full-width editor when the layout stacks. "Reset all" spans the row so it
   never ends up as a lone orphan beside a half-width select. */
.ktnpg-toolbar { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 8px; align-items: end; }
.ktnpg-toolbar > button { grid-column: 1 / -1; }

/*
 * The controls flow into as many columns as the editor is wide.
 *
 * In the sidebar that resolves to one column. Stacked above the preview it would
 * otherwise be thirty full-width rows — a very long scroll past every control before
 * reaching the components they change, which is the opposite of what a live editor is for.
 */
.ktnpg-group { display: grid; gap: 8px 14px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.ktnpg-group > h3, .ktnpg-group > p { grid-column: 1 / -1; }

.ktnpg-preview { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/*
 * Below the width where both panels fit side by side, show one at a time and let the
 * switch choose.
 *
 * Stacking them was worse than it looked: two capped, independently scrolling panels
 * plus the page meant three scrollbars to compare two themes, and the second panel was
 * far enough down that you could not see a change land in both anyway. One panel, one
 * scrollbar, and a toggle that costs nothing — the hidden panel stays mounted.
 */
.ktnpg-panels { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }

@container (max-width: 83.999rem) {
  .ktnpg-panels[data-preview="light"] .ktnpg-panel[data-mode="dark"],
  .ktnpg-panels[data-preview="dark"] .ktnpg-panel[data-mode="light"] { display: none; }
}

@container (min-width: 84rem) {
  .ktnpg-panels { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* Both on screen — nothing left to switch between. */
  .ktnpg-switch { display: none; }
  /* The panel only gets its own scroll area in the two-column layout, where capping it
     is what keeps the generated config reachable below. Showing one panel at a time it
     grows and the page scrolls, which is the point of the switch. */
  .ktnpg-panel-body { max-height: 74vh; overflow: auto; }
}

/*
 * A native colour input has no SDK primitive and no way to style its swatch through
 * utilities — the border and radius come from Tailwind on the element, these reach the
 * shadow parts inside it.
 */
.ktnpg-swatch { cursor: pointer; padding: 2px; }
.ktnpg-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.ktnpg-swatch::-webkit-color-swatch { border: none; border-radius: 4px; }
.ktnpg-swatch::-moz-color-swatch { border: none; border-radius: 4px; }
.ktnpg-swatch:disabled { cursor: default; opacity: 0.4; }
`;
