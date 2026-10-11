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

const USAGE = {
  entitlementId: "0b6d0c1e-4f5c-4c8e-9d61-0f6a8d7f7a01",
  entitlementSlug: "tokens",
  licenseId: "6f1f9a54-2a4b-4d0e-8c1d-5b0a2f3e4d02",
  licenseSlug: "pro",
  value: { type: "number", value: 500, eventCount: 1 },
  limit: { type: "number", value: 1000 },
  currentPeriodStart: "2026-10-01T00:00:00Z",
  currentPeriodEnd: "2026-11-01T00:00:00Z",
};

type Reply = number | { status: number; body?: unknown; headers?: Record<string, string> } | Error;

interface Sent {
  at: number;
  body: Record<string, unknown>;
  text: string;
}

/**
 * A fetch double that answers the usage endpoint with the queued replies, the
 * last one repeating: a bare status answers that status with a generic body, an
 * Error is a network failure.
 */
function stubServer(replies: Reply[]) {
  const sent: Sent[] = [];
  let call = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    expect(new URL(request.url).pathname).toBe(USAGE_PATH);
    const text = await request.clone().text();
    sent.push({ at: Date.now(), body: JSON.parse(text) as Record<string, unknown>, text });

    const reply = replies[Math.min(call, replies.length - 1)]!;
    call += 1;
    if (reply instanceof Error) throw reply;
    const { status, body, headers } = typeof reply === "number" ? { status: reply } : reply;
    const ok = status < 400;
    return new Response(
      JSON.stringify(ok ? (body ?? USAGE) : (body ?? { title: "Failure", status })),
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

const keyed = (transactionId = "llm:9f2c:tokens"): ReportUsageInput => ({
  value: { type: "number", value: 500 },
  behavior: "append",
  transactionId,
});

const unkeyed = (): ReportUsageInput => ({
  value: { type: "number", value: 500 },
  behavior: "append",
});

/** The 422 a server that predates transactionId answers: its body is closed. */
const UNKNOWN_MEMBER = {
  status: 422,
  body: {
    title: "Unprocessable Entity",
    status: 422,
    detail: "validation failed",
    code: "UNPROCESSABLE",
    errors: [
      { message: "unexpected property", location: "body.transactionId", value: { value: 500 } },
    ],
  },
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reportUsage with a transactionId", () => {
  test("retries a 5xx under the same key, with a growing delay, and resolves", async () => {
    // No jitter, so the schedule is readable.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, sent } = stubServer([
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

    const usage = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed()));

    expect(usage).toEqual(USAGE);
    expect(sent).toHaveLength(3);
    expect(sent.map((request) => request.body.transactionId)).toEqual([
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
    const { fetch, sent } = stubServer([new TypeError("fetch failed"), 200]);

    await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed()));

    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.transactionId).toBe("llm:9f2c:tokens");
  });

  test("stops after three attempts and rejects with the last failure", async () => {
    const { fetch, sent } = stubServer([503]);

    const error = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(3);
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).status).toBe(503);
  });

  test.each([500, 502, 503, 504])(
    "a %i is retried under the same key, and the report resolves",
    async (status) => {
      const { fetch, sent } = stubServer([status, 200]);

      const usage = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed()));

      expect(usage).toEqual(USAGE);
      expect(sent.map((request) => request.body.transactionId)).toEqual([
        "llm:9f2c:tokens",
        "llm:9f2c:tokens",
      ]);
    },
  );

  // Another 5xx says the same thing every time: asking again only repeats it.
  test.each([501, 505, 507, 508, 511, 599])(
    "a %i is not retried: it rejects after one attempt",
    async (status) => {
      const { fetch, sent } = stubServer([status, 200]);

      const error = await settle(
        clientFor(fetch).reportUsage("acme-prod", "tokens", keyed()),
      ).catch((caught: unknown) => caught);

      expect(sent).toHaveLength(1);
      expect(error).toBeInstanceOf(KaitenError);
      expect((error as KaitenError).status).toBe(status);
    },
  );

  test("a 4xx is not retried either", async () => {
    const { fetch, sent } = stubServer([400, 200]);

    const error = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(1);
    expect((error as KaitenError).status).toBe(400);
  });

  test("a 501 after a network failure ends the retries", async () => {
    const { fetch, sent } = stubServer([new TypeError("fetch failed"), 501, 200]);

    const error = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(2);
    expect((error as KaitenError).status).toBe(501);
  });

  test("a reused key rejects with TransactionIdReusedError after one attempt", async () => {
    const { fetch, sent } = stubServer([
      {
        status: 409,
        body: {
          title: "Conflict",
          status: 409,
          code: "ReportEntitlementUsageMetric.TransactionIdReused",
          errors: [
            {
              message: "the report this transactionId was first accepted with",
              location: "body.transactionId",
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

    const error = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed())).catch(
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
    const { fetch } = stubServer([
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

    expect(error).toBeInstanceOf(TransactionIdReusedError);
    expect((error as TransactionIdReusedError).original).toBeUndefined();
  });

  // The client checks the format itself (see below), so this is a server that
  // judges a well-formed key differently: its answer is surfaced as it is typed.
  test("a key the server refuses as malformed rejects with InvalidTransactionIdError after one attempt, keys stay on", async () => {
    const { fetch, sent } = stubServer([
      {
        status: 422,
        body: {
          title: "Unprocessable Entity",
          status: 422,
          code: "ReportEntitlementUsageMetric.InvalidTransactionId",
        },
      },
      200,
    ]);
    const client = clientFor(fetch);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1"))).catch(
      (caught: unknown) => caught,
    );
    await settle(client.reportUsage("acme-prod", "tokens", keyed()));

    expect(error).toBeInstanceOf(InvalidTransactionIdError);
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as InvalidTransactionIdError).transactionId).toBe("evt-1");
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.transactionId).toBe("llm:9f2c:tokens");
    expect(warn).not.toHaveBeenCalled();
  });

  test("ThresholdExceeded is surfaced as it was, after one attempt", async () => {
    const { fetch, sent } = stubServer([
      {
        status: 409,
        body: {
          title: "Conflict",
          status: 409,
          code: "ReportEntitlementUsageMetric.ThresholdExceeded",
        },
      },
    ]);

    const error = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed())).catch(
      (caught: unknown) => caught,
    );

    expect(sent).toHaveLength(1);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).not.toBeInstanceOf(TransactionIdReusedError);
    expect((error as KaitenError).code).toBe("ReportEntitlementUsageMetric.ThresholdExceeded");
  });

  test("a replay resolves with idempotentReplayed", async () => {
    const { fetch } = stubServer([{ status: 200, headers: { "Idempotent-Replayed": "true" } }]);

    const usage = await settle(clientFor(fetch).reportUsage("acme-prod", "tokens", keyed()));

    expect(usage).toEqual({ ...USAGE, idempotentReplayed: true });
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

    expect(usage).toEqual({ ...USAGE, metadataDropped: "too_large" });
    expect(usage.idempotentReplayed).toBeUndefined();
  });

  test("a non-string key is refused before anything is sent", async () => {
    const { fetch, sent } = stubServer([200]);
    const input = { ...unkeyed(), transactionId: 42 } as unknown as ReportUsageInput;

    await expect(clientFor(fetch).reportUsage("acme-prod", "tokens", input)).rejects.toThrow(
      TypeError,
    );
    expect(sent).toHaveLength(0);
  });

  test("the usage facade carries the key too", async () => {
    const { fetch, sent } = stubServer([503, 200]);

    await settle(clientFor(fetch).usage.report("acme-prod", "tokens", keyed("evt-1")));

    expect(sent.map((request) => request.body.transactionId)).toEqual(["evt-1", "evt-1"]);
  });
});

describe("reportUsage with a malformed transactionId", () => {
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
      expect(refused.errors?.[0]?.location).toBe("body.transactionId");
    },
  );

  test("accepts the longest and the shortest well-formed keys, and every character the format allows", async () => {
    const { fetch, sent } = stubServer([200]);
    const client = clientFor(fetch);

    for (const key of ["x".repeat(128), "a", "AZaz09._:-"]) {
      await settle(client.reportUsage("acme-prod", "tokens", keyed(key)));
    }

    expect(sent.map((request) => request.body.transactionId)).toEqual([
      "x".repeat(128),
      "a",
      "AZaz09._:-",
    ]);
  });

  test("a refused key does not turn keys off for the client, and warns of nothing", async () => {
    const { fetch, sent } = stubServer([200]);
    const client = clientFor(fetch);

    await client.reportUsage("acme-prod", "tokens", keyed("no spaces")).catch(() => undefined);
    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1")));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.transactionId).toBe("evt-1");
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
    // Without the headers, the result is the body as it came.
    expect(usage).toEqual(USAGE);
    expect("idempotentReplayed" in usage).toBe(false);
    expect("metadataDropped" in usage).toBe(false);
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

describe("reportUsage against a server that predates transactionId", () => {
  test("sends the refused report again without its key, warns once, then reports without keys or retries", async () => {
    const { fetch, sent } = stubServer([UNKNOWN_MEMBER, 200, 500, 200]);
    const client = clientFor(fetch);

    // 1. The refused report goes again, without its key, and resolves: the
    //    closed body is refused before anything is counted, so it counts once.
    const usage = await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1")));
    expect(usage).toEqual(USAGE);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body.transactionId).toBe("evt-1");
    expect(sent[1]!.text).toBe(JSON.stringify(unkeyed()));

    // 2. Keys are off for the life of the client: no key, so no retry of the 500.
    const failed = await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-2"))).catch(
      (caught: unknown) => caught,
    );
    expect(sent).toHaveLength(3);
    expect("transactionId" in sent[2]!.body).toBe(false);
    expect((failed as KaitenError).status).toBe(500);

    // 3. And the next one goes through, still without its key.
    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-3")));
    expect(sent).toHaveLength(4);
    expect(sent[3]!.text).toBe(JSON.stringify(unkeyed()));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      "transactionId is not supported by this Kaiten server",
    );
  });

  test("the report sent again is sent once: a failure of the second attempt is not retried", async () => {
    const { fetch, sent } = stubServer([UNKNOWN_MEMBER, 503, 200]);

    const error = await settle(
      clientFor(fetch).reportUsage("acme-prod", "tokens", keyed("evt-1")),
    ).catch((caught: unknown) => caught);

    expect(sent).toHaveLength(2);
    expect("transactionId" in sent[1]!.body).toBe(false);
    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).status).toBe(503);
  });

  test("only a 422 reads as an unknown member: a 400 at the same place is surfaced as it is", async () => {
    const { fetch, sent } = stubServer([
      {
        status: 400,
        body: {
          title: "Bad Request",
          status: 400,
          code: "BAD_REQUEST",
          errors: [{ message: "unexpected property", location: "body.transactionId" }],
        },
      },
      200,
    ]);
    const client = clientFor(fetch);

    const error = await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-1"))).catch(
      (caught: unknown) => caught,
    );
    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-2")));

    expect((error as KaitenError).status).toBe(400);
    expect(sent.map((request) => request.body.transactionId)).toEqual(["evt-1", "evt-2"]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a 422 on another member says nothing about keys", async () => {
    const { fetch, sent } = stubServer([
      {
        status: 422,
        body: {
          title: "Unprocessable Entity",
          status: 422,
          code: "UNPROCESSABLE",
          errors: [{ message: "expected number", location: "body.value", value: "x" }],
        },
      },
    ]);
    const client = clientFor(fetch);

    for (const id of ["evt-3", "evt-4"]) {
      const error = await settle(client.reportUsage("acme-prod", "tokens", keyed(id))).catch(
        (caught: unknown) => caught,
      );
      expect((error as KaitenError).status).toBe(422);
    }

    expect(sent.map((request) => request.body.transactionId)).toEqual(["evt-3", "evt-4"]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("an unkeyed report refused the same way does not turn keys off", async () => {
    const { fetch, sent } = stubServer([UNKNOWN_MEMBER, 200]);
    const client = clientFor(fetch);

    await settle(client.reportUsage("acme-prod", "tokens", unkeyed())).catch(() => undefined);
    await settle(client.reportUsage("acme-prod", "tokens", keyed("evt-5")));

    expect(sent[1]!.body.transactionId).toBe("evt-5");
    expect(warn).not.toHaveBeenCalled();
  });

  test("another client is not affected", async () => {
    const old = stubServer([UNKNOWN_MEMBER]);
    await settle(clientFor(old.fetch).reportUsage("acme-prod", "tokens", keyed("evt-6"))).catch(
      () => undefined,
    );

    const current = stubServer([200]);
    await settle(clientFor(current.fetch).reportUsage("acme-prod", "tokens", keyed("evt-6")));

    expect(current.sent[0]!.body.transactionId).toBe("evt-6");
  });
});

// The same cases, read through the facade and with the response headers
// together: what the usage report contract asks of any client, whichever way
// the report is sent.
describe("reportUsage, the contract's cases through the usage facade", () => {
  test("sends the key only when given", async () => {
    const withKey = stubServer([200]);
    await settle(clientFor(withKey.fetch).usage.report("acme-prod", "tokens", keyed("evt-1")));
    expect(withKey.sent[0]!.body).toMatchObject({ transactionId: "evt-1" });

    const without = stubServer([200]);
    await settle(clientFor(without.fetch).usage.report("acme-prod", "tokens", unkeyed()));
    expect(without.sent[0]!.body).not.toHaveProperty("transactionId");
  });

  test("a keyed report is retried on a 503 under the same key; an unkeyed one is not", async () => {
    const withKey = stubServer([
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
    await settle(clientFor(withKey.fetch).usage.report("acme-prod", "tokens", keyed("evt-1")));
    expect(withKey.sent.map((request) => request.body.transactionId)).toEqual(["evt-1", "evt-1"]);

    const without = stubServer([503, 200]);
    await expect(
      settle(clientFor(without.fetch).usage.report("acme-prod", "tokens", unkeyed())),
    ).rejects.toBeInstanceOf(KaitenError);
    expect(without.sent).toHaveLength(1);
  });

  test("a reused key keeps the original report the API named, whole or not, and is not retried", async () => {
    const { fetch, sent } = stubServer([
      {
        status: 409,
        body: {
          title: "Conflict",
          status: 409,
          code: "ReportEntitlementUsageMetric.TransactionIdReused",
          errors: [
            {
              location: "body.transactionId",
              message: "the report this transactionId was first accepted with",
              value: { reportSeq: 2 },
            },
          ],
        },
      },
    ]);

    const error = await settle(
      clientFor(fetch).usage.report("acme-prod", "tokens", keyed("evt-1")),
    ).catch((caught: unknown) => caught);

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
        headers: { "Idempotent-Replayed": "true", "Kaiten-Metadata-Dropped": "too_large" },
      },
    ]);

    const result = await settle(clientFor(fetch).usage.report("acme-prod", "tokens", keyed()));

    expect(result).toEqual({ ...USAGE, idempotentReplayed: true, metadataDropped: "too_large" });

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
