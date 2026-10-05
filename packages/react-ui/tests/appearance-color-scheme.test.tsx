// @vitest-environment jsdom

import { render, cleanup, act } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { KaitenProvider } from "./support/styled-provider.tsx";

afterEach(() => {
  cleanup();
  restoreMatchMedia();
});

const originalMatchMedia = window.matchMedia;
function restoreMatchMedia() {
  window.matchMedia = originalMatchMedia;
}

/**
 * A `matchMedia` whose result can be flipped, so a session that changes colour
 * scheme mid-flight is testable and not just the initial read.
 */
function stubColorScheme(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  let matches = prefersDark;

  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return query.includes("prefers-color-scheme: dark") ? matches : !matches;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;

  return function setPrefersDark(next: boolean) {
    matches = next;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

function renderScope(baseTheme?: "light" | "dark" | "system") {
  const { container } = render(
    <KaitenProvider
      mode="public"
      publishableKey="pk_demo"
      polling={{ enabled: false }}
      appearance={baseTheme ? { baseTheme } : {}}
    >
      <span>scope</span>
    </KaitenProvider>,
  );
  return container.querySelector('[class~="kaiten"]')!;
}

test('baseTheme "system" renders dark when the visitor prefers dark', () => {
  stubColorScheme(true);
  expect(renderScope("system").classList.contains("dark")).toBe(true);
});

test('baseTheme "system" renders light when the visitor prefers light', () => {
  stubColorScheme(false);
  expect(renderScope("system").classList.contains("dark")).toBe(false);
});

test('baseTheme "system" follows a change made mid-session', () => {
  const setPrefersDark = stubColorScheme(false);
  const scope = renderScope("system");
  expect(scope.classList.contains("dark")).toBe(false);

  setPrefersDark(true);
  expect(scope.classList.contains("dark")).toBe(true);
});

test("an explicit baseTheme ignores the system preference entirely", () => {
  // The point of asking for a mode is to get it, whatever the OS says.
  stubColorScheme(true);
  expect(renderScope("light").classList.contains("dark")).toBe(false);

  cleanup();
  stubColorScheme(false);
  expect(renderScope("dark").classList.contains("dark")).toBe(true);
});

// The three states the stylesheet distinguishes. `.dark .kaiten:not(.ktn-light)`
// is the inherit branch, so what the provider stamps IS the enforcement: a class
// too many makes a widget refuse to follow its host, a class too few makes an
// explicit choice unenforceable inside a dark page.
test("no baseTheme stamps nothing, so the host page decides", () => {
  stubColorScheme(true);
  const scope = renderScope();

  // Not even light: with `.dark` on an ancestor the widget must darken with it,
  // which is what an embedded component should do when nobody said otherwise.
  expect(scope.classList.contains("dark")).toBe(false);
  expect(scope.classList.contains("ktn-light")).toBe(false);
});

test('baseTheme "light" stamps the class that outranks a dark host page', () => {
  stubColorScheme(true);
  const scope = renderScope("light");

  // Without `ktn-light`, `.dark .kaiten` from the host won and the declaration
  // was silently ignored — verified in kaiten/app, where dropping the
  // host's single `dark` class flipped --ktn-background from #070708 to #ffffff.
  expect(scope.classList.contains("ktn-light")).toBe(true);
  expect(scope.classList.contains("dark")).toBe(false);
});

test('baseTheme "system" resolves to a declaration, not to inheritance', () => {
  const setPrefersDark = stubColorScheme(false);
  const scope = renderScope("system");

  // "Follow the OS" is a choice too: resolved light must beat a dark host.
  expect(scope.classList.contains("ktn-light")).toBe(true);

  act(() => setPrefersDark(true));
  expect(scope.classList.contains("dark")).toBe(true);
  expect(scope.classList.contains("ktn-light")).toBe(false);
});
