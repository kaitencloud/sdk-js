// `PUT` and `DELETE` on `/storefront-api/vendor/plan-change`: what the vendor does in its own back
// office when it moves a customer to another plan at the next boundary. A customer cannot do it
// in V1 ("Change plan" is a commercial request), so the move is the vendor's, with the
// server token, through `Billing.schedulePlanChange` of `@kaitencloud/server`.
//
// This route exists for the journey page, which plays the vendor's side of that conversation. A
// real storefront has no such route on its customer-facing server: the schedule is made from an
// admin tool, behind the vendor's own sign-in, or by a script. It is mounted only while the
// storefront runs against the stand-in for Kaiten, never against yours.

import { Billing, createKaitenClient, KaitenError } from "@kaitencloud/server";

import type { Route } from "./http.ts";

type Client = ReturnType<typeof createKaitenClient>;

export interface VendorRouteOptions {
  /** A client that carries a `ksh_` token with `write:billing`. */
  client: Client;
  /** The instance whose plan is changed. */
  instanceSlug: string;
}

/** The path the journey page calls. */
export const VENDOR_PLAN_CHANGE_PATH = "/storefront-api/vendor/plan-change";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** What the page learns of a subscription: the change that waits, and nothing else of it. */
function summary(billing: {
  status: string;
  scheduledChange: { price: { id: string }; effectiveAt: string } | null;
}) {
  return {
    status: billing.status,
    scheduledChange: billing.scheduledChange
      ? {
          priceId: billing.scheduledChange.price.id,
          effectiveAt: billing.scheduledChange.effectiveAt,
        }
      : null,
  };
}

export function vendorRoute(options: VendorRouteOptions): Route {
  const { client, instanceSlug } = options;

  return async (request) => {
    if (new URL(request.url).pathname !== VENDOR_PLAN_CHANGE_PATH) return undefined;

    if (request.method !== "PUT" && request.method !== "DELETE") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "PUT, DELETE" },
      });
    }

    // A page of another origin must not move customers between plans.
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== new URL(request.url).origin) {
      return json(403, { error: "cross_origin" });
    }

    try {
      if (request.method === "DELETE") {
        const { data } = await Billing.cancelPlanChange({
          client,
          throwOnError: true,
          path: { instanceSlug },
        });
        return json(200, summary(data));
      }

      const wanted = (await request.json().catch(() => null)) as {
        licensePriceId?: unknown;
      } | null;
      if (typeof wanted?.licensePriceId !== "string" || wanted.licensePriceId === "") {
        return json(400, { error: "licensePriceId_required" });
      }
      const { data } = await Billing.schedulePlanChange({
        client,
        throwOnError: true,
        path: { instanceSlug },
        body: { licensePriceId: wanted.licensePriceId },
      });
      return json(200, summary(data));
    } catch (error) {
      // Kaiten's code says why in a word a presenter can use (`SchedulePlanChange.TrialInProgress`);
      // nothing else of what it answered goes to the page.
      if (error instanceof KaitenError) {
        return json(error.status >= 400 && error.status < 500 ? error.status : 502, {
          error: "refused",
          code: error.code,
        });
      }
      console.error("[storefront] Kaiten could not be reached to change a plan");
      return json(502, { error: "unavailable" });
    }
  };
}
