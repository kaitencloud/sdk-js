// @vitest-environment jsdom
//
// The inbound guard: what the shipped stylesheet does to markup it did not write.
//
// Every other CSS test here measures the outbound direction — that no rule leaks
// OUTSIDE `.kaiten`. That was never the whole risk, because a non-headless
// `<KaitenProvider>` wraps the HOST's children INSIDE `.kaiten`. Tailwind's
// preflight is keyed on tag names, so it reset the host's lists, headings, links,
// images, buttons and box model — and, the sheet being deliberately unlayered, it
// beat any host CSS living in a `@layer`. `assertScoped` could not see any of it:
// `ol:is(.kaiten,.kaiten *)` names `.kaiten`, so it satisfies an outbound check
// while doing precisely this.
//
// Both directions are asserted. The "SDK is still reset" half matters as much as
// the other: without it, a `.ktn-own` marker missing from a component root would
// leave that component unstyled and this file would still be green.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import postcss from "postcss";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "vite-plus/test";

import { splitSelectorList } from "../scripts/scope-kaiten-css.ts";

const SHIPPED_CSS = path.resolve(import.meta.dirname, "../dist/kaiten.css");

/**
 * The shipped sheet, with pseudo-element branches removed from every selector
 * list.
 *
 * This is not cosmetic. **jsdom discards an entire rule when its selector list
 * contains a pseudo-element**, and Tailwind emits its universal
 * `box-sizing`/`margin`/`padding`/`border` reset with `::after, ::before,
 * ::backdrop, ::file-selector-button` in that same list. Without this step jsdom
 * never applies the single most destructive rule in the sheet, and every
 * assertion below would pass with the bug fully present. `harness sees the
 * universal reset` pins that the stripping worked.
 */
function loadShippedCss(): string {
  const root = postcss.parse(readFileSync(SHIPPED_CSS, "utf8"));

  root.walkRules((rule) => {
    const kept = splitSelectorList(rule.selector).filter((part) => !part.includes("::"));
    if (kept.length === 0) rule.remove();
    else rule.selector = kept.join(", ");
  });

  return root.toString();
}

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = loadShippedCss();
  document.head.append(style);
});

afterEach(cleanup);

/** Renders markup where the provider puts the host's children: inside `.kaiten`. */
function renderUnderBoundary(children: ReactNode) {
  return render(<div className="kaiten">{children}</div>);
}

test("harness sees the universal reset (otherwise every assertion here is vacuous)", () => {
  // jsdom would drop this rule untouched — see loadShippedCss. If this fails,
  // the stripping stopped working and the rest of this file proves nothing.
  const { getByTestId } = renderUnderBoundary(
    <div className="ktn-own">
      <span data-testid="probe">x</span>
    </div>,
  );

  expect(getComputedStyle(getByTestId("probe")).boxSizing).toBe("border-box");
});

describe("host markup is left alone", () => {
  // `box-sizing` and `border-width` come from that universal reset; `list-style`
  // from the tag-keyed preflight. All three read as the browser default here,
  // which is the whole point.

  test("a host list keeps its bullets and its box model", () => {
    const { getByTestId } = render(
      <>
        <ul data-testid="control-list">
          <li>one</li>
        </ul>
        <div className="kaiten">
          <ul data-testid="host-list">
            <li>one</li>
          </ul>
        </div>
      </>,
    );

    const style = getComputedStyle(getByTestId("host-list"));
    expect(style.listStyle).toBe("");
    expect(style.boxSizing).toBe("content-box");
    // The default border width, read from a list outside `.kaiten`: jsdom 29
    // reported the keyword `medium`, and jsdom 30 resolves it to a length.
    expect(style.borderWidth).toBe(getComputedStyle(getByTestId("control-list")).borderWidth);
    expect(style.borderWidth).not.toBe("0px");
  });

  test("a host heading and link are untouched", () => {
    const { getByTestId } = renderUnderBoundary(
      <>
        <h1 data-testid="host-heading">Title</h1>
        <a data-testid="host-link" href="/x">
          link
        </a>
      </>,
    );

    expect(getComputedStyle(getByTestId("host-heading")).boxSizing).toBe("content-box");
    expect(getComputedStyle(getByTestId("host-link")).boxSizing).toBe("content-box");
  });

  test("host markup nested inside an SDK component is still left alone", () => {
    // `<Paywall>` renders the host's children inside its own `data-slot` root, so
    // `.ktn-own *` would otherwise catch them. `.ktn-host` takes them back out —
    // the one place in the SDK where host markup sits under an SDK element.
    const { getByTestId } = renderUnderBoundary(
      <div className="ktn-own">
        <div className="ktn-host">
          <ul data-testid="walled-list">
            <li>one</li>
          </ul>
        </div>
      </div>,
    );

    const style = getComputedStyle(getByTestId("walled-list"));
    expect(style.listStyle).toBe("");
    expect(style.boxSizing).toBe("content-box");
  });
});

describe("SDK markup is still reset", () => {
  test("a list the SDK rendered loses its bullets", () => {
    const { getByTestId } = renderUnderBoundary(
      <div className="ktn-own">
        <ul data-testid="sdk-list">
          <li>one</li>
        </ul>
      </div>,
    );

    const style = getComputedStyle(getByTestId("sdk-list"));
    expect(style.listStyle).toBe("none");
    expect(style.boxSizing).toBe("border-box");
    expect(style.borderWidth).toBe("0px");
  });

  test("the marked element itself is reset, not only its descendants", () => {
    // `.ktn-own` sits ON component roots, so the scope has to match the element
    // carrying it — not just `.ktn-own *`.
    const { getByTestId } = renderUnderBoundary(
      <ul className="ktn-own" data-testid="sdk-root-list">
        <li>one</li>
      </ul>,
    );

    expect(getComputedStyle(getByTestId("sdk-root-list")).listStyle).toBe("none");
  });

  test("an SDK component rendered inside host markup is still reset", () => {
    // The ordinary case: the host lays out its page and drops a Kaiten component
    // into it. Only the component is `.ktn-own`.
    const { getByTestId } = renderUnderBoundary(
      <main>
        <ul data-testid="host-nav">
          <li>nav</li>
        </ul>
        <div className="ktn-own">
          <ul data-testid="sdk-inside-host">
            <li>plans</li>
          </ul>
        </div>
      </main>,
    );

    expect(getComputedStyle(getByTestId("host-nav")).listStyle).toBe("");
    expect(getComputedStyle(getByTestId("sdk-inside-host")).listStyle).toBe("none");
  });
});

// The tests above use synthetic markup, so they cannot see a `.ktn-own` marker
// missing from a REAL component root — the failure mode where that component
// silently loses its reset. This closes that gap statically.
test("every element the SDK gives a data-slot also carries ktn-own", async () => {
  const { readdir, readFile } = await import("node:fs/promises");

  // Wrappers that render no DOM of their own (a Root, a Portal, a Provider) or
  // whose element is always inside an already-marked SDK subtree. Marking them
  // would be harmless but meaningless — they have no element to reset. Empty
  // since the Radix primitives left; kept as the seam for the next such wrapper.
  const NO_ELEMENT_OF_THEIR_OWN =
    /^<(?:Dialog|Popover|Tooltip)(?:Root|Portal|Provider|Trigger|Anchor)\b/;

  async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(full);
      else if (full.endsWith(".tsx") && !full.includes(".stories.")) yield full;
    }
  }

  const unmarked: string[] = [];

  for await (const file of walk(path.resolve(import.meta.dirname, "../src"))) {
    // Comments are stripped first: prose that quotes a `data-slot="…"` — this
    // package documents its own markers — is not an element.
    const source = (await readFile(file, "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const match of source.matchAll(/data-slot="[a-z0-9-]+"/g)) {
      const open = source.lastIndexOf("<", match.index);
      let depth = 0;
      let end = match.index + match[0].length;
      while (end < source.length) {
        const char = source[end];
        if (char === "{") depth += 1;
        else if (char === "}") depth -= 1;
        else if (char === ">" && depth === 0) break;
        end += 1;
      }
      const tag = source.slice(open, end);
      if (tag.includes("ktn-own")) continue;
      if (NO_ELEMENT_OF_THEIR_OWN.test(tag)) continue;
      unmarked.push(`${path.basename(file)}: ${tag.split("\n")[0].slice(0, 70)}`);
    }
  }

  // A root without `ktn-own` renders with the browser's defaults instead of the
  // SDK's reset — visible, but only if that component happens to be in a visual
  // baseline. Fail here instead.
  expect(unmarked).toEqual([]);
});
