// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import {
  createKaitenClient,
  CustomerSessions,
  isRateLimited,
  KaitenError,
  Public,
} from "../src/index.ts";
import type { Client, CreatedCustomerSession, CustomerSessionDraft } from "../src/index.ts";

// A customer session is minted by the backend where the customer is signed in,
// handed to that customer's browser, replaced before it ends and revoked on
// sign-out. These tests run the README's example against answers typed by the
// contract, and hold what the README says of the lifetime and the rate limit to
// what the SDK sends and reads back.

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": status < 400 ? "application/json" : "application/problem+json",
      ...headers,
    },
  });

const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
  json({ title: "Refused", status, code }, status, headers);

function clientAnswering(
  answer: (request: Request, nth: number) => Response | Promise<Response>,
  token = "ksh_vendor",
) {
  const seen: Request[] = [];
  const client = createKaitenClient({
    token,
    baseUrl: "https://example.test",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push(request.clone());
      return answer(request, seen.length - 1);
    },
  });
  return { client, seen };
}

const minted = (
  nth: number,
  draft: CustomerSessionDraft,
  at = Date.parse("2026-10-12T09:00:00Z"),
): CreatedCustomerSession => ({
  id: `00000000-0000-4000-8000-00000000000${nth}`,
  token: `kst_session-number-${nth}`,
  expiresAt: new Date(at + (draft.ttlSeconds ?? 1800) * 1000).toISOString(),
  customerSlug: draft.customerSlug,
  ...(draft.instanceSlug === undefined ? {} : { instanceSlug: draft.instanceSlug }),
});

/** The endpoint of the README: what a page calls to get a session for its signed-in customer. */
async function sessionForPage(client: Client, customerSlug: string, instanceSlug?: string) {
  const { data: session } = await CustomerSessions.createCustomerSession({
    client,
    throwOnError: true,
    body: { customerSlug, instanceSlug, ttlSeconds: 1800 },
  });
  return { token: session.token, expiresAt: session.expiresAt };
}

const body = async (request: Request) => (await request.json()) as Record<string, unknown>;

describe("CustomerSessions.createCustomerSession", () => {
  test("mints a session for a customer and one of its instances, for the lifetime it is given", async () => {
    const { client, seen } = clientAnswering(async (request) =>
      json(minted(1, (await body(request)) as unknown as CustomerSessionDraft), 201),
    );

    const { data } = await CustomerSessions.createCustomerSession({
      client,
      throwOnError: true,
      body: { customerSlug: "acme", instanceSlug: "acme-prod", ttlSeconds: 600 },
    });

    expect(seen[0]!.method).toBe("POST");
    expect(new URL(seen[0]!.url).pathname).toBe("/api/customer-sessions");
    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer ksh_vendor");
    expect(await body(seen[0]!)).toEqual({
      customerSlug: "acme",
      instanceSlug: "acme-prod",
      ttlSeconds: 600,
    });
    expect(data.token).toMatch(/^kst_/);
    expect(data.expiresAt).toBe("2026-10-12T09:10:00.000Z");
    expect(data).toMatchObject({ customerSlug: "acme", instanceSlug: "acme-prod" });
  });

  test("sends only the customer when nothing else is asked, and the API's default applies", async () => {
    const { client, seen } = clientAnswering(() => json(minted(1, { customerSlug: "acme" }), 201));

    const { data } = await CustomerSessions.createCustomerSession({
      client,
      throwOnError: true,
      body: { customerSlug: "acme" },
    });

    expect(await body(seen[0]!)).toEqual({ customerSlug: "acme" });
    // 30 minutes from the mint, when no ttlSeconds is sent.
    expect(data.expiresAt).toBe("2026-10-12T09:30:00.000Z");
    expect(data.instanceSlug).toBeUndefined();
  });

  test("hands the page the token and when it ends, and keeps the id for the revocation", async () => {
    const { client } = clientAnswering(() => json(minted(1, { customerSlug: "acme" }), 201));

    const forPage = await sessionForPage(client, "acme");

    expect(Object.keys(forPage).sort((a, b) => a.localeCompare(b))).toEqual(["expiresAt", "token"]);
    expect(forPage.token).toBe("kst_session-number-1");
  });

  test.for([299, 3601, 0, -1])(
    "a lifetime of %i seconds is sent as it is, and the API's 422 is thrown",
    async (ttlSeconds) => {
      const { client, seen } = clientAnswering(() =>
        problem(422, "CreateCustomerSession.InvalidTtl"),
      );

      const error = await CustomerSessions.createCustomerSession({
        client,
        body: { customerSlug: "acme", ttlSeconds },
      }).catch((caught: unknown) => caught);

      // The bounds are the API's to say, 300 to 3600 today: the SDK clamps nothing.
      expect(await body(seen[0]!)).toEqual({ customerSlug: "acme", ttlSeconds });
      expect(error).toBeInstanceOf(KaitenError);
      expect(error).toMatchObject({ status: 422 });
    },
  );

  test("the bounds of a lifetime are accepted as they are", async () => {
    const { client, seen } = clientAnswering(async (request) =>
      json(minted(1, (await body(request)) as unknown as CustomerSessionDraft), 201),
    );

    for (const ttlSeconds of [300, 3600]) {
      await CustomerSessions.createCustomerSession({
        client,
        body: { customerSlug: "acme", ttlSeconds },
      });
    }

    expect(await Promise.all(seen.map(body))).toEqual([
      { customerSlug: "acme", ttlSeconds: 300 },
      { customerSlug: "acme", ttlSeconds: 3600 },
    ]);
  });

  test("a customer or an instance that does not exist is a 404, and another customer's instance a 422", async () => {
    const cases = [
      [404, "CreateCustomerSession.CustomerNotFound"],
      [404, "CreateCustomerSession.InstanceNotFound"],
      [422, "CreateCustomerSession.InstanceNotOfCustomer"],
    ] as const;
    for (const [status, code] of cases) {
      const { client } = clientAnswering(() => problem(status, code));

      await expect(
        CustomerSessions.createCustomerSession({
          client,
          body: { customerSlug: "acme", instanceSlug: "globex-prod" },
        }),
      ).rejects.toMatchObject({ status, code });
    }
  });

  test("past the rate limit it is a 429 with the wait, thrown once and never sent again", async () => {
    const { client, seen } = clientAnswering(() =>
      problem(429, "CreateCustomerSession.RateLimited", { "Retry-After": "1" }),
    );

    const error = await sessionForPage(client, "acme").catch((caught: unknown) => caught);

    expect(isRateLimited(error)).toBe(true);
    expect((error as KaitenError).retryAfterSeconds).toBe(1);
    expect(seen).toHaveLength(1);
  });

  test("an organization that cannot reach billing is refused with a 403, or a 503 when that cannot be told", async () => {
    for (const [status, code] of [
      [403, "Billing.Disabled"],
      [403, "Billing.NotEntitled"],
      [503, "Billing.EntitlementCheckUnavailable"],
    ] as const) {
      const { client } = clientAnswering(() => problem(status, code));

      await expect(sessionForPage(client, "acme")).rejects.toMatchObject({ status, code });
    }
  });
});

describe("replacing a session before it ends", () => {
  test("is a new mint: the new session has its own token and id, and the old one is left to expire", async () => {
    let nth = 0;
    const { client, seen } = clientAnswering(async (request) => {
      nth += 1;
      const draft = (await body(request)) as unknown as CustomerSessionDraft;
      // The second one is minted 25 minutes later, five before the first ends.
      return json(
        minted(nth, draft, Date.parse("2026-10-12T09:00:00Z") + (nth - 1) * 25 * 60_000),
        201,
      );
    });

    const first = await CustomerSessions.createCustomerSession({
      client,
      throwOnError: true,
      body: { customerSlug: "acme", ttlSeconds: 1800 },
    });
    const second = await CustomerSessions.createCustomerSession({
      client,
      throwOnError: true,
      body: { customerSlug: "acme", ttlSeconds: 1800 },
    });

    expect(second.data.token).not.toBe(first.data.token);
    expect(second.data.id).not.toBe(first.data.id);
    expect(Date.parse(second.data.expiresAt)).toBeGreaterThan(Date.parse(first.data.expiresAt));
    // Two mints and nothing else: the first session is not revoked by the second.
    expect(seen.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/customer-sessions",
      "/api/customer-sessions",
    ]);
  });
});

describe("CustomerSessions.revokeCustomerSession", () => {
  const SESSION_ID = "00000000-0000-4000-8000-000000000001";

  test("ends a session by its id and answers nothing", async () => {
    const { client, seen } = clientAnswering(() => new Response(null, { status: 204 }));

    const result = await CustomerSessions.revokeCustomerSession({
      client,
      throwOnError: true,
      path: { sessionId: SESSION_ID },
    });

    expect(seen[0]!.method).toBe("POST");
    expect(new URL(seen[0]!.url).pathname).toBe(`/api/customer-sessions/${SESSION_ID}/revoke`);
    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer ksh_vendor");
    expect(result.response.status).toBe(204);
  });

  test("is safe to repeat: the second revocation answers 204 as well", async () => {
    const { client } = clientAnswering(() => new Response(null, { status: 204 }));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { response } = await CustomerSessions.revokeCustomerSession({
        client,
        throwOnError: true,
        path: { sessionId: SESSION_ID },
      });
      expect(response.status).toBe(204);
    }
  });

  test("a session the organization does not have is a 404", async () => {
    const { client } = clientAnswering(() => problem(404, "RevokeCustomerSession.NotFound"));

    await expect(
      CustomerSessions.revokeCustomerSession({ client, path: { sessionId: "unknown" } }),
    ).rejects.toMatchObject({ status: 404, code: "RevokeCustomerSession.NotFound" });
  });
});

describe("a backend acting through a session it minted", () => {
  test("builds a client whose token is the session's kst_, and reaches the session routes with it", async () => {
    const { client, seen } = clientAnswering(
      () => json({ customer: { slug: "acme" } }),
      "kst_session-number-1",
    );

    await Public.getSessionPortal({ client, throwOnError: true });

    expect(seen[0]!.method).toBe("GET");
    expect(new URL(seen[0]!.url).pathname).toBe("/api/public/session/portal");
    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer kst_session-number-1");
  });
});
