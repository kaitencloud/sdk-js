import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient, KaitenError } from "../src/index.ts";

const CATALOG = JSON.parse(
  readFileSync(new URL("./fixtures/public-catalog.acme.json", import.meta.url), "utf8"),
) as { plans: unknown[] };

const PK = `pk_${"a".repeat(43)}`;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": status < 400 ? "application/json" : "application/problem+json",
      ...headers,
    },
  });
}

function publicClient(fetch: (input: RequestInfo | URL) => Promise<Response>, token = PK) {
  const onDegraded = vi.fn();
  const onAuthError = vi.fn();
  const client = new KaitenClient({
    apiUrl: "https://api.acme.test/api",
    authScheme: "publishable",
    tokenProvider: () => token,
    fetch,
    onDegraded,
    onAuthError,
  });
  return { client, onDegraded, onAuthError };
}

const requestOf = (call: unknown[]): Request => call[0] as Request;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public mode reads the catalogue from /public/catalog only", () => {
  test("one GET with the publishable key in its header, no Authorization, no cookie", async () => {
    const fetch = vi.fn(async () => json(CATALOG));
    const { client, onDegraded } = publicClient(fetch);

    const catalog = await client.getCatalog();

    expect(fetch).toHaveBeenCalledTimes(1);
    const request = requestOf(fetch.mock.calls[0]!);
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://api.acme.test/api/public/catalog");
    expect(request.headers.get("X-Kaiten-Publishable-Key")).toBe(PK);
    expect(request.headers.get("Authorization")).toBeNull();
    expect(request.credentials).toBe("omit");
    expect(catalog.plans).toHaveLength(8);
    expect(onDegraded).not.toHaveBeenCalled();
  });

  test("a 401 rejects with the API's code, reports it once and falls back to nothing", async () => {
    const fetch = vi.fn(async () =>
      json({ title: "Unauthorized", status: 401, code: "PublicAuth.InvalidCredential" }, 401),
    );
    const { client, onDegraded, onAuthError } = publicClient(fetch);

    const failure = await client.getCatalog().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(KaitenError);
    expect(failure).toMatchObject({ status: 401, code: "PublicAuth.InvalidCredential" });
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(onAuthError.mock.calls[0]![0]).toMatchObject({
      status: 401,
      operation: "getCatalog()",
    });
    // No GraphQL to degrade from and no REST to degrade to.
    expect(onDegraded).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("a 429 exposes Retry-After and is not replayed", async () => {
    const fetch = vi.fn(async () =>
      json({ title: "Too many requests", status: 429, code: "PublicAuth.RateLimited" }, 429, {
        "Retry-After": "7",
      }),
    );
    const { client } = publicClient(fetch);

    const failure = await client.getCatalog().catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 429, retryAfterSeconds: 7 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("a secret key in a browser is refused before any request", async () => {
    vi.stubGlobal("window", { document: {} });
    const fetch = vi.fn(async () => json(CATALOG));
    const { client } = publicClient(fetch, "ksh_live_secret");

    const failure = await client.getCatalog().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(KaitenError);
    expect((failure as KaitenError).detail).toContain("ksh_");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a key that is not a publishable key is refused before any request", async () => {
    const fetch = vi.fn(async () => json(CATALOG));
    const { client } = publicClient(fetch, "not-a-key");

    await expect(client.getCatalog()).rejects.toMatchObject({ status: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("every other read or write is refused locally: a publishable key is never sent there", async () => {
    const fetch = vi.fn(async () => json({}));
    const { client, onAuthError } = publicClient(fetch);

    const calls = [
      () => client.getLicensingSnapshot("acme"),
      () => client.getCustomer("acme"),
      () => client.listLicenses(),
      () => client.evaluateFlags(),
      () =>
        client.reportUsage("acme-prod", "seats", {
          value: { type: "number", value: 1 },
          behavior: "append",
        }),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({
        status: 0,
        message: "Not available with a publishable key",
      });
    }

    expect(fetch).not.toHaveBeenCalled();
    expect(onAuthError).not.toHaveBeenCalled();
  });

  test("a bearer client still composes the catalogue over GraphQL", async () => {
    const fetch = vi.fn(async () => json({ data: { licenses: { items: [], hasMore: false } } }));
    const client = new KaitenClient({
      apiUrl: "https://api.acme.test/api",
      authScheme: "bearer",
      tokenProvider: () => "ksh_server",
      fetch,
    });

    await client.getCatalog();

    expect(requestOf(fetch.mock.calls[0]!).url).toBe("https://api.acme.test/api/graphql");
  });
});
