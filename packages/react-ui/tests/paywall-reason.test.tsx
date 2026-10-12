// @vitest-environment jsdom
//
// A paywall reason this package does not know, as a later release may add: the wall comes up
// with the generic wording, names the reason in the DOM, and keeps the content
// behind it unreachable. The trigger is replaced, because no snapshot produces such
// a reason yet.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { PaywallTriggerResult } from "@kaitencloud/react";

const trigger = vi.hoisted(() => ({ current: undefined as PaywallTriggerResult | undefined }));

vi.mock("@kaitencloud/react", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/react")>();
  return { ...actual, usePaywallTrigger: () => trigger.current };
});

const { Paywall } = await import("../src/index.ts");
const { KaitenProvider } = await import("./support/styled-provider.tsx");

afterEach(cleanup);

function renderPaywall(mode: "soft" | "hard", unstyled = false) {
  trigger.current = {
    shouldShow: true,
    reason: "reason_added_later",
    current: 0,
    limit: 0,
    percentage: 0,
    metered: false,
    usageWindow: null,
    isLoading: false,
    error: null,
  };
  return render(
    <KaitenProvider mode="static" catalog={{ plans: [] }}>
      <Paywall entitlement="seats" mode={mode} unstyled={unstyled} onUpgrade={() => {}}>
        <button type="button">Protected</button>
      </Paywall>
    </KaitenProvider>,
  );
}

test.each([
  ["a soft wall", "soft", false],
  ["a hard wall", "hard", false],
  ["an unstyled wall", "soft", true],
] as const)(
  "%s names a reason it does not know and keeps the content out of reach",
  (_, mode, unstyled) => {
    const { container } = renderPaywall(mode, unstyled);

    expect(container.querySelector('[data-slot="paywall"]')?.getAttribute("data-reason")).toBe(
      "reason_added_later",
    );
    // The content sits under the wall, inert: neither reachable nor announced.
    expect(screen.getByText("Protected").closest("[inert]")).not.toBeNull();
  },
);
