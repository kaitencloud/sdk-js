// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

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
// The same goes for what is keyed on CLASS names, since a host has them too: its
// own Tailwind build, or shadcn's tokens, defines `bg-primary`, `rounded-lg`,
// `text-sm` and `p-4`, bound to its own theme. A utility scoped to `.kaiten`
// alone outranks the host's rule on the host's own element, and the boundary is
// an ancestor of that element: a Tailwind theme variable declared on it
// (`--spacing`, `--text-sm`) replaces the host's for every host utility that
// reads it.
//
// And the boundary is where an inherited value comes from: a `color` declared on
// it is the colour of every host paragraph that sets none of its own.
//
// Both directions are asserted. The "SDK is still styled" half matters as much as
// the other: without it, a `.ktn-own` marker missing from a component root would
// leave that component unstyled and this file would still be green.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import postcss from "postcss";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import type { PaywallTriggerResult } from "@kaitencloud/react";

import { splitSelectorList } from "../scripts/scope-kaiten-css.ts";

// A wall that is up whatever the snapshot says: the tests below need the markup
// `Paywall` puts around the host's content, not a decision about a customer.
vi.mock("@kaitencloud/react", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/react")>();
  const walled: PaywallTriggerResult = {
    shouldShow: true,
    reason: "not_entitled",
    current: 0,
    limit: 0,
    percentage: 0,
    metered: false,
    usageWindow: null,
    isLoading: false,
    error: null,
  };
  return { ...actual, usePaywallTrigger: () => walled };
});

const { Paywall } = await import("../src/index.ts");
const { KaitenProvider } = await import("./support/styled-provider.tsx");

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

/**
 * What a host's own stylesheet gives the class names it shares with the SDK.
 *
 * Unlayered, with literal values: jsdom discards every rule inside an `@layer`
 * and does not substitute `var()` in a computed value, so a Tailwind v4 host
 * cannot be modelled here. It also drops a `calc()` over a variable outright,
 * which is what the SDK's spacing utilities are, so `p-4` is not among the
 * classes read here: the SDK's rule would be invisible and the assertion would
 * pass with the bug present. `Integration/Appearance precedence` asserts both in
 * a real browser.
 */
const HOST = {
  background: "rgb(220, 38, 38)",
  radius: "0px",
  fontSize: "13px",
  mono: '"Courier New", monospace',
  color: "rgb(51, 65, 85)",
  spacing: "0.5rem",
  textSm: "13px",
} as const;

const HOST_SHEET = `
  :root { --spacing: ${HOST.spacing}; --text-sm: ${HOST.textSm}; }
  body { color: ${HOST.color}; }
  article { color: rgb(1, 2, 3); }
  .bg-primary { background-color: ${HOST.background}; }
  .rounded-lg { border-radius: ${HOST.radius}; }
  .text-sm { font-size: ${HOST.fontSize}; }
  code { font-family: ${HOST.mono}; }
`;

/** Class names a host's button and the SDK's `Button` have in common. */
const SHARED_CLASSES = "bg-primary rounded-lg text-sm";

const HOST_UTILITIES = {
  background: HOST.background,
  radius: HOST.radius,
  fontSize: HOST.fontSize,
};

function utilitiesOf(element: Element) {
  const style = getComputedStyle(element);
  return {
    background: style.backgroundColor,
    radius: style.borderRadius,
    fontSize: style.fontSize,
  };
}

let hostSheet: HTMLStyleElement | undefined;

/** Loads the host's sheet before or after the SDK's: neither order may matter. */
function loadHostSheet(order: "before" | "after") {
  hostSheet = document.createElement("style");
  hostSheet.textContent = HOST_SHEET;
  if (order === "before") document.head.prepend(hostSheet);
  else document.head.append(hostSheet);
}

afterEach(() => {
  hostSheet?.remove();
  hostSheet = undefined;
});

/** A host button inside a real style root, and one behind a real wall. */
function renderWalled(mode: "soft" | "hard", unstyled: boolean) {
  render(
    <KaitenProvider mode="static" catalog={{ plans: [] }}>
      <button type="button" className={SHARED_CLASSES}>
        Beside
      </button>
      <Paywall entitlement="seats" mode={mode} unstyled={unstyled} onUpgrade={() => {}}>
        <button type="button" className={SHARED_CLASSES}>
          Protected
        </button>
      </Paywall>
    </KaitenProvider>,
  );
  return { beside: screen.getByText("Beside"), walled: screen.getByText("Protected") };
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

  test("host markup under an element the SDK wraps it in is still left alone", () => {
    // `<Paywall>` renders the host's children inside its own `data-slot` root:
    // the one place in the SDK where host markup sits under an SDK element. That
    // root is a `.ktn-shell`, which marks the element and nothing under it.
    const { getByTestId } = renderUnderBoundary(
      <div className="ktn-shell">
        <div>
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

  test("an element the SDK wraps host markup in is reset itself", () => {
    const { getByTestId } = renderUnderBoundary(
      <ul className="ktn-shell" data-testid="shell">
        <li>
          <ul data-testid="host-list">
            <li>one</li>
          </ul>
        </li>
      </ul>,
    );

    expect(getComputedStyle(getByTestId("shell")).listStyle).toBe("none");
    expect(getComputedStyle(getByTestId("host-list")).listStyle).toBe("");
  });

  test("an SDK component the host placed behind a wall is still reset", () => {
    // Host markup under the wall's root, and SDK markup inside it again: an
    // exclusion of everything under the wall would leave this list its bullets.
    render(
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        <Paywall entitlement="seats" onUpgrade={() => {}}>
          <section>
            <ul data-testid="host-list">
              <li>one</li>
            </ul>
            <ul className="ktn-own" data-testid="nested-sdk-list">
              <li>plans</li>
            </ul>
          </section>
        </Paywall>
      </KaitenProvider>,
    );

    expect(getComputedStyle(screen.getByTestId("host-list")).listStyle).toBe("");
    expect(getComputedStyle(screen.getByTestId("nested-sdk-list")).listStyle).toBe("none");
  });
});

describe("host markup keeps its own utilities", () => {
  test.each(["before", "after"] as const)(
    "a host button keeps what its own sheet gives it, loaded %s the SDK's",
    (order) => {
      loadHostSheet(order);
      const { getByTestId } = renderUnderBoundary(
        <button type="button" className={SHARED_CLASSES} data-testid="host-button">
          Host
        </button>,
      );

      expect(utilitiesOf(getByTestId("host-button"))).toEqual(HOST_UTILITIES);
    },
  );

  test("a class name only the SDK's sheet defines does nothing to host markup", () => {
    // No host sheet: the button outside the boundary shows what these classes are
    // worth without the SDK, and the one inside must be worth the same.
    const { getByTestId } = render(
      <>
        <button type="button" className={SHARED_CLASSES} data-testid="control">
          Host
        </button>
        <div className="kaiten">
          <button type="button" className={SHARED_CLASSES} data-testid="host-button">
            Host
          </button>
        </div>
      </>,
    );

    expect(utilitiesOf(getByTestId("host-button"))).toEqual(utilitiesOf(getByTestId("control")));
  });

  // The real components, because these are the two places the SDK mounts markup
  // it did not write: under `KaitenStyleRoot`, and behind a `Paywall`.
  test.each([
    ["a soft wall", "soft", false],
    ["a hard wall", "hard", false],
    ["an unstyled wall", "soft", true],
  ] as const)("host markup beside and behind %s keeps its own utilities", (_, mode, unstyled) => {
    loadHostSheet("after");
    const { beside, walled } = renderWalled(mode, unstyled);

    expect(utilitiesOf(beside)).toEqual(HOST_UTILITIES);
    expect(utilitiesOf(walled)).toEqual(HOST_UTILITIES);
  });
});

describe("SDK markup still takes the SDK's utilities", () => {
  // A host rule matches these elements too, by class name: reading anything but
  // the host's value is what proves the SDK's rule matched and outranked it.
  function expectSdkUtilities(element: Element) {
    const styles = utilitiesOf(element);
    expect(styles.background).not.toBe(HOST.background);
    expect(styles.radius).not.toBe(HOST.radius);
    expect(styles.fontSize).not.toBe(HOST.fontSize);
  }

  test.each(["before", "after"] as const)(
    "a button the SDK rendered is not restyled by a host sheet loaded %s the SDK's",
    (order) => {
      loadHostSheet(order);
      const { getByTestId } = renderUnderBoundary(
        <button type="button" className={`ktn-own ${SHARED_CLASSES}`} data-testid="sdk-button">
          Upgrade
        </button>,
      );

      expectSdkUtilities(getByTestId("sdk-button"));
    },
  );

  test("an element inside an SDK component is covered by its root's marker", () => {
    loadHostSheet("after");
    const { getByTestId } = renderUnderBoundary(
      <div className="ktn-own">
        <span className={SHARED_CLASSES} data-testid="sdk-inner">
          Upgrade
        </span>
      </div>,
    );

    expectSdkUtilities(getByTestId("sdk-inner"));
  });

  test("an element the SDK wraps host markup in takes the SDK's utilities, alone", () => {
    loadHostSheet("after");
    const { getByTestId } = renderUnderBoundary(
      <div className={`ktn-shell ${SHARED_CLASSES}`} data-testid="shell">
        <div>
          <button type="button" className={SHARED_CLASSES} data-testid="host-button">
            Host
          </button>
        </div>
      </div>,
    );

    expectSdkUtilities(getByTestId("shell"));
    expect(utilitiesOf(getByTestId("host-button"))).toEqual(HOST_UTILITIES);
  });

  test("an SDK component the host placed behind a wall keeps the SDK's utilities", () => {
    // A host gates a whole section, and that section holds an `UpgradeButton` or
    // a `PlanBadge`: host markup behind the wall, SDK markup inside it again.
    loadHostSheet("after");
    render(
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        <Paywall entitlement="seats" onUpgrade={() => {}}>
          <section>
            <button type="button" className={`ktn-own ${SHARED_CLASSES}`} data-testid="nested-sdk">
              Upgrade
            </button>
          </section>
        </Paywall>
      </KaitenProvider>,
    );

    expectSdkUtilities(screen.getByTestId("nested-sdk"));
  });
});

describe("host markup keeps its own theme variables", () => {
  test("a host utility inside the boundary still reads the host's Tailwind theme", () => {
    // `.p-4 { padding: calc(var(--spacing) * 4) }` is the host's rule either way;
    // what it computes to depends on whose `--spacing` its element inherits.
    loadHostSheet("after");
    const { getByTestId } = renderUnderBoundary(<p data-testid="host-text">Host</p>);

    const style = getComputedStyle(getByTestId("host-text"));
    expect(style.getPropertyValue("--spacing")).toBe(HOST.spacing);
    expect(style.getPropertyValue("--text-sm")).toBe(HOST.textSm);
  });

  test("the boundary hands host markup no variable outside the SDK's own namespace", () => {
    // `--ktn-*` is the SDK's, declared on the boundary for its components to
    // inherit, and no host reads those names. Every other custom property the
    // sheet mentions must read the same on host markup inside the boundary as
    // outside it.
    const names = new Set<string>();
    postcss.parse(readFileSync(SHIPPED_CSS, "utf8")).walkDecls(/^--/, (decl) => {
      if (!decl.prop.startsWith("--ktn-")) names.add(decl.prop);
    });

    const { getByTestId } = render(
      <>
        <p data-testid="control">Host</p>
        <div className="kaiten">
          <p data-testid="host-text">Host</p>
        </div>
      </>,
    );
    const inside = getComputedStyle(getByTestId("host-text"));
    const outside = getComputedStyle(getByTestId("control"));

    expect(names.size).toBeGreaterThan(0);
    expect(
      [...names].filter((name) => inside.getPropertyValue(name) !== outside.getPropertyValue(name)),
    ).toEqual([]);
  });
});

describe("host type is left alone", () => {
  test("a host <code> keeps its own typeface", () => {
    loadHostSheet("after");
    const { getByTestId } = renderUnderBoundary(<code data-testid="host-code">npm install</code>);

    expect(getComputedStyle(getByTestId("host-code")).fontFamily).toBe(HOST.mono);
  });

  test("a host <code> with no rule of its own keeps the browser's", () => {
    const { getByTestId } = render(
      <>
        <code data-testid="control">npm install</code>
        <div className="kaiten">
          <code data-testid="host-code">npm install</code>
        </div>
      </>,
    );

    expect(getComputedStyle(getByTestId("host-code")).fontFamily).toBe(
      getComputedStyle(getByTestId("control")).fontFamily,
    );
  });

  test("a <code> the SDK rendered takes the SDK's mono face", () => {
    loadHostSheet("after");
    const { getByTestId } = render(
      <>
        <code data-testid="control">npm install</code>
        <div className="kaiten">
          <div className="ktn-own">
            <code data-testid="sdk-code">npm install</code>
          </div>
        </div>
      </>,
    );

    const face = getComputedStyle(getByTestId("sdk-code")).fontFamily;
    expect(face).not.toBe(HOST.mono);
    expect(face).not.toBe("");
  });
});

describe("host text keeps its own colour", () => {
  test("a host paragraph inside the boundary has the colour of the host's page", () => {
    loadHostSheet("after");
    const { getByTestId } = renderUnderBoundary(<p data-testid="host-text">Host</p>);

    expect(getComputedStyle(getByTestId("host-text")).color).toBe(HOST.color);
  });

  test.each([
    ["a soft wall", "soft", false],
    ["a hard wall", "hard", false],
    ["an unstyled wall", "soft", true],
  ] as const)("host text beside and behind %s keeps its colour", (_, mode, unstyled) => {
    loadHostSheet("after");
    render(
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        <p>Beside</p>
        <Paywall entitlement="seats" mode={mode} unstyled={unstyled} onUpgrade={() => {}}>
          <p>Protected</p>
        </Paywall>
      </KaitenProvider>,
    );

    expect(getComputedStyle(screen.getByText("Beside")).color).toBe(HOST.color);
    expect(getComputedStyle(screen.getByText("Protected")).color).toBe(HOST.color);
  });
});

describe("SDK text still takes the SDK's colour", () => {
  // Colour is inherited, so an SDK element that read the host's would be reading
  // it from the host's page: anything else is the SDK's own declaration.

  test("the outermost element of an SDK component declares it", () => {
    loadHostSheet("after");
    const { getByTestId } = renderUnderBoundary(
      <section>
        <div className="ktn-own" data-testid="sdk-root">
          <p data-testid="sdk-text">Usage</p>
        </div>
      </section>,
    );

    expect(getComputedStyle(getByTestId("sdk-root")).color).not.toBe(HOST.color);
    expect(getComputedStyle(getByTestId("sdk-text")).color).toBe(
      getComputedStyle(getByTestId("sdk-root")).color,
    );
  });

  test("a marked element inside a component inherits, it does not declare again", () => {
    // `Card` sets `text-card-foreground` for its subtree, and its title is marked
    // too: a colour declared on every marked element would put the page's
    // foreground back on the title, over the card's.
    const { getByTestId } = renderUnderBoundary(
      <div className="ktn-own text-card-foreground" data-testid="card">
        <div className="ktn-own" data-testid="card-title">
          Team
        </div>
      </div>,
    );

    const card = getComputedStyle(getByTestId("card")).color;
    expect(card).toContain("card-foreground");
    expect(getComputedStyle(getByTestId("card-title")).color).toBe(card);
  });

  test("a control the SDK renders by itself does not inherit the host's", () => {
    // The preflight tells links and form controls to inherit their colour, and an
    // outline `Button` pins none.
    loadHostSheet("after");
    const { getByTestId } = renderUnderBoundary(
      <button type="button" className="ktn-own" data-testid="sdk-button">
        Manage plan
      </button>,
    );

    expect(getComputedStyle(getByTestId("sdk-button")).color).not.toBe(HOST.color);
  });

  test("a host rule that targets an SDK element outranks it", () => {
    // The declaration weighs nothing, as the inherited value it replaces did: one
    // type selector in the host's sheet is enough to override it.
    loadHostSheet("after");
    const { getByTestId } = renderUnderBoundary(
      <article className="ktn-own" data-testid="sdk-root">
        Usage
      </article>,
    );

    expect(getComputedStyle(getByTestId("sdk-root")).color).toBe("rgb(1, 2, 3)");
  });
});

describe("the style root's own box", () => {
  test("declares its width and its position, and carries no utility class", () => {
    render(
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        <p>Host</p>
      </KaitenProvider>,
    );

    const root = screen.getByText("Host").closest(".kaiten")!;
    expect(root.className).toBe("kaiten");
    // Read from the sheet: a root sized by its contents collapses in a host's
    // flex row (see `KaitenStyleRoot`).
    expect(getComputedStyle(root).width).toBe("100%");
    expect(getComputedStyle(root).position).toBe("relative");
  });
});

// The tests above use synthetic markup, so they cannot see a `.ktn-own` marker
// missing from a REAL component root — the failure mode where that component
// silently loses its reset. This closes that gap statically.
test("every element the SDK gives a data-slot is marked as the SDK's", async () => {
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
      // `ktn-shell` on the one root that wraps the host's markup: see paywall.tsx.
      if (tag.includes("ktn-own") || tag.includes("ktn-shell")) continue;
      if (NO_ELEMENT_OF_THEIR_OWN.test(tag)) continue;
      unmarked.push(`${path.basename(file)}: ${tag.split("\n")[0].slice(0, 70)}`);
    }
  }

  // A root without a marker renders with the browser's defaults and none of the
  // SDK's utilities. The visual baselines would not show it: Storybook renders
  // the stylesheet before it is scoped. Fail here instead.
  expect(unmarked).toEqual([]);
});
