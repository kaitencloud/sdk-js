import { OpenFeature } from "@openfeature/server-sdk";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { configureFlags, isEnabled } from "../src/flags.ts";

describe("isEnabled", () => {
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

    await expect(isEnabled("gradual-rollout", "user-123")).resolves.toBe(true);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(
      "https://api.example.com/api/ofrep/v1/evaluate/flags/gradual-rollout",
    );
    expect(request?.headers.get("authorization")).toBe("Bearer ksh_example");
    await expect(request?.json()).resolves.toMatchObject({
      context: { targetingKey: "user-123" },
    });
  });
});
