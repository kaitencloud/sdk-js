// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { createServer } from "node:http";
import { OpenFeature } from "@openfeature/server-sdk";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { configureFlags, isEnabled } from "../src/flags.ts";

describe("isEnabled", () => {
  test("official provider keeps request identities separate and refreshes caller-owned auth", async () => {
    const requests: { path?: string; authorization?: string; context: unknown }[] = [];
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push({
        path: req.url,
        authorization: req.headers.authorization,
        context: JSON.parse(body).context,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ key: "beta", value: true, reason: "STATIC" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No loopback listener");
    try {
      let token = "ksh_test_one";
      await configureFlags(`http://127.0.0.1:${address.port}/gateway/api`, () => token);
      await expect(isEnabled("beta", "alice", "prod-a")).resolves.toBe(true);
      token = "ksh_test_two";
      await expect(isEnabled("beta", "bob", "prod-b")).resolves.toBe(true);
      expect(requests).toEqual([
        {
          path: "/gateway/api/ofrep/v1/evaluate/flags/beta",
          authorization: "Bearer ksh_test_one",
          context: { targetingKey: "alice", kaiten: { instanceSlug: "prod-a" } },
        },
        {
          path: "/gateway/api/ofrep/v1/evaluate/flags/beta",
          authorization: "Bearer ksh_test_two",
          context: { targetingKey: "bob", kaiten: { instanceSlug: "prod-b" } },
        },
      ]);
      await expect(
        Promise.all([isEnabled("beta", "charlie", "prod-c"), isEnabled("beta", "dana", "prod-d")]),
      ).resolves.toEqual([true, true]);
      expect(requests.slice(2).map((request) => request.context)).toEqual(
        expect.arrayContaining([
          { targetingKey: "charlie", kaiten: { instanceSlug: "prod-c" } },
          { targetingKey: "dana", kaiten: { instanceSlug: "prod-d" } },
        ]),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test.each([401, 403, 500])(
    "provider HTTP %s failures use the false OpenFeature default",
    async (status) => {
      await configureFlags(
        "https://api.test/api",
        "ksh_test",
        (async () =>
          new Response(JSON.stringify({ errorCode: "GENERAL", errorDetails: "unavailable" }), {
            status,
            headers: { "content-type": "application/json" },
          })) as typeof fetch,
      );
      await expect(isEnabled("beta", "alice")).resolves.toBe(false);
    },
  );

  test("wrong-type values and network outages never enable a boolean flag", async () => {
    await configureFlags(
      "https://api.test/api",
      "ksh_test",
      (async () =>
        new Response(JSON.stringify({ key: "beta", value: "not-a-boolean", reason: "STATIC" }), {
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    );
    await expect(isEnabled("beta", "alice")).resolves.toBe(false);
    await configureFlags("https://api.test/api", "ksh_test", (async () => {
      throw new TypeError("Offline");
    }) as typeof fetch);
    await expect(isEnabled("beta", "bob")).resolves.toBe(false);
  });

  afterEach(async () => {
    await OpenFeature.close();
  });

  test("evaluates one flag through Kaiten's OFREP endpoint", async () => {
    const requests: Request[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(
        JSON.stringify({
          key: "gradual-rollout",
          value: true,
          reason: "TARGETING_MATCH",
          variant: "on",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    await configureFlags("https://api.example.com/api", "ksh_example", fakeFetch);

    await expect(isEnabled("gradual-rollout", "user-123", "prod")).resolves.toBe(true);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(
      "https://api.example.com/api/ofrep/v1/evaluate/flags/gradual-rollout",
    );
    expect(request?.headers.get("authorization")).toBe("Bearer ksh_example");
    await expect(request?.json()).resolves.toMatchObject({
      context: { targetingKey: "user-123", kaiten: { instanceSlug: "prod" } },
    });
  });
});
