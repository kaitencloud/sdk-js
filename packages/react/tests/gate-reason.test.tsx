// @vitest-environment jsdom
//
// The reasons of a paywall are an open union: a later release may add some, and a
// gate that listed the blocking ones would let a reason it had never heard of through.
// The trigger is replaced here, because no snapshot produces a reason this package
// does not know.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { PaywallTriggerResult } from "../src/hooks/use-paywall-trigger.ts";

const trigger = vi.hoisted(() => ({ current: undefined as PaywallTriggerResult | undefined }));

vi.mock("../src/hooks/use-paywall-trigger.ts", () => ({
  usePaywallTrigger: () => trigger.current,
}));

const { Gate } = await import("../src/components/control/gate.tsx");
const { KaitenProvider } = await import("../src/providers/kaiten-provider.tsx");

afterEach(cleanup);

function triggerWith(overrides: Partial<PaywallTriggerResult>): PaywallTriggerResult {
  return {
    shouldShow: true,
    reason: null,
    current: 0,
    limit: 0,
    percentage: 0,
    metered: false,
    usageWindow: null,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

function renderGate(overrides: Partial<PaywallTriggerResult>) {
  trigger.current = triggerWith(overrides);
  render(
    <KaitenProvider mode="static" catalog={{ plans: [] }}>
      <Gate entitlement="seats">
        {({ allowed, blocked, warning, reason }) => (
          <span data-testid="state">{`${allowed}/${blocked}/${warning}/${reason}`}</span>
        )}
      </Gate>
    </KaitenProvider>,
  );
  return screen.getByTestId("state").textContent;
}

test("a reason this package does not know is a block, since a wall is up", () => {
  expect(renderGate({ reason: "reason_added_later" })).toBe("false/true/false/reason_added_later");
});

test("the nudge before the limit is a warning and no block", () => {
  expect(renderGate({ reason: "near_limit" })).toBe("true/false/true/near_limit");
});

test("every reason the package produces keeps blocking, an outage included", () => {
  for (const reason of ["over_limit", "not_entitled", "flag_disabled", "error"]) {
    cleanup();
    expect(renderGate({ reason })).toBe(`false/true/false/${reason}`);
  }
});

test("no wall, no block", () => {
  expect(renderGate({ shouldShow: false, reason: null })).toBe("true/false/false/null");
});
