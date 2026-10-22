// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the suites of the anonymous checkout share: a provider with the checkout client double and a
// catalogue that says the publishable key may start one, and a stand-in for Cloudflare's script that
// solves the widget the way Turnstile's test key does: at once, with a token of its own each time.

import type { ReactNode } from "react";
import { act } from "@testing-library/react";
import type { KaitenAnonymousCheckoutClientLike, KaitenCatalog } from "@kaitencloud/client";

import { KaitenProvider } from "../../src/index.ts";
import type { TurnstileApi, TurnstileRenderParameters } from "../../src/hooks/billing/turnstile.ts";

/** Cloudflare's published site key that always passes, for tests and stories. */
export const TEST_SITE_KEY = "1x00000000000000000000AA";

export interface FakeWidget {
  id: string;
  container: HTMLElement;
  parameters: TurnstileRenderParameters;
  removed: boolean;
  resets: number;
}

export interface FakeTurnstile {
  api: TurnstileApi;
  widgets: FakeWidget[];
  /** The tokens given so far, in order. */
  tokens: string[];
  /** The widget on screen now, if any. */
  live: () => FakeWidget | undefined;
  /** Solves the live widget, as the visitor would. */
  solve: (token?: string) => void;
  /** Makes the live widget report an error. */
  fail: (code?: string) => void;
  /** Makes the token of the live widget expire. */
  expire: () => void;
  uninstall: () => void;
}

/**
 * Puts a `window.turnstile` in the page. With `autoSolve` (the default) every widget solves itself the
 * moment it is drawn, and again when it is reset, the way Turnstile's test key does.
 */
export function installFakeTurnstile({ autoSolve = true } = {}): FakeTurnstile {
  const widgets: FakeWidget[] = [];
  const tokens: string[] = [];
  let count = 0;
  const solveWidget = (widget: FakeWidget, token?: string) => {
    const given = token ?? `turnstile-token-${++count}`;
    tokens.push(given);
    widget.parameters.callback?.(given);
  };
  const api: TurnstileApi = {
    render(container, parameters) {
      const widget: FakeWidget = {
        id: `widget-${widgets.length + 1}`,
        container,
        parameters,
        removed: false,
        resets: 0,
      };
      widgets.push(widget);
      if (autoSolve) queueMicrotask(() => !widget.removed && solveWidget(widget));
      return widget.id;
    },
    reset(id) {
      const widget = widgets.find((each) => each.id === id && !each.removed);
      if (!widget) return;
      widget.resets += 1;
      if (autoSolve) queueMicrotask(() => !widget.removed && solveWidget(widget));
    },
    remove(id) {
      const widget = widgets.find((each) => each.id === id);
      if (widget) widget.removed = true;
    },
  };
  (globalThis as { turnstile?: TurnstileApi }).turnstile = api;
  const live = () => widgets.findLast((each) => !each.removed);
  return {
    api,
    widgets,
    tokens,
    live,
    solve: (token) => {
      const widget = live();
      if (widget) solveWidget(widget, token);
    },
    fail: (code) => live()?.parameters["error-callback"]?.(code),
    expire: () => live()?.parameters["expired-callback"]?.(),
    uninstall: () => {
      delete (globalThis as { turnstile?: TurnstileApi }).turnstile;
    },
  };
}

/** The catalogue a visitor reads: nothing to sell here, and the capability that lets them buy. */
export const anonymousCatalog = (
  capabilities: KaitenCatalog["capabilities"] = {
    checkout: true,
    paymentMethods: true,
    anonymousCheckout: true,
    turnstileSiteKey: TEST_SITE_KEY,
  },
): KaitenCatalog => ({ plans: [], capabilities });

/** The provider of a page that sells to visitors, on a checkout client. */
export function anonymousProvider(
  client: KaitenAnonymousCheckoutClientLike | undefined,
  catalog: KaitenCatalog = anonymousCatalog(),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KaitenProvider mode="static" catalog={catalog} anonymousCheckoutClient={client}>
        {children}
      </KaitenProvider>
    );
  };
}

/** Lets the widget solve itself and the calls it started settle. */
export async function flush(times = 4) {
  for (let turn = 0; turn < times; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
