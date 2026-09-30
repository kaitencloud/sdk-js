import { describe, expect, it } from "vite-plus/test";

import { KaitenTransport } from "../../src/core/transport.ts";
import type { KaitenFetch } from "../../src/core/config.ts";

/** Minimal fetch stub: records requests and replies with the queued statuses. */
function stubFetch(statuses: number[]): { fetch: KaitenFetch; requests: Request[] } {
  const requests: Request[] = [];
  let call = 0;

  const fetch: KaitenFetch = async (input, init) => {
    requests.push(new Request(input as RequestInfo, init));
    const status = statuses[Math.min(call, statuses.length - 1)];
    call += 1;
    return new Response(status === 204 ? null : JSON.stringify({ ok: true }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetch, requests };
}

function transportWith(fetch: KaitenFetch): KaitenTransport {
  return new KaitenTransport({ authScheme: "bearer", apiUrl: "https://example.test/api", fetch });
}

describe("retry and idempotency", () => {
  it("retries a read on 5xx", async () => {
    const { fetch, requests } = stubFetch([500, 500, 200]);

    await transportWith(fetch).get("/entitlements");

    expect(requests).toHaveLength(3);
  });

  it("never replays a write on 5xx", async () => {
    const { fetch, requests } = stubFetch([500]);

    await expect(transportWith(fetch).post("/usage", { value: 1000 })).rejects.toThrow();

    // The regression this guards: reportUsage rides this path. A backend that
    // committed the upsert and then answered 500 would be asked to commit it
    // again, and usage is the billing base — the customer pays for our latency.
    // No idempotency key exists on the wire, so one attempt is the only correct
    // number.
    expect(requests).toHaveLength(1);
  });

  it("retries a POST the caller declares idempotent", async () => {
    const { fetch, requests } = stubFetch([500, 200]);

    // GraphQL and OFREP are POSTs by protocol and reads by intent: the input
    // travels in a body, but replaying them changes nothing.
    await transportWith(fetch).post("/graphql", { query: "{ me }" }, { idempotent: true });

    expect(requests).toHaveLength(2);
  });
});
