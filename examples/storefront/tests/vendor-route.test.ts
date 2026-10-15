// The vendor's side of a plan change: a route of the storefront's backend that schedules it with the
// server token, against the stand-in. Called here as the page calls it, through the same list of
// routes the dev server mounts.

import { createKaitenClient } from "@kaitencloud/server";
import { describe, expect, test, vi } from "vite-plus/test";

import { storefrontRoutes } from "../server/plugin.ts";
import { VENDOR_PLAN_CHANGE_PATH, vendorRoute } from "../server/vendor-route.ts";

const ORIGIN = "https://storefront.test";
const GROWTH_MONTHLY = "00000000-0000-4000-8000-000000000301";

function backend() {
  const routes = storefrontRoutes({ mode: "double" });
  const call = async (path: string, init?: RequestInit) => {
    for (const route of routes) {
      const response = await route(new Request(`${ORIGIN}${path}`, init));
      if (response) return response;
    }
    throw new Error(`nothing answers ${path}`);
  };
  const control = (path: string, data?: unknown) =>
    call(`/kaiten-double/control${path}`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
      headers: { "content-type": "application/json" },
    });
  const state = async () => (await call("/kaiten-double/control/state")).json();
  const plan = (price: unknown) =>
    call(VENDOR_PLAN_CHANGE_PATH, {
      method: "PUT",
      body: JSON.stringify({ licensePriceId: price }),
      headers: { "content-type": "application/json" },
    });
  return { routes, call, control, state, plan };
}

describe("PUT and DELETE /storefront-api/vendor/plan-change", () => {
  test("schedules a plan change for the next boundary, and drops it", async () => {
    const { control, state, plan, call } = backend();
    await control("/reset", { subscribed: true });

    const scheduled = await plan(GROWTH_MONTHLY);
    expect(scheduled.status).toBe(200);
    const body = (await scheduled.json()) as Record<string, unknown>;
    // The page learns that a change waits, to which price and when: not what Kaiten answered.
    expect(Object.keys(body).sort()).toEqual(["scheduledChange", "status"]);
    expect(body).toMatchObject({
      status: "ACTIVE",
      scheduledChange: { priceId: GROWTH_MONTHLY },
    });
    expect(await state()).toMatchObject({ scheduledChange: { plan: "growth-v1" } });
    expect(JSON.stringify(body)).not.toContain("ksh_");

    const dropped = await call(VENDOR_PLAN_CHANGE_PATH, { method: "DELETE" });
    expect(dropped.status).toBe(200);
    expect(await dropped.json()).toMatchObject({ scheduledChange: null });
    expect(await state()).toMatchObject({ scheduledChange: null });

    // The calls Kaiten saw were the backend's, with the server token and no `Origin`.
    const calls = (await (await call("/kaiten-double/control/calls")).json()) as Array<{
      method: string;
      path: string;
      credential: string;
      origin: string | null;
    }>;
    const vendor = calls.filter((each) => each.path.endsWith("/billing/scheduled-change"));
    expect(vendor.map((each) => each.method)).toEqual(["PUT", "DELETE"]);
    for (const each of vendor) expect(each).toMatchObject({ credential: "ksh_", origin: null });
  });

  test("tells the presenter why Kaiten refused, by its code", async () => {
    const { control, plan, call } = backend();

    const never = await plan(GROWTH_MONTHLY);
    expect(never.status).toBe(404);
    expect(await never.json()).toEqual({ error: "refused", code: "SchedulePlanChange.NotFound" });

    await control("/reset", { subscribed: true });
    const same = await plan("00000000-0000-4000-8000-000000000201");
    expect(same.status).toBe(422);
    expect(await same.json()).toEqual({ error: "refused", code: "SchedulePlanChange.SamePrice" });

    const none = await call(VENDOR_PLAN_CHANGE_PATH, { method: "DELETE" });
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({
      error: "refused",
      code: "CancelPlanChange.NoPlanChangeScheduled",
    });
  });

  test("wants a price, a method it knows and a page of its own origin", async () => {
    const { plan, call } = backend();
    expect((await plan(undefined)).status).toBe(400);
    expect((await plan("")).status).toBe(400);
    expect((await call(VENDOR_PLAN_CHANGE_PATH, { method: "GET" })).status).toBe(405);
    expect(
      (
        await call(VENDOR_PLAN_CHANGE_PATH, {
          method: "PUT",
          body: JSON.stringify({ licensePriceId: GROWTH_MONTHLY }),
          headers: { Origin: "https://elsewhere.test", "content-type": "application/json" },
        })
      ).status,
    ).toBe(403);
  });

  test("answers 502 when Kaiten cannot be reached, without repeating why", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const route = vendorRoute({
      client: createKaitenClient({
        baseUrl: "https://kaiten.test",
        token: `ksh_${"s".repeat(43)}`,
        fetch: async () => {
          throw new TypeError("connect ECONNREFUSED 10.0.0.1:443");
        },
      }),
      instanceSlug: "acme-instance",
    });
    const response = (await route(
      new Request(`${ORIGIN}${VENDOR_PLAN_CHANGE_PATH}`, {
        method: "PUT",
        body: JSON.stringify({ licensePriceId: GROWTH_MONTHLY }),
      }),
    ))!;
    expect(response.status).toBe(502);
    expect(await response.text()).toBe(JSON.stringify({ error: "unavailable" }));
    // What the server logs does not hold the connection error's address either.
    expect(JSON.stringify(logged.mock.calls)).not.toContain("10.0.0.1");
    logged.mockRestore();
  });

  test("is not mounted against a Kaiten of yours", async () => {
    const live = storefrontRoutes({
      mode: "live",
      apiUrl: "https://kaiten.test/api",
      serverToken: `ksh_${"s".repeat(43)}`,
      publishableKey: `pk_${"p".repeat(43)}`,
      customerSlug: "initech",
      instanceSlug: "initech-lab",
    });
    for (const route of live) {
      expect(
        await route(new Request(`${ORIGIN}${VENDOR_PLAN_CHANGE_PATH}`, { method: "PUT" })),
      ).toBeUndefined();
    }
  });
});
