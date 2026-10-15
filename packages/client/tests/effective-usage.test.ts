import { describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient } from "../src/index.ts";
import type {
  EntitlementProvenance,
  EntitlementUsage,
  KaitenApi,
  ReportUsageResult,
} from "../src/index.ts";
import { ADDON_ONLY_ROW, EFFECTIVE_TOKENS_ROW } from "./support/effective-usage.ts";

// The usage routes of a current server answer the instance's effective
// entitlement: its limit and allowance with the add-ons and boosts applied, the
// layer that grants it, and why. These tests pin that the curated reads hand all
// of it over as the server sent it, and that a row from a server that predates
// it reads as it always did.

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function clientAnswering(answer: (request: Request) => unknown): KaitenClient {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    json(answer(input instanceof Request ? input : new Request(input, init))),
  );
  return new KaitenClient({ apiUrl: "https://api.test", authScheme: "none", fetch, timeoutMs: 0 });
}

describe("the usage reads of a current server", () => {
  test("the list of an instance's usage keeps the source, the provenance and the allowance", async () => {
    const client = clientAnswering(() => [EFFECTIVE_TOKENS_ROW, ADDON_ONLY_ROW]);

    const rows = await client.usage.getByInstance("acme-prod");

    expect(rows).toEqual([EFFECTIVE_TOKENS_ROW, ADDON_ONLY_ROW]);
    const [tokens, sso] = rows ?? [];
    expect(tokens?.source).toBe("license");
    expect(tokens?.limitCapExceededOveragePercent).toBe(50);
    expect(sso?.source).toBe("addon");
    expect(sso?.provenance?.license).toBeNull();
  });

  test("the detail of an entitlement names the rows each layer comes from", async () => {
    const client = clientAnswering(() => EFFECTIVE_TOKENS_ROW);

    const row = await client.usage.getDetail("acme-prod", "tokens");

    const provenance: EntitlementProvenance | null | undefined = row.provenance;
    expect(provenance?.license?.licenseEntitlementId).toBe("7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c01");
    expect(provenance?.addons[0]?.addonEntitlementId).toBe("7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c04");
    expect(provenance?.addons[0]?.instanceAddonId).toBe("7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c02");
    expect(provenance?.boosts[0]?.instanceVoucherId).toBe("7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c05");
    expect(provenance?.boosts[0]?.voucherEntitlementGrantId).toBe(
      "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c07",
    );
    expect(provenance?.number).toEqual({
      license: 10000,
      afterAddons: 13000,
      boostSet: null,
      boostAdd: null,
      boostMultiply: 2,
      unlimited: false,
      effective: 26000,
    });
  });

  test("a report resolves with the effective row it was counted in", async () => {
    const client = clientAnswering(() => EFFECTIVE_TOKENS_ROW);

    const result = await client.reportUsage("acme-prod", "tokens", {
      value: { type: "number", value: 1 },
      behavior: "append",
    });

    expect(result).toEqual(EFFECTIVE_TOKENS_ROW);
    expect(result.source).toBe("license");
    expect(result.limitCapExceededOveragePercent).toBe(50);
  });
});

describe("the answer to a replayed report", () => {
  // What a server rebuilds from its journal: the figures of the first report,
  // and neither the layer that granted it nor the arithmetic of its limit.
  const replay = {
    ...EFFECTIVE_TOKENS_ROW,
    source: null,
    provenance: null,
  };

  test("carries a null source and a null provenance through, with the replay marker", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(replay), {
          status: 200,
          headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" },
        }),
    );
    const client = new KaitenClient({
      apiUrl: "https://api.test",
      authScheme: "none",
      fetch,
      timeoutMs: 0,
    });

    const result = await client.reportUsage("acme-prod", "tokens", {
      value: { type: "number", value: 1 },
      behavior: "append",
      transactionId: "llm-call:9f2c:tokens",
    });

    expect(result.idempotentReplayed).toBe(true);
    expect(result.source).toBeNull();
    expect(result.provenance).toBeNull();
    expect(result.limitCapExceededOveragePercent).toBe(50);
  });

  test("a null source and provenance read as not computed, not as no layer", async () => {
    const client = clientAnswering(() => replay);

    const row = await client.usage.getDetail("acme-prod", "tokens");
    const layer: string = row.source ?? "unknown";
    const addons = row.provenance?.addons ?? [];

    expect(layer).toBe("unknown");
    expect(addons).toEqual([]);
  });

  test("a flag has no allowance to report, and says so with null", async () => {
    const flag: EntitlementUsage = {
      ...ADDON_ONLY_ROW,
      limitCapExceededOveragePercent: null,
    };
    const client = clientAnswering(() => flag);

    const row = await client.usage.getDetail("acme-prod", "sso");

    expect(row.limitCapExceededOveragePercent).toBeNull();
  });
});

describe("the usage reads of a server that predates them", () => {
  const legacy = {
    entitlementId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c10",
    entitlementSlug: "tokens",
    licenseId: "7c8d0f6e-3b52-4f7a-9d1c-2a6b8e4f1c11",
    licenseSlug: "growth",
    value: { type: "number", value: 25000 },
    limit: { type: "number", value: 10000 },
  };

  test("a row without them reads as it always did", async () => {
    const client = clientAnswering(() => legacy);

    const row = await client.usage.getDetail("acme-prod", "tokens");

    expect(row).toEqual(legacy);
    expect(row.source).toBeUndefined();
    expect(row.provenance).toBeUndefined();
    expect(row.limitCapExceededOveragePercent).toBeUndefined();
  });
});

// Checked by the type checker, run by `vp check`.
describe("the row type", () => {
  test("a raw row of the API is a row of the curated type", () => {
    const wire: KaitenApi.EntitlementUsage = EFFECTIVE_TOKENS_ROW;
    const row: EntitlementUsage = wire;

    expect(row.provenance?.boosts[0]?.modifierType).toBe("MULTIPLY");
  });

  test("a row written against 1.0 still builds, and the source takes a layer to come", () => {
    const written: EntitlementUsage = {
      entitlementId: "e",
      entitlementSlug: "tokens",
      licenseId: "l",
      licenseSlug: "growth",
      value: { type: "number", value: 1 },
    };
    const later: EntitlementUsage = { ...written, source: "bundle" };

    expect(written.source).toBeUndefined();
    expect(later.source).toBe("bundle");
  });

  test("the three members take null, for a row a replay rebuilds", () => {
    const rebuilt: EntitlementUsage = {
      entitlementId: "e",
      entitlementSlug: "tokens",
      licenseId: "l",
      licenseSlug: "growth",
      value: { type: "number", value: 1 },
      source: null,
      provenance: null,
      limitCapExceededOveragePercent: null,
    };
    const result: ReportUsageResult = { ...rebuilt, idempotentReplayed: true };

    expect(result.source).toBeNull();
    expect(result.provenance).toBeNull();
    expect(result.limitCapExceededOveragePercent).toBeNull();
  });
});
