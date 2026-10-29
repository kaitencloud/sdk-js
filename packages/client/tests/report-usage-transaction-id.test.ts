// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  InvalidTransactionIdError,
  KaitenClient,
  KaitenError,
  KaitenNetworkError,
  TransactionIdReusedError,
} from "../src/index.ts";
import type { EntitlementUsage, KaitenClientLike, ReportUsageInput } from "../src/index.ts";

const USAGE_PATH = "/instances/acme-prod/entitlements/tokens/usage";

// What a server that predates the header answers: no `transactionId`.
const USAGE = {
  entitlementId: "0b6d0c1e-4f5c-4c8e-9d61-0f6a8d7f7a01",
  entitlementSlug: "tokens",
  licenseId: "6f1f9a54-2a4b-4d0e-8c1d-5b0a2f3e4d02",
  licenseSlug: "pro",
  source: "license",
  value: { type: "number", value: 500, eventCount: 1 },
  limit: { type: "number", value: 1000 },
  currentPeriodStart: "2026-10-01T00:00:00Z",
  currentPeriodEnd: "2026-11-01T00:00:00Z",
};

/** What a current server answers: the key the report was accepted under, or null. */
const echoing = (key: string | null) => ({ ...USAGE, transactionId: key });

type Reply = number | { status: number; body?: unknown; headers?: Record<string, string> } | Error;

interface Sent {
  at: number;
  method: string;
  contentType: string | null;
  /** The `Idempotency-Key` header of the request, `null` when it carried none. */
  key: string | null;
  headers: Headers;
  body: Record<string, unknown>;
  text: string;
}

/**
 * A fetch double that answers the usage endpoint with the queued replies, the
 * last one repeating: a bare status answers that status with a generic body, an
 * Error is a network failure.
 *
 * By default it is a current server: a 200 without a body of its own echoes the
 * key of the request as `transactionId`, null when there was none. With
 * `honours: false` it is a server that ignores the header and answers a report
 * as it always did, without the member.
 */
function stubServer(replies: Reply[], { honours = true }: { honours?: boolean } = {}) {
  const sent: Sent[] = [];
  let call = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    expect(new URL(request.url).pathname).toBe(USAGE_PATH);
    const text = await request.clone().text();
    const key = request.headers.get("Idempotency-Key");
    sent.push({
      at: Date.now(),
      method: request.method,
      contentType: request.headers.get("Content-Type"),
      key,
      headers: request.headers,
      body: JSON.parse(text) as Record<string, unknown>,
      text,
    });

    const reply = replies[Math.min(call, replies.length - 1)]!;
    call += 1;
    if (reply instanceof Error) throw reply;
    const { status, body, headers } = typeof reply === "number" ? { status: reply } : reply;
    const ok = status < 400;
    return new Response(
      JSON.stringify(
        ok ? (body ?? (honours ? echoing(key) : USAGE)) : (body ?? { title: "Failure", status }),
      ),
      {
        status,
        headers: {
          "Content-Type": ok ? "application/json" : "application/problem+json",
          ...headers,
        },
      },
    );
  });
  return { fetch, sent };
}

function clientFor(fetch: ReturnType<typeof stubServer>["fetch"]): KaitenClient {
  // No per-request timeout: its timer is not the retry schedule's.
  return new KaitenClient({ apiUrl: "https://api.test", authScheme: "none", fetch, timeoutMs: 0 });
}

/** Runs a report to completion, letting the retry schedule's timers fire. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
}

/**
 * A client that has read an echoed key, as one does after a first keyed report
 * to a current server, and the server it talks to: the replies queued here
 * answer the reports that follow.
 */
async function echoedClient(replies: Reply[]) {
  const server = stubServer([200, ...replies]);
  const client = clientFor(server.fetch);
  await settle(client.reportUsage("acme-prod", "tokens", keyed("first:0")));
  server.sent.length = 0;
  return { client, ...server };
}

const keyed = (transactionId = "llm:9f2c:tokens"): ReportUsageInput => ({
  value: { type: "number", value: 500 },
  behavior: "append",
  transactionId,
});

const unkeyed = (): ReportUsageInput => ({
  value: { type: "number", value: 500 },
  behavior: "append",
});

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// A keyed report is retried only once this client has read a key echoed by its
// server, so these tests start from a client that has.
describe("reportUsage with a transactionId, once the server has echoed a key", () => {
  test("retries a 5xx under the same key, with a growing delay, and resolves", async () => {
    // No jitter, so the schedule is readable.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { client, sent } = await echoedClient([
      {
        status: 503,
        body: {
          title: "Service Unavailable",
          status: 503,
          code: "ReportEntitlementUsageMetric.LedgerUnavailable",
        },
      },
      503,
      200,
    ]);

    const usage = await settle(client.reportUsage("acme-prod", "tokens", keyed()));

    expect(usage).toEqual(echoing("llm:9f2c:tokens"));
    expect(sent).toHaveLength(3);
    expect(sent.map((request) => request.key)).toEqual([
      "llm:9f2c:tokens",
      "llm:9f2c:tokens",
      "llm:9f2c:tokens",
    ]);
    const first = sent[1]!.at - sent[0]!.at;
    const second = sent[2]!.at - sent[1]!.at;
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  test("retries a network failure under the same key", async () => {
    const { client, sent } = await echoedClient([new TypeError("fetch failed"), 200]);

    await settle(client.reportUsage("acme-prod", "tokens", keyed()));

    expect(sent).toHaveLength(2);
    expect(sent[1]!.key).toBe("llm:9f2c:tokens");
  });

  test("stops after three attempts and rejects with the last failure", async () => {
    const { client, sent } = await echoedClient([503]);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(3);
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).status).toBe(503);
  });

  test.each([500, 502, 503, 504])(
    "a %i is retried under the same key, and the report resolves",
    async (status) => {
      const { client, sent } = await echoedClient([status, 200]);

      const usage = await settle(client.reportUsage("acme-prod", "tokens", keyed()));

      expect(usage).toEqual(echoing("llm:9f2c:tokens"));
      expect(sent.map((request) => request.key)).toEqual(["llm:9f2c:tokens", "llm:9f2c:tokens"]);
    },
  );

  // Another 5xx says the same thing every time: asking again only repeats it.
  test.each([501, 505, 507, 508, 511, 599])(
    "a %i is not retried: it rejects after one attempt",
    async (status) => {
      const { client, sent } = await echoedClient([status, 200]);

      const error = await settle(client.reportUsage("acme-prod", "tokens", keyed())).catch(
        (caught: unknown) => caught,
      );

      expect(sent).toHaveLength(1);
      expect(error).toBeInstanceOf(KaitenError);
      expect((error as KaitenError).status).toBe(status);
    },
  );

  test("a 4xx is not retried either", async () => {
    const { client, sent } = await echoedClient([400, 200]);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(1);
    expect((error as KaitenError).status).toBe(400);
  });

  test("a 501 after a network failure ends the retries", async () => {
    const { client, sent } = await echoedClient([new TypeError("fetch failed"), 501, 200]);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(2);
    expect((error as KaitenError).status).toBe(501);
  });

  test("a reused key rejects with TransactionIdReusedError after one attempt", async () => {
    const { client, sent } = await echoedClient([
      {
        status: 409,
        body: {
          title: "Conflict",
          status: 409,
          code: "ReportEntitlementUsageMetric.TransactionIdReused",
          errors: [
            {
              message: "the report this key was first accepted with",
              location: "header.Idempotency-Key",
              value: {
                reportSeq: 7,
                reportedAt: "2026-10-05T08:00:00.000Z",
                behavior: "append",
                value: 250,
              },
            },
          ],
        },
      },
    ]);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(1);
    expect(error).toBeInstanceOf(TransactionIdReusedError);
    expect(error).toBeInstanceOf(KaitenError);
    const reused = error as TransactionIdReusedError;
    expect(reused.status).toBe(409);
    expect(reused.code).toBe("ReportEntitlementUsageMetric.TransactionIdReused");
    expect(reused.kind).toBe("api");
    expect(reused.transactionId).toBe("llm:9f2c:tokens");
    expect(reused.original).toEqual({
      reportSeq: 7,
      reportedAt: "2026-10-05T08:00:00.000Z",
      behavior: "append",
      value: 250,
    });
  });

  test("a reused key without the original report still types the error", async () => {
    const { client } = await echoedClient([
      {
        status: 409,
        body: {
          title: "Conflict",
          status: 409,
          code: "ReportEntitlementUsageMetric.TransactionIdReused",
        },
      },
    ]);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TransactionIdReusedError);
    expect((error as TransactionIdReusedError).original).toBeUndefined();
  });

  // The client checks the format itself (see below), so this is a server that
  // judges a well-formed key differently: its answer is surfaced as it is typed.
  test("a key the server refuses as malformed rejects with InvalidTransactionIdError after one attempt, keys stay on", async () => {
    const { client, sent } = await echoedClient([
      {
        status: 422,
        body: {
          title: "Unprocessable Entity",
          status: 422,
          code: "ReportEntitlementUsageMetric.InvalidTransactionId",
          errors: [
            { message: "the key's format", location: "header.Idempotency-Key", value: "evt-1" },
          ],
        },
      },
      200,
    ]);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1"))).catch(
      (caught: unknown) => caught,
    );
    await settle(client.reportUsage("acme-prod", "tokens", keyed()));

    expect(error).toBeInstanceOf(InvalidTransactionIdError);
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as InvalidTransactionIdError).transactionId).toBe("evt-1");
    expect(sent).toHaveLength(2);
    expect(sent[1]!.key).toBe("llm:9f2c:tokens");
    expect(warn).not.toHaveBeenCalled();
  });

  test("ThresholdExceeded is surfaced as it was, after one attempt", async () => {
    const { client, sent } = await echoedClient([
      {
        status: 409,
        body: {
          title: "Conflict",
          status: 409,
          code: "ReportEntitlementUsageMetric.ThresholdExceeded",
        },
      },
    ]);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(1);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).not.toBeInstanceOf(TransactionIdReusedError);
    expect((error as KaitenError).code).toBe("ReportEntitlementUsageMetric.ThresholdExceeded");
  });

  test("the usage facade carries the key and the retry rule too", async () => {
    const { client, sent } = await echoedClient([503, 200]);

    await settle(client.usage.report("acme-prod", "tokens", keyed("evt-1")));

    expect(sent.map((request) => request.key)).toEqual(["evt-1", "evt-1"]);
  });
});

describe("reportUsage and the key a server echoes", () => {
  test("a keyed report resolves with the key the server accepted it under", async () => {
    const { fetch } = stubServer([200]);

    const usage = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed("evt-1")));

    expect(usage.transactionId).toBe("evt-1");
    expect(usage).toEqual(echoing("evt-1"));
  });

  test("a report without a key resolves with a null transactionId", async () => {
    const { fetch } = stubServer([200]);

    const usage = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", unkeyed()));

    expect(usage.transactionId).toBeNull();
  });

  test("a replay resolves with idempotentReplayed and the key", async () => {
    const { fetch } = stubServer([
      { status: 200, body: echoing("llm:9f2c:tokens"), headers: { "Idempotent-Replayed": "true" } },
    ]);

    const usage = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed()));

    expect(usage).toEqual({ ...echoing("llm:9f2c:tokens"), idempotentReplayed: true });
  });

  test("dropped metadata resolves with metadataDropped", async () => {
    const { fetch } = stubServer([
      { status: 200, headers: { "Kaiten-Metadata-Dropped": "too_large" } },
    ]);

    const usage = await settle(
      clientFor(fetch).reportUsage("acme-prod", "tokens", {
        ...keyed(),
        metadata: { blob: "x".repeat(5000) },
      }),
    );

    expect(usage).toEqual({ ...echoing("llm:9f2c:tokens"), metadataDropped: "too_large" });
    expect(usage.idempotentReplayed).toBeUndefined();
  });
});

// A server that honours the header says so by echoing the key. Until this
// client has read one, a keyed report is sent with its key but not known to be
// applied once, and a retry could count it twice.
describe("reportUsage before the server has echoed a key", () => {
  test("the first keyed report is sent once: a 5xx is not retried, and the key still goes", async () => {
    const { fetch, sent } = stubServer([503, 200]);

    const error = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]!.key).toBe("llm:9f2c:tokens");
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).status).toBe(503);
  });

  test("the first keyed report is sent once: a network failure is not retried", async () => {
    const { fetch, sent } = stubServer([new TypeError("fetch failed"), 200]);

    const error = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(1);
    expect(error).toBeInstanceOf(KaitenNetworkError);
  });

  test("an error is surfaced as the API typed it, without a retry", async () => {
    const { fetch, sent } = stubServer([
      {
        status: 409,
        body: {
          title: "Conflict",
          status: 409,
          code: "ReportEntitlementUsageMetric.TransactionIdReused",
        },
      },
    ]);

    const error = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(1);
    expect(error).toBeInstanceOf(TransactionIdReusedError);
  });

  test("the retries start with the report that follows the first echo", async () => {
    const { fetch, sent } = stubServer([200, 503, 200]);
    const client = clientFor(fetch);

    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1")));
    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-2")));

    expect(sent.map((request) => request.key)).toEqual(["evt-1", "evt-2", "evt-2"]);
  });

  test("a replay is an echo too", async () => {
    const { fetch, sent } = stubServer([
      { status: 200, body: echoing("evt-1"), headers: { "Idempotent-Replayed": "true" } },
      503,
      200,
    ]);
    const client = clientFor(fetch);

    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1")));
    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-2")));

    expect(sent).toHaveLength(3);
  });

  test("a report without a key teaches nothing: its null is not an echo", async () => {
    const { fetch, sent } = stubServer([200, 503, 200]);
    const client = clientFor(fetch);

    await settle(client.reportUsage("acme-prod", "tokens", unkeyed()));
    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(2);
    expect((error as KaitenError).status).toBe(503);
  });

  test("the memory is the client's: another client has to read an echo of its own", async () => {
    const taught = stubServer([200]);
    await settle(clientFor(taught.fetch).reportUsage("acme-prod", "tokens", keyed("evt-1")));

    const fresh = stubServer([503, 200]);
    const error = await settle(
      clientFor(fresh.fetch).reportUsage("acme-prod", "tokens", keyed("evt-1")),
    ).catch((caught: unknown) => caught);

    expect(fresh.sent).toHaveLength(1);
    expect((error as KaitenError).status).toBe(503);
  });
});

// A server that predates the header, or sits behind a proxy that drops it,
// ignores the key: it answers a report as it always did, without the member.
describe("reportUsage against a server that ignores the key", () => {
  test("sends the key on every report, never retries, and warns of nothing", async () => {
    const { fetch, sent } = stubServer([200, 503, 200, 500], { honours: false });
    const client = clientFor(fetch);

    const usage = await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1")));
    expect(usage).toEqual(USAGE);
    expect("transactionId" in usage).toBe(false);

    const failed = await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-2"))).catch(
      (caught: unknown) => caught,
    );
    expect((failed as KaitenError).status).toBe(503);

    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-3")));
    const failedAgain = await settle(
      client.reportUsage("acme-prod", "tokens", keyed("evt-4")),
    ).catch((caught: unknown) => caught);
    expect((failedAgain as KaitenError).status).toBe(500);

    expect(sent.map((request) => request.key)).toEqual(["evt-1", "evt-2", "evt-3", "evt-4"]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a null echo on a keyed report does not count as one", async () => {
    const { fetch, sent } = stubServer([{ status: 200, body: echoing(null) }, 503, 200]);
    const client = clientFor(fetch);

    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1")));
    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-2"))).catch(() => undefined);

    expect(sent).toHaveLength(2);
  });

  test("a 422 at the body is the generic refusal and is surfaced as it came", async () => {
    // The body is closed, so a body that carried a key would be refused like
    // this. The client never sends one; this is what a caller would see if a
    // proxy added a member of its own.
    const { fetch, sent } = stubServer([
      {
        status: 422,
        body: {
          title: "Unprocessable Entity",
          status: 422,
          code: "UNPROCESSABLE",
          errors: [{ message: "unexpected property", location: "body.extra", value: 1 }],
        },
      },
      200,
    ]);
    const client = clientFor(fetch);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1"))).catch(
      (caught: unknown) => caught,
    );
    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-2")));

    expect((error as KaitenError).status).toBe(422);
    expect(error).not.toBeInstanceOf(InvalidTransactionIdError);
    expect(sent.map((request) => request.key)).toEqual(["evt-1", "evt-2"]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a 422 at body.transactionId is not taken for an older server: one request, no resend, no warning", async () => {
    // What a server that predates the header answered when it did not know the
    // member. The client used to send the report again without its key and warn;
    // it now surfaces the refusal as any other, after a single request.
    const { fetch, sent } = stubServer([
      {
        status: 422,
        body: {
          title: "Unprocessable Entity",
          status: 422,
          errors: [
            { message: "unexpected property", location: "body.transactionId", value: "evt-1" },
          ],
        },
      },
      200,
    ]);
    const client = clientFor(fetch);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1"))).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).status).toBe(422);
    expect(error).not.toBeInstanceOf(InvalidTransactionIdError);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.key).toBe("evt-1");
    expect(sent[0]!.body).not.toHaveProperty("transactionId");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("reportUsage carries its key in the Idempotency-Key header, never in the body", () => {
  test("the key is the header, and the body is the report alone", async () => {
    const { fetch, sent } = stubServer([200]);
    const input: ReportUsageInput = {
      value: { type: "number", value: 12.5 },
      behavior: "set",
      metadata: { source: "batch", run: 3 },
      transactionId: "llm:9f2c:tokens",
    };

    await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", input));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.key).toBe("llm:9f2c:tokens");
    expect(sent[0]!.headers.get("idempotency-key")).toBe("llm:9f2c:tokens");
    expect(sent[0]!.text).toBe(
      '{"value":{"type":"number","value":12.5},"behavior":"set","metadata":{"source":"batch","run":3}}',
    );
    expect("transactionId" in sent[0]!.body).toBe(false);
  });

  test("a transactionId in the metadata is the caller's data and stays there", async () => {
    const { fetch, sent } = stubServer([200]);

    await settle(
      clientFor(fetch).reportUsage("acme-prod", "tokens", {
        ...keyed("the-key"),
        metadata: { transactionId: "not-the-key" },
      }),
    );

    expect(sent[0]!.key).toBe("the-key");
    expect(sent[0]!.body.metadata).toEqual({ transactionId: "not-the-key" });
    expect("transactionId" in sent[0]!.body).toBe(false);
  });

  test("a report without a key sends no header at all", async () => {
    const { fetch, sent } = stubServer([200]);

    await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", unkeyed()));

    expect(sent[0]!.headers.has("Idempotency-Key")).toBe(false);
  });

  test("an explicit undefined key sends no header either", async () => {
    const { fetch, sent } = stubServer([200]);

    await settle(
      clientFor(fetch).reportUsage("acme-prod", "tokens", {
        ...unkeyed(),
        transactionId: undefined,
      }),
    );

    expect(sent[0]!.headers.has("Idempotency-Key")).toBe(false);
  });

  test("the facade sends the key the same way, and only when given", async () => {
    const withKey = stubServer([200]);
    await settle(clientFor(withKey.fetch).usage.report("acme-prod", "tokens", keyed("evt-1")));
    expect(withKey.sent[0]!.key).toBe("evt-1");
    expect(withKey.sent[0]!.body).not.toHaveProperty("transactionId");

    const without = stubServer([200]);
    await settle(clientFor(without.fetch).usage.report("acme-prod", "tokens", unkeyed()));
    expect(without.sent[0]!.key).toBeNull();
    expect(without.sent[0]!.body).not.toHaveProperty("transactionId");
  });
});

describe("reportUsage with a malformed transactionId", () => {
  // An empty key is refused here too: the API reads an empty header as no key.
  const malformed = ["has space", "x".repeat(129), "a/b", "", "clé", "evt\n1", "evt#1"];

  test.each(malformed)(
    "refuses %j before anything is sent, with the error the API answers with",
    async (key) => {
      const { fetch, sent } = stubServer([200]);

      const error = await clientFor(fetch)
        .reportUsage("acme-prod", "tokens", keyed(key))
        .catch((caught: unknown) => caught);

      expect(sent).toHaveLength(0);
      expect(error).toBeInstanceOf(InvalidTransactionIdError);
      expect(error).toBeInstanceOf(KaitenError);
      const refused = error as InvalidTransactionIdError;
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("ReportEntitlementUsageMetric.InvalidTransactionId");
      expect(refused.kind).toBe("api");
      expect(refused.transactionId).toBe(key);
      expect(refused.errors?.[0]?.location).toBe("header.Idempotency-Key");
    },
  );

  test("a non-string key is refused before anything is sent", async () => {
    const { fetch, sent } = stubServer([200]);
    const input = { ...unkeyed(), transactionId: 42 } as unknown as ReportUsageInput;

    await expect(clientFor(fetch).reportUsage("acme-prod", "tokens", input)).rejects.toThrow(
      TypeError,
    );
    expect(sent).toHaveLength(0);
  });

  test("accepts the longest and the shortest well-formed keys, and every character the format allows", async () => {
    const { fetch, sent } = stubServer([200]);
    const client = clientFor(fetch);

    for (const key of ["x".repeat(128), "a", "AZaz09._:-"]) {
      await settle(client.reportUsage("acme-prod", "tokens", keyed(key)));
    }

    expect(sent.map((request) => request.key)).toEqual(["x".repeat(128), "a", "AZaz09._:-"]);
  });

  test("a refused key does not turn keys off for the client, and warns of nothing", async () => {
    const { fetch, sent } = stubServer([200]);
    const client = clientFor(fetch);

    await client.reportUsage("acme-prod", "tokens", keyed("no spaces")).catch(() => undefined);
    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1")));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.key).toBe("evt-1");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("reportUsage without a transactionId", () => {
  test("is sent once: a 5xx is not retried", async () => {
    const { fetch, sent } = stubServer([503, 200]);

    const error = await settle(
      clientFor(fetch).reportUsage("acme-prod", "tokens", unkeyed()),
    ).catch((caught: unknown) => caught);

    expect(sent).toHaveLength(1);
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).status).toBe(503);
  });

  test("is sent once: a network failure is not retried", async () => {
    const { fetch, sent } = stubServer([new TypeError("fetch failed"), 200]);

    const error = await settle(
      clientFor(fetch).reportUsage("acme-prod", "tokens", unkeyed()),
    ).catch((caught: unknown) => caught);

    expect(sent).toHaveLength(1);
    expect(error).toBeInstanceOf(KaitenNetworkError);
  });

  // A client that sends no key sends what the 1.0 client sent, byte for byte:
  // the client never makes a key up, and never adds an empty member.
  test("sends the caller's body byte for byte, with no key", async () => {
    const { fetch, sent } = stubServer([200]);
    const input: ReportUsageInput = {
      value: { type: "number", value: 12.5 },
      behavior: "set",
      metadata: { source: "batch", run: 3 },
    };

    const usage = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", input));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe(JSON.stringify(input));
    expect("transactionId" in sent[0]!.body).toBe(false);
    expect(sent[0]!.key).toBeNull();
    // Without the headers, the result is the body as it came.
    expect(usage).toEqual(echoing(null));
    expect("idempotentReplayed" in usage).toBe(false);
    expect("metadataDropped" in usage).toBe(false);
  });

  // What @kaitencloud/client 1.0.0 put on the wire for a report, recorded from
  // that release and kept as literal text: a report with no key is the caller's
  // object serialized as it was, in the order the caller wrote it, with no
  // member added. A change here is a change for every 1.0 caller.
  const SENT_BY_1_0_0: { name: string; input: ReportUsageInput; body: string }[] = [
    {
      name: "append a number",
      input: { value: { type: "number", value: 500 }, behavior: "append" },
      body: '{"value":{"type":"number","value":500},"behavior":"append"}',
    },
    {
      name: "set a fraction",
      input: { value: { type: "number", value: 12.5 }, behavior: "set" },
      body: '{"value":{"type":"number","value":12.5},"behavior":"set"}',
    },
    {
      name: "metadata, nested",
      input: {
        value: { type: "number", value: 3 },
        behavior: "append",
        metadata: { source: "batch", run: 3, tags: ["a", "b"], nested: { ok: true } },
      },
      body:
        '{"value":{"type":"number","value":3},"behavior":"append",' +
        '"metadata":{"source":"batch","run":3,"tags":["a","b"],"nested":{"ok":true}}}',
    },
    {
      name: "the caller's key order",
      input: { behavior: "set", value: { value: 0, type: "number" } },
      body: '{"behavior":"set","value":{"value":0,"type":"number"}}',
    },
    {
      name: "a boolean value",
      input: { value: { type: "boolean", value: true }, behavior: "set" },
      body: '{"value":{"type":"boolean","value":true},"behavior":"set"}',
    },
    {
      name: "an object value",
      input: {
        value: { type: "object", value: { tier: "gold", limits: { rps: 5 } } },
        behavior: "set",
      },
      body: '{"value":{"type":"object","value":{"tier":"gold","limits":{"rps":5}}},"behavior":"set"}',
    },
    {
      name: "a key left undefined",
      input: {
        value: { type: "number", value: 500 },
        behavior: "append",
        transactionId: undefined,
      },
      body: '{"value":{"type":"number","value":500},"behavior":"append"}',
    },
  ];

  test.each(SENT_BY_1_0_0)("sends what 1.0.0 sent, byte for byte: $name", async (golden) => {
    const { fetch, sent } = stubServer([200]);

    await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", golden.input));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe(golden.body);
    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.contentType).toBe("application/json");
  });

  // With a key the body is the same text: the key is a header, not a member,
  // so no golden body above changes when a report carries one.
  test.each(SENT_BY_1_0_0)(
    "a keyed report sends the same body as 1.0.0 sent, and the key in its header: $name",
    async (golden) => {
      const { fetch, sent } = stubServer([200]);

      await settle(
        clientFor(fetch).reportUsage("acme-prod", "tokens", {
          ...golden.input,
          transactionId: "llm:9f2c:tokens",
        }),
      );

      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toBe(golden.body);
      expect(sent[0]!.key).toBe("llm:9f2c:tokens");
    },
  );

  test("sends what 1.0.0 sent through the usage facade as well", async () => {
    const { fetch, sent } = stubServer([200]);
    const [golden] = SENT_BY_1_0_0;

    await settle(clientFor(fetch).usage.report("acme-prod", "tokens", golden!.input));

    expect(sent[0]!.text).toBe(golden!.body);
  });

  test("an explicit undefined key is no key", async () => {
    const { fetch, sent } = stubServer([503]);

    await settle(
      clientFor(fetch).reportUsage("acme-prod", "tokens", {
        ...unkeyed(),
        transactionId: undefined,
      }),
    ).catch(() => undefined);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe(JSON.stringify(unkeyed()));
  });
});

// The same cases, read through the facade and with the response headers
// together: what the usage report contract asks of any client, whichever way
// the report is sent.
describe("reportUsage, the contract's cases through the usage facade", () => {
  test("a keyed report is retried on a 503 under the same key once a key was echoed; an unkeyed one is not", async () => {
    const withKey = await echoedClient([
      {
        status: 503,
        body: {
          title: "Service Unavailable",
          status: 503,
          code: "ReportEntitlementUsageMetric.LedgerUnavailable",
        },
      },
      200,
    ]);
    await settle(withKey.client.usage.report("acme-prod", "tokens", keyed("evt-1")));
    expect(withKey.sent.map((request) => request.key)).toEqual(["evt-1", "evt-1"]);

    const without = await echoedClient([503, 200]);
    await expect(
      settle(without.client.usage.report("acme-prod", "tokens", unkeyed())),
    ).rejects.toBeInstanceOf(KaitenError);
    expect(without.sent).toHaveLength(1);
  });

  test("a reused key keeps the original report the API named, whole or not, and is not retried", async () => {
    const { client, sent } = await echoedClient([
      {
        status: 409,
        body: {
          title: "Conflict",
          status: 409,
          code: "ReportEntitlementUsageMetric.TransactionIdReused",
          errors: [
            {
              location: "header.Idempotency-Key",
              message: "the report this key was first accepted with",
              value: { reportSeq: 2 },
            },
          ],
        },
      },
    ]);

    const error = await settle(client.usage.report("acme-prod", "tokens", keyed("evt-1"))).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TransactionIdReusedError);
    expect(error).toBeInstanceOf(KaitenError);
    // The body is kept as the API sent it; `original` is only set from a whole report.
    expect((error as KaitenError).errors?.[0]?.value).toEqual({ reportSeq: 2 });
    expect((error as TransactionIdReusedError).original).toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  test("a replay and dropped metadata are both read from the headers", async () => {
    const { fetch } = stubServer([
      {
        status: 200,
        body: echoing("llm:9f2c:tokens"),
        headers: { "Idempotent-Replayed": "true", "Kaiten-Metadata-Dropped": "too_large" },
      },
    ]);

    const result = await settle(clientFor(fetch).usage.report("acme-prod", "tokens", keyed()));

    expect(result).toEqual({
      ...echoing("llm:9f2c:tokens"),
      idempotentReplayed: true,
      metadataDropped: "too_large",
    });

    const plain = stubServer([200]);
    const unmarked = await settle(
      clientFor(plain.fetch).usage.report("acme-prod", "tokens", unkeyed()),
    );
    expect(unmarked.idempotentReplayed).toBeUndefined();
    expect(unmarked.metadataDropped).toBeUndefined();
  });
});

// Everything above is additive to the 1.0 surface: code written against it
// keeps compiling. Checked by the type checker, run by `vp check`.
describe("reportUsage and the client-side timeout", () => {
  // The timeout aborts the request on the client; the server may well have
  // committed the report by then, so it is the case a retry could double-count.
  // The abort is a native timer, which the fake clock does not drive.
  function slowServer(answers: ("echo" | "hang")[]) {
    const keys: (string | null)[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      keys.push(request.headers.get("Idempotency-Key"));
      const answer = answers[Math.min(keys.length - 1, answers.length - 1)]!;
      if (answer === "echo") {
        return new Response(JSON.stringify(echoing(request.headers.get("Idempotency-Key"))), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Timed out", "TimeoutError"));
        if (request.signal.aborted) abort();
        else request.signal.addEventListener("abort", abort, { once: true });
      });
    });
    return { fetch, keys };
  }

  const timingOut = (fetch: ReturnType<typeof slowServer>["fetch"]) =>
    new KaitenClient({ apiUrl: "https://api.test", authScheme: "none", fetch, timeoutMs: 20 });

  test("a keyed report that times out is not sent again before an echo", async () => {
    vi.useRealTimers();
    const { fetch, keys } = slowServer(["hang"]);

    await expect(
      timingOut(fetch).reportUsage("acme-prod", "tokens", keyed("evt-1")),
    ).rejects.toBeInstanceOf(KaitenNetworkError);

    expect(keys).toEqual(["evt-1"]);
  });

  test("a keyed report that times out is sent again, under its key, once an echo was read", async () => {
    vi.useRealTimers();
    const { fetch, keys } = slowServer(["echo", "hang"]);
    const client = timingOut(fetch);
    await client.reportUsage("acme-prod", "tokens", keyed("first:0"));

    await expect(client.reportUsage("acme-prod", "tokens", keyed("evt-1"))).rejects.toBeInstanceOf(
      KaitenNetworkError,
    );

    expect(keys).toEqual(["first:0", "evt-1", "evt-1", "evt-1"]);
  });
});

describe("1.0 compatibility", () => {
  test("a 1.0 double and a 1.0 reader still type-check", async () => {
    const legacyInput: { value: ReportUsageInput["value"]; behavior: "append" | "set" } = {
      value: { type: "number", value: 1 },
      behavior: "append",
    };
    // A double written against 1.0, resolving the plain usage row.
    const legacy: Pick<KaitenClientLike, "reportUsage"> = {
      reportUsage: async (_instance: string, _entitlement: string, _input: typeof legacyInput) =>
        USAGE as EntitlementUsage,
    };
    // A reader written against 1.0, typing the result as the usage row.
    const usage: EntitlementUsage = await legacy.reportUsage("acme-prod", "tokens", legacyInput);

    expect(usage).toEqual(USAGE);
  });
});
