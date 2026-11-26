// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { createKaitenClient, KaitenError, ServiceAccounts } from "../src/index.ts";

// DELETE /service-accounts/{serviceAccountSlug} deletes a service account and
// revokes every token it still holds. The generated operation is the whole
// surface, as for revoking one of its tokens, so these tests run the README's
// example and pin what it sends and what a refusal throws.

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
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

const noContent = () => new Response(null, { status: 204 });

describe("ServiceAccounts.deleteServiceAccount", () => {
  test("deletes an account by its slug, with no body, and answers nothing", async () => {
    const { client, seen } = clientAnswering(noContent);

    const { response } = await ServiceAccounts.deleteServiceAccount({
      client,
      throwOnError: true,
      path: { serviceAccountSlug: "ci-deployer" },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("DELETE");
    expect(new URL(seen[0]!.url).pathname).toBe("/api/service-accounts/ci-deployer");
    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer ksh_vendor");
    expect(await seen[0]!.text()).toBe("");
    expect(response.status).toBe(204);
  });

  test("is a method of the class that revokes the account's tokens", async () => {
    const { client, seen } = clientAnswering(noContent);

    await ServiceAccounts.deleteServiceAccountToken({
      client,
      path: { serviceAccountSlug: "ci-deployer", tokenSlug: "deploy-token" },
    });
    await ServiceAccounts.deleteServiceAccount({
      client,
      path: { serviceAccountSlug: "ci-deployer" },
    });

    expect(seen.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "DELETE /api/service-accounts/ci-deployer/tokens/deploy-token",
      "DELETE /api/service-accounts/ci-deployer",
    ]);
  });

  test("a slug the organization holds no account under throws a KaitenError 404", async () => {
    const { client } = clientAnswering(() => problem(404, "ServiceAccount.NotFound"));

    const error = await ServiceAccounts.deleteServiceAccount({
      client,
      path: { serviceAccountSlug: "already-deleted" },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 404, code: "ServiceAccount.NotFound" });
  });
});
