// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the tests of the session client share: a clock, a fetch double that
// records its requests, and a client with a session already held.

import { afterEach, beforeEach, vi } from "vite-plus/test";

import { KaitenSessionClient } from "../../src/index.ts";
import type { KaitenCustomerSession, KaitenSessionClientConfig } from "../../src/index.ts";

export const T0 = Date.parse("2026-10-06T10:00:00.000Z");
export const MINUTE = 60_000;
export const KST_A = `kst_${"A".repeat(43)}`;
export const KST_B = `kst_${"B".repeat(43)}`;

/** A JSON answer, or a problem when the status is an error. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": status < 400 ? "application/json" : "application/problem+json",
      ...headers,
    },
  });
}

/** A fetch double recording every request; `reply` decides each answer. */
export function server(reply: (request: Request, index: number) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input as Request;
    requests.push(request);
    return reply(request, requests.length - 1);
  });
  return { fetch, requests };
}

/** A host callback handing out the queued sessions, the last one repeating. */
export function sessions(...queued: KaitenCustomerSession[]) {
  let call = 0;
  return vi.fn(async () => queued[Math.min(call++, queued.length - 1)]!);
}

export const session = (token: string, expiresAt: number): KaitenCustomerSession => ({
  token,
  expiresAt: new Date(expiresAt).toISOString(),
});

export function sessionClient(
  fetch: (input: RequestInfo | URL) => Promise<Response>,
  getCustomerSession: () => Promise<KaitenCustomerSession>,
  onAuthError: NonNullable<KaitenSessionClientConfig["onAuthError"]> = vi.fn(),
) {
  return new KaitenSessionClient({
    apiUrl: "https://api.acme.test/api",
    fetch,
    getCustomerSession,
    onAuthError,
  });
}

/** A session client holding a session that has half an hour left, over a fetch double. */
export function open(reply: (request: Request, index: number) => Response | Promise<Response>) {
  const { fetch, requests } = server(reply);
  return {
    fetch,
    requests,
    client: sessionClient(fetch, sessions(session(KST_A, T0 + 30 * MINUTE))),
  };
}

/** The method, the route (below `/api`) with its query, and the body, of each request. */
export async function sent(requests: readonly Request[]) {
  return Promise.all(
    requests.map(async (request) => {
      const url = new URL(request.url);
      return [
        request.method,
        `${url.pathname.replace(/^\/api/, "")}${url.search}`,
        (await request.clone().text()) || undefined,
      ] as const;
    }),
  );
}

/** Fixes the clock at {@link T0} for a test file; only the date, so retry delays stay real. */
export function useSessionClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
