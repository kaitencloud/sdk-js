import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient } from "../src/client/client.ts";
import { KaitenError, KaitenNetworkError } from "../src/core/index.ts";

type FetchMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getFetchRequest(fetchMock: FetchMock, index = 0): Request {
  const input = fetchMock.mock.calls[index]?.[0];
  expect(input).toBeInstanceOf(Request);
  return input as Request;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KaitenTransport auth headers", () => {
  test("authScheme 'none' sends no auth headers even with a token provider", async () => {
    const fetchMock = vi.fn(async () => json({ id: "c", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      tokenProvider: () => "unused-token",
      fetch: fetchMock,
    });
    await client.getCustomer("acme");

    const request = getFetchRequest(fetchMock);
    expect(request.headers.get("Authorization")).toBeNull();
    expect(request.headers.get("X-Kaiten-Publishable-Key")).toBeNull();
  });

  test("bearer and publishable schemes are mutually exclusive", async () => {
    const bearerFetch = vi.fn(async () => json({ id: "c", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", bearerFetch);
    await new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "bearer",
      tokenProvider: () => "tok",
      fetch: bearerFetch,
    }).getCustomer("acme");
    const bearerReq = getFetchRequest(bearerFetch);
    expect(bearerReq.headers.get("Authorization")).toBe("Bearer tok");
    expect(bearerReq.headers.get("X-Kaiten-Publishable-Key")).toBeNull();

    const pkFetch = vi.fn(async () => json([]));
    vi.stubGlobal("fetch", pkFetch);
    await new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "publishable",
      tokenProvider: () => "pk_1",
      fetch: pkFetch,
    }).getCatalog();
    const pkReq = getFetchRequest(pkFetch);
    expect(pkReq.headers.get("X-Kaiten-Publishable-Key")).toBe("pk_1");
    expect(pkReq.headers.get("Authorization")).toBeNull();
  });

  test("omits auth headers when no token is provided", async () => {
    const fetchMock = vi.fn(async () => json({ id: "c", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);

    await new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "bearer",
      fetch: fetchMock,
    }).getCustomer("acme");

    expect(getFetchRequest(fetchMock).headers.get("Authorization")).toBeNull();
  });

  test("applies defaultHeaders to outgoing requests", async () => {
    const fetchMock = vi.fn(async () => json({ id: "c", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);

    await new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      defaultHeaders: { "X-Tenant": "acme" },
      fetch: fetchMock,
    }).getCustomer("acme");

    expect(getFetchRequest(fetchMock).headers.get("X-Tenant")).toBe("acme");
  });
});

describe("KaitenTransport Content-Type handling", () => {
  test("sets application/json on POST bodies but leaves GET requests untouched", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL((input as Request).url);
      if (url.pathname.includes("/ofrep/")) {
        return json({ key: "flag", value: true });
      }
      return json({ id: "c", slug: "acme", name: "Acme" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      fetch: fetchMock,
    });

    await client.getCustomer("acme");
    await client.evaluateFlag("flag", {});

    const getReq = fetchMock.mock.calls
      .map(([input]) => input as Request)
      .find((req) => req.method === "GET")!;
    const postReq = fetchMock.mock.calls
      .map(([input]) => input as Request)
      .find((req) => req.method === "POST")!;

    expect(getReq.headers.get("Content-Type")).toBeNull();
    expect(postReq.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("KaitenTransport timeout", () => {
  test("aborts in-flight requests after timeoutMs (wrapped as a network error)", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const req = input as Request;
      return new Promise<Response>((_resolve, reject) => {
        if (req.signal.aborted) {
          reject(new DOMException("Timed out", "TimeoutError"));
          return;
        }
        req.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Timed out", "TimeoutError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      timeoutMs: 20,
      fetch: fetchMock,
    });

    await expect(client.getCustomer("acme")).rejects.toBeInstanceOf(KaitenNetworkError);
    // Network errors are retried up to 3 attempts before giving up.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("KaitenTransport retry policy", () => {
  test("retries 5xx responses up to 3 attempts then rethrows", async () => {
    const fetchMock = vi.fn(async () => json({ title: "Server error", status: 500 }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      fetch: fetchMock,
    });

    await expect(client.getCustomer("acme")).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("does not retry 4xx responses", async () => {
    const fetchMock = vi.fn(async () => json({ title: "Bad request", status: 400 }, 400));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      fetch: fetchMock,
    });

    await expect(client.getCustomer("acme")).rejects.toBeInstanceOf(KaitenError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("KaitenTransport error mapping", () => {
  test("maps OFREP {errorCode, errorDetails} bodies onto KaitenError", async () => {
    const fetchMock = vi.fn(async () =>
      json({ errorCode: "PARSE_ERROR", errorDetails: "bad context" }, 422),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      fetch: fetchMock,
    });

    await expect(client.evaluateFlag("flag", {})).rejects.toMatchObject({
      message: "PARSE_ERROR",
      code: "PARSE_ERROR",
      status: 422,
      detail: "bad context",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("exposes the problem's code and errorId", async () => {
    const fetchMock = vi.fn(async () =>
      json(
        {
          title: "Not Found",
          status: 404,
          code: "Customer.NotFound",
          errorId: "3f6b1a2c-7c1e-4d0b-9d5f-2b0a1c4e8d31",
        },
        404,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      fetch: fetchMock,
    });

    await expect(client.getCustomer("acme")).rejects.toMatchObject({
      status: 404,
      code: "Customer.NotFound",
      errorId: "3f6b1a2c-7c1e-4d0b-9d5f-2b0a1c4e8d31",
    });
  });

  test("falls back to a generic error for non-conforming error bodies", async () => {
    const fetchMock = vi.fn(async () => json({ unexpected: "shape" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      fetch: fetchMock,
    });

    await expect(client.getCustomer("acme")).rejects.toMatchObject({
      message: "Unknown error",
      status: 400,
    });
  });
});
