// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { KaitenLoaded, KaitenProvider, Show } from "@kaitencloud/react";

import { PlanBadge } from "../src/components/plan-badge/plan-badge.tsx";
import { KaitenStyleRoot } from "../src/style-root/kaiten-style-root.tsx";

afterEach(cleanup);

const client = {
  getCatalog: vi.fn(async () => ({ plans: [], entitlements: [] })),
  getLicensingSnapshot: vi.fn(async () => null),
} as never;

function provider(customerId: string, children: ReactNode) {
  return (
    <KaitenProvider mode="authenticated" accessToken="t" customerId={customerId} client={client}>
      {children}
    </KaitenProvider>
  );
}

test("the provider renders no DOM of its own", () => {
  const { container } = render(provider("provider-dom", <span data-testid="child">child</span>));

  // The child is the container's only element: no wrapper, no portal host. The
  // element every style is scoped to is the style root's to render, where the
  // host draws — a provider at an app's root must not join its layout.
  expect(container.querySelector(".kaiten")).toBeNull();
  expect(container.querySelector("[data-slot='kaiten-portal-host']")).toBeNull();
  expect(container.firstElementChild).toBe(screen.getByTestId("child"));
});

test("KaitenStyleRoot renders the scope root and the portal host", () => {
  const { container } = render(
    provider(
      "style-root-dom",
      <KaitenStyleRoot>
        <span data-testid="child">child</span>
      </KaitenStyleRoot>,
    ),
  );

  const root = container.querySelector(".kaiten");
  expect(root).not.toBeNull();
  expect(root?.classList.contains("w-full")).toBe(true);
  // Every SDK rule is scoped to this element, and portals mount inside it so
  // the tokens reach them too.
  expect(root?.querySelector("[data-slot='kaiten-portal-host']")).not.toBeNull();
  expect(root?.contains(screen.getByTestId("child"))).toBe(true);
});

test("KaitenStyleRoot applies its appearance as tokens on the scope root", () => {
  const { container } = render(
    provider(
      "style-root-appearance",
      <KaitenStyleRoot appearance={{ zIndex: 240, variables: { colorPrimary: "#0f766e" } }}>
        <span />
      </KaitenStyleRoot>,
    ),
  );

  const root = container.querySelector<HTMLElement>(".kaiten")!;
  expect(root.style.getPropertyValue("--ktn-z-portal")).toBe("240");
  // Mode-independent variables are written into BOTH namespaces, so they hold
  // whichever mode the cascade selects (see buildAppearanceStyle).
  expect(root.style.getPropertyValue("--ktn-light-primary")).toBe("#0f766e");
  expect(root.style.getPropertyValue("--ktn-dark-primary")).toBe("#0f766e");
});

test("control primitives stay silent without a style root", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  render(
    provider(
      "bare-control",
      <>
        <KaitenLoaded>
          <span />
        </KaitenLoaded>
        <Show when="entitled" entitlement="seats">
          <span />
        </Show>
      </>,
    ),
  );

  // They render only their children, so a missing style root costs them nothing.
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("a styled component warns that it will render unstyled without a style root", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  render(provider("bare-styled", <PlanBadge />));

  // Looking broken with no explanation is the worst outcome; name the fix.
  expect(warn).toHaveBeenCalled();
  const message = warn.mock.calls.map((call) => String(call[0])).join("\n");
  expect(message).toContain("PlanBadge");
  expect(message).toContain("KaitenStyleRoot");
  warn.mockRestore();
});

test("a style root gives the subtree its styling, and the warning goes away", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const { container } = render(
    provider(
      "styled-under-root",
      <KaitenStyleRoot>
        <PlanBadge />
      </KaitenStyleRoot>,
    ),
  );

  expect(container.querySelector(".kaiten")).not.toBeNull();
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("KaitenStyleRoot refuses to mount outside a provider", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  expect(() =>
    render(
      <KaitenStyleRoot>
        <span />
      </KaitenStyleRoot>,
    ),
  ).toThrow(/<KaitenStyleRoot> must be used within a <KaitenProvider>/);
  error.mockRestore();
});
