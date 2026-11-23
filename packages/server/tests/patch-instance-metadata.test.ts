// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { createKaitenClient, Instances, KaitenError } from "../src/index.ts";
import type { PatchInstanceBody } from "../src/index.ts";

// PATCH /instances/{instanceSlug} merges `metadata` into the instance's stored metadata
// at the first level: a key sent is set, a key sent as null is removed, and a key not
// sent is kept. The body is the whole contract, so these tests pin the bytes the
// generated operation sends, the way the README calls it.

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

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

const noContent = () => new Response(null, { status: 204 });

describe("Instances.patchInstance with metadata", () => {
  test("sends only the keys it names, a removal as null", async () => {
    const { client, seen } = clientAnswering(noContent);

    await Instances.patchInstance({
      client,
      path: { instanceSlug: "sakura-tokyo-prod" },
      body: { metadata: { region: "eu-west", "legacy-plan": null } },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("PATCH");
    expect(new URL(seen[0]!.url).pathname).toBe("/api/instances/sakura-tokyo-prod");
    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer ksh_vendor");
    expect(seen[0]!.headers.get("content-type")).toMatch(/^application\/json/);
    // `null` survives serialization: dropped, it would turn a removal into nothing.
    // Neither status nor lifecycleStage is sent, so neither is changed.
    expect(await seen[0]!.text()).toBe('{"metadata":{"region":"eu-west","legacy-plan":null}}');
  });

  test("a list or an object is sent whole, since it replaces the stored value whole", async () => {
    const { client, seen } = clientAnswering(noContent);
    const body: PatchInstanceBody = {
      metadata: { tags: ["a", "b"], contact: { name: "Aiko", team: "ops" } },
    };

    await Instances.patchInstance({ client, path: { instanceSlug: "sakura-tokyo-prod" }, body });

    expect(await seen[0]!.json()).toEqual({
      metadata: { tags: ["a", "b"], contact: { name: "Aiko", team: "ops" } },
    });
  });

  test("goes alongside a status change in one request", async () => {
    const { client, seen } = clientAnswering(noContent);

    await Instances.patchInstance({
      client,
      path: { instanceSlug: "sakura-tokyo-prod" },
      body: { status: "MAINTENANCE", metadata: { "maintenance-window": "2026-12-01T02:00Z" } },
    });

    expect(await seen[0]!.json()).toEqual({
      status: "MAINTENANCE",
      metadata: { "maintenance-window": "2026-12-01T02:00Z" },
    });
  });

  test("leaves the caller's object as it was", async () => {
    const { client } = clientAnswering(noContent);
    const metadata = { region: "eu-west", "legacy-plan": null };

    await Instances.patchInstance({
      client,
      path: { instanceSlug: "sakura-tokyo-prod" },
      body: { metadata },
    });

    expect(metadata).toEqual({ region: "eu-west", "legacy-plan": null });
  });

  test("a merged result a declared metadata field refuses throws a KaitenError with its code", async () => {
    const { client } = clientAnswering(() =>
      json(
        {
          title: "Unprocessable Entity",
          status: 422,
          code: "MetadataValidation.Failed",
          detail: "metadata does not satisfy the resource schema: items must be unique",
        },
        422,
      ),
    );

    const error = await Instances.patchInstance({
      client,
      path: { instanceSlug: "sakura-tokyo-prod" },
      body: { metadata: { regions: ["eu", "eu"] } },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({
      status: 422,
      code: "MetadataValidation.Failed",
      detail: "metadata does not satisfy the resource schema: items must be unique",
    });
  });
});
