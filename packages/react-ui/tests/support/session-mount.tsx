// What a test of a billing component mounts: the provider of a customer session on a `sessionServer`,
// with the style root. And the small readers every such test needs.

import type { ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";

import type { KaitenLocalizationOverrides } from "../../src/index.ts";
import { API, type SessionServer } from "../../.storybook/session-server.ts";
import { KaitenProvider } from "./styled-provider.tsx";

export function mount(
  server: SessionServer,
  ui: ReactNode,
  locale?: KaitenLocalizationOverrides,
): RenderResult {
  return render(
    <KaitenProvider
      mode="customer-session"
      sessionClient={server.client}
      apiUrl={API}
      polling={{ enabled: false }}
      locale={locale}
    >
      {ui}
    </KaitenProvider>,
  );
}

/** Whether a control is out of use: `disabled`, or `aria-disabled` for one that keeps the keyboard's place. */
export const off = (element: Element): boolean =>
  (element as HTMLButtonElement).disabled === true ||
  element.getAttribute("aria-disabled") === "true";

/** Intl writes a non-breaking space between an amount and its symbol, in French a narrow one. */
export const flat = (text: string | null | undefined) => (text ?? "").replace(/[\s  ]+/g, " ");
