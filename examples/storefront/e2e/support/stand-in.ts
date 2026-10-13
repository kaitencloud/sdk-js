// What a test does to the stand-in for Kaiten that the storefront runs against: it starts it over,
// scripts what it answers, and reads what it was asked. The stand-in's control surface is under
// `/kaiten-double/control`, on the storefront's own origin.

import { expect, test as base, type APIRequestContext } from "@playwright/test";

/** An answer for the stand-in to give in place of its own. */
export interface Reply {
  status: number;
  body?: unknown;
  /** The `Retry-After` header, in seconds. */
  retryAfter?: number;
  /** For a checkout: `true` answers a preview only, `false` a checkout that subscribes. */
  dryRun?: boolean;
}

/** A refusal, in the shape Kaiten's are: a problem with a `code`. */
export function refusal(
  status: number,
  code: string,
  detail = "refused",
  retryAfter?: number,
): Reply {
  return {
    status,
    retryAfter,
    body: {
      type: "https://tools.ietf.org/html/rfc7231",
      title: "Refused",
      status,
      detail,
      instance: "/api/public",
      code,
    },
  };
}

export interface Call {
  method: string;
  path: string;
  credential: "kst_" | "ksh_" | "pk_" | "none" | "other";
  origin: string | null;
  status: number;
  body: unknown;
}

export interface StandIn {
  /** Starts again from a customer with nothing: no subscription, card or email. */
  reset: (scenario?: { card?: boolean; email?: boolean; subscribed?: boolean }) => Promise<void>;
  /** The next calls to `METHOD /path` are answered with these, in turn. */
  script: (key: string, ...replies: Reply[]) => Promise<void>;
  /** What the payment of the next activation invoice comes to. */
  payment: (outcome: "paid" | "requires_action" | "failed" | "processing") => Promise<void>;
  payInvoice: (id: string) => Promise<void>;
  declineInvoice: (id: string) => Promise<void>;
  calls: () => Promise<Call[]>;
  state: () => Promise<{
    subscribed: boolean;
    cancelAtPeriodEnd: boolean;
    cardOnFile: boolean;
    billingEmail: string | null;
    invoices: Array<{ id: string; status: string; total: number }>;
    minted: number;
    revoked: number;
  }>;
}

function standIn(request: APIRequestContext): StandIn {
  const post = async (path: string, data?: unknown) => {
    const response = await request.post(`/kaiten-double/control${path}`, { data: data ?? {} });
    expect(response.ok(), `${path}: ${response.status()}`).toBe(true);
  };
  const get = async <T>(path: string): Promise<T> => {
    const response = await request.get(`/kaiten-double/control${path}`);
    expect(response.ok(), `${path}: ${response.status()}`).toBe(true);
    return (await response.json()) as T;
  };
  return {
    reset: (scenario) => post("/reset", scenario),
    script: (key, ...replies) => post("/script", { key, replies }),
    payment: (outcome) => post("/payment", { outcome }),
    payInvoice: (id) => post(`/invoices/${id}/pay`),
    declineInvoice: (id) => post(`/invoices/${id}/decline`),
    calls: () => get("/calls"),
    state: () => get("/state"),
  };
}

/**
 * `test`, with the stand-in as a fixture. It is started over before each test, and a test that
 * runs against a Kaiten of someone's is skipped: the stand-in is what these tests script.
 */
export const test = base.extend<{ standIn: StandIn }>({
  standIn: async ({ request }, use) => {
    const config = await request.get("/storefront-api/config");
    const { mode } = (await config.json()) as { mode: "double" | "live" };
    test.skip(mode !== "double", "this storefront runs against a Kaiten, not the stand-in");
    const control = standIn(request);
    await control.reset();
    await use(control);
  },
});

export { expect };
