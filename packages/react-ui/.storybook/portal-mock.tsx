// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the stories of a customer session's portal draw: the real session client, answering with what
// Kaiten answered for Initech (see `session-server.ts`). A story is a customer in one situation, and
// the situation is the portal it is given and the refusals it is scripted.

import * as React from "react";
import { SWRConfig } from "swr";

import { KaitenProvider, type KaitenLocalizationOverrides } from "@kaitencloud/react";

import { KaitenStyleRoot } from "../src/style-root/kaiten-style-root.tsx";
import { useIsolatedSWRCache } from "./kaiten-mock.tsx";
import { API, sessionServer, type PortalName, type Reply } from "./session-server.ts";

export { refusal } from "./session-server.ts";

export interface PortalStoryOptions {
  /** The portal the session reads: one Kaiten recorded, or one a story changed. */
  portal?: PortalName | Record<string, any>;
  /** The first page of invoices; the recorded one by default. */
  invoices?: unknown[];
  /** Whether older invoices follow them. */
  hasMore?: boolean;
  /** Answers for the next calls to `METHOD route`, in turn, instead of what the server would say. */
  scripts?: Record<string, Reply[]>;
  /** Calls take this long to answer. */
  delayMs?: number;
}

function PortalShell({
  options,
  locale,
  children,
}: {
  options: PortalStoryOptions;
  locale?: KaitenLocalizationOverrides;
  children: React.ReactNode;
}) {
  // Once for the story: a new session client is a new scope, with its own reads.
  const server = React.useMemo(() => {
    const created = sessionServer({ portal: options.portal, delayMs: options.delayMs });
    if (options.invoices) created.setInvoices(options.invoices, options.hasMore ?? false);
    for (const [key, replies] of Object.entries(options.scripts ?? {})) {
      created.script(key, ...replies);
    }
    return created;
  }, [options]);
  const provider = useIsolatedSWRCache();
  return (
    <SWRConfig value={{ provider }}>
      <KaitenProvider
        mode="customer-session"
        sessionClient={server.client}
        apiUrl={API}
        polling={{ enabled: false }}
        locale={locale}
      >
        <KaitenStyleRoot>{children}</KaitenStyleRoot>
      </KaitenProvider>
    </SWRConfig>
  );
}

/**
 * A decorator for a story whose customer is in the situation `options` script, in `locale`. Call it
 * once, where the story is defined: the options are the identity of the session it builds.
 */
export function portalDecorator(
  options: PortalStoryOptions = {},
  locale?: KaitenLocalizationOverrides,
) {
  return function Decorator(Story: () => React.JSX.Element) {
    return (
      <PortalShell options={options} locale={locale}>
        <Story />
      </PortalShell>
    );
  };
}
