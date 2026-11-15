// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { createKaitenClient, KaitenError, PublishableKeys } from "../src/index.ts";
import type { PagePublishableKey, PublishableKey, PublishableKeyCreated } from "../src/index.ts";

// A publishable key is issued by the backend, shown once, and handed to a web
// page that reads the public catalogue with it. These tests drive the generated
// PublishableKeys class the way the README does, against answers typed by the
// contract.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status < 400 ? "application/json" : "application/problem+json" },
  });

const problem = (status: number, code: string) => json({ title: "Refused", status, code }, status);

function clientAnswering(answer: (request: Request) => Response) {
  const seen: Request[] = [];
  const client = createKaitenClient({
    token: "ksh_vendor",
    baseUrl: "https://example.test",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push(request.clone());
      return answer(request);
    },
  });
  return { client, seen };
}

const KEY_ID = "3c9a4f60-1d2e-4b8a-9f7c-5e6d7c8b9a01";

const stored = (overrides: Partial<PublishableKey> = {}): PublishableKey => ({
  id: KEY_ID,
  label: "Marketing site",
  keyHint: "zAbc",
  allowedOrigins: ["https://www.example.com"],
  anonymousCheckout: false,
  turnstileSiteKey: null,
  turnstileSecretConfigured: false,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-10-12T09:00:00Z",
  updatedAt: "2026-10-12T09:00:00Z",
  ...overrides,
});

describe("PublishableKeys", () => {
  test("issues a key for the origins of a page, and shows it once", async () => {
    const created: PublishableKeyCreated = {
      ...stored(),
      key: "pk_3q2-7wEXAMPLEkeyBodyOfFortyThreeCharsXyzAbc",
    };
    const { client, seen } = clientAnswering(() => json(created, 201));

    const { data } = await PublishableKeys.createPublishableKey({
      client,
      throwOnError: true,
      body: { label: "Marketing site", allowedOrigins: ["https://www.example.com"] },
    });

    expect(seen[0]!.method).toBe("POST");
    expect(new URL(seen[0]!.url).pathname).toBe("/api/publishable-keys");
    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer ksh_vendor");
    expect(await seen[0]!.json()).toEqual({
      label: "Marketing site",
      allowedOrigins: ["https://www.example.com"],
    });
    // The plaintext is in this answer and no other: what is stored is its digest,
    // and a listing carries the last four characters.
    expect(data.key).toMatch(/^pk_[A-Za-z0-9_-]{43}$/);
    expect(data.key.endsWith(data.keyHint)).toBe(true);
  });

  test("a label that is empty, an origin that is not one and too many origins are 422s", async () => {
    for (const code of [
      "CreatePublishableKey.InvalidLabel",
      "CreatePublishableKey.InvalidOrigin",
      "CreatePublishableKey.TooManyOrigins",
    ]) {
      const { client } = clientAnswering(() => problem(422, code));

      const error = await PublishableKeys.createPublishableKey({
        client,
        body: { label: "", allowedOrigins: ["http://example.com"] },
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(KaitenError);
      expect(error).toMatchObject({ status: 422, code });
    }
  });

  test("lists the keys a page at a time, revoked ones on request, never the key itself", async () => {
    const page: PagePublishableKey = {
      hasMore: true,
      nextCursor: "next-1",
      items: [
        stored(),
        stored({ id: "0d1e2f30-4a5b-4c6d-8e7f-9a0b1c2d3e4f", revokedAt: "2026-10-11T00:00:00Z" }),
      ],
    };
    const { client, seen } = clientAnswering(() => json(page));

    const { data } = await PublishableKeys.listPublishableKeys({
      client,
      throwOnError: true,
      query: { includeRevoked: true, limit: 2 },
    });

    const url = new URL(seen[0]!.url);
    expect(seen[0]!.method).toBe("GET");
    expect(url.pathname).toBe("/api/publishable-keys");
    expect(url.searchParams.get("includeRevoked")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("2");
    expect(data.items.map((entry) => entry.keyHint)).toEqual(["zAbc", "zAbc"]);
    expect(data.items.some((entry) => "key" in entry)).toBe(false);
    expect(data.items[1]!.revokedAt).toBe("2026-10-11T00:00:00Z");
    expect(data.nextCursor).toBe("next-1");
  });

  test("changes the label or the origins of a live key", async () => {
    const changed = stored({
      allowedOrigins: ["https://www.example.com", "https://shop.example.com"],
    });
    const { client, seen } = clientAnswering(() => json(changed));

    const { data } = await PublishableKeys.updatePublishableKey({
      client,
      throwOnError: true,
      path: { keyId: KEY_ID },
      body: { allowedOrigins: ["https://www.example.com", "https://shop.example.com"] },
    });

    expect(seen[0]!.method).toBe("PATCH");
    expect(new URL(seen[0]!.url).pathname).toBe(`/api/publishable-keys/${KEY_ID}`);
    expect(await seen[0]!.json()).toEqual({
      allowedOrigins: ["https://www.example.com", "https://shop.example.com"],
    });
    expect(data.allowedOrigins).toHaveLength(2);
  });

  test("a revoked key can no longer be changed: a 409", async () => {
    const { client } = clientAnswering(() => problem(409, "UpdatePublishableKey.Revoked"));

    await expect(
      PublishableKeys.updatePublishableKey({
        client,
        path: { keyId: KEY_ID },
        body: { label: "Old site" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("revokes a key for good, and answers the key with its revocation date", async () => {
    const { client, seen } = clientAnswering(() =>
      json(stored({ revokedAt: "2026-10-12T10:00:00Z" })),
    );

    const { data } = await PublishableKeys.revokePublishableKey({
      client,
      throwOnError: true,
      path: { keyId: KEY_ID },
    });

    expect(seen[0]!.method).toBe("POST");
    expect(new URL(seen[0]!.url).pathname).toBe(`/api/publishable-keys/${KEY_ID}/revoke`);
    expect(data.revokedAt).toBe("2026-10-12T10:00:00Z");
  });

  test("an organization that cannot reach billing is refused with a 403", async () => {
    for (const code of ["Billing.Disabled", "Billing.NotEntitled"]) {
      const { client } = clientAnswering(() => problem(403, code));

      await expect(PublishableKeys.listPublishableKeys({ client })).rejects.toMatchObject({
        status: 403,
        code,
      });
    }
  });
});
