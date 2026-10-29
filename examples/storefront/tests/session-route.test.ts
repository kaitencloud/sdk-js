// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { createKaitenClient } from "@kaitencloud/server";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { SESSION_PATH, sessionRoute } from "../server/session-route.ts";

const SERVER_TOKEN = `ksh_${"s".repeat(43)}`;
const MINTED = `kst_${"k".repeat(43)}`;

interface Sent {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

/** A Kaiten that answers the minting route, and keeps what it was asked. */
function kaiten(answer: (sent: Sent) => Response | Promise<Response>) {
  const received: Sent[] = [];
  const fetchKaiten: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    const sent = {
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      body: text ? JSON.parse(text) : undefined,
    };
    received.push(sent);
    return answer(sent);
  };
  const route = sessionRoute({
    client: createKaitenClient({
      baseUrl: "https://kaiten.test",
      token: SERVER_TOKEN,
      fetch: fetchKaiten,
    }),
    customerSlug: "initech",
    instanceSlug: "initech-lab",
  });
  return { route, received };
}

const minted = () =>
  new Response(
    JSON.stringify({
      id: "00000000-0000-4000-8000-0000000000aa",
      token: MINTED,
      expiresAt: "2026-10-13T12:30:00Z",
      customerSlug: "initech",
      instanceSlug: "initech-lab",
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );

const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({ type: "about:blank", title: "Refused", status, detail: "the detail", code }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );

const post = (headers: Record<string, string> = {}) =>
  new Request(`https://storefront.test${SESSION_PATH}`, { method: "POST", headers });

afterEach(() => vi.restoreAllMocks());

describe("the route that mints a customer's session", () => {
  test("mints a session for the customer and the instance, with the server token", async () => {
    const { route, received } = kaiten(minted);

    const response = await route(post());

    expect(received).toEqual([
      {
        url: "https://kaiten.test/api/customer-sessions",
        method: "POST",
        authorization: `Bearer ${SERVER_TOKEN}`,
        body: { customerSlug: "initech", instanceSlug: "initech-lab", ttlSeconds: 1800 },
      },
    ]);
    expect(response?.status).toBe(200);
    // The page gets the session and when it ends, which is what `getCustomerSession` returns: not the
    // server's token, and not the id that revokes the session.
    expect(await response?.json()).toEqual({ token: MINTED, expiresAt: "2026-10-13T12:30:00Z" });
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  test("is not for any other path, and takes a POST only", async () => {
    const { route, received } = kaiten(minted);

    expect(
      await route(new Request("https://storefront.test/storefront-api/other", { method: "POST" })),
    ).toBeUndefined();
    const refused = await route(new Request(`https://storefront.test${SESSION_PATH}`));
    expect(refused?.status).toBe(405);
    expect(refused?.headers.get("allow")).toBe("POST");
    expect(received).toEqual([]);
  });

  test("answers a page of another origin with nothing, and mints nothing", async () => {
    const { route, received } = kaiten(minted);

    const elsewhere = await route(post({ Origin: "https://elsewhere.test" }));
    const itself = await route(post({ Origin: "https://storefront.test" }));

    expect(elsewhere?.status).toBe(403);
    expect(itself?.status).toBe(200);
    expect(received).toHaveLength(1);
  });

  test("passes on the wait Kaiten asks for when it limits the minting", async () => {
    const { route } = kaiten(() =>
      problem(429, "CreateCustomerSession.RateLimited", { "Retry-After": "7" }),
    );

    const response = await route(post());

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("7");
    expect(await response?.json()).toEqual({ error: "rate_limited" });
  });

  test.each([
    [
      "a customer Kaiten does not know",
      () => problem(404, "CreateCustomerSession.CustomerNotFound"),
    ],
    ["a token Kaiten refuses", () => problem(401, "Auth.InvalidCredential")],
    ["a Kaiten that fails", () => problem(500, "Internal")],
    [
      "a Kaiten that cannot be reached",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("says that the session is unavailable, and nothing of why, for %s", async (_name, answer) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { route } = kaiten(answer);

    const response = await route(post());

    expect(response?.status).toBe(502);
    const text = await response!.text();
    expect(JSON.parse(text)).toEqual({ error: "session_unavailable" });
    // What Kaiten said, and the token the request carried, stay out of the page and out of the log.
    expect(text).not.toContain("the detail");
    expect(JSON.stringify(log.mock.calls)).not.toContain(SERVER_TOKEN);
    expect(log).toHaveBeenCalledOnce();
  });
});
