// A stand-in for Kaiten, to rehearse the journey without one. It answers the ten
// routes the journey calls with the answers recorded in the client's fixtures, which
// are held to the contract, and keeps just enough state for the journey to move: a
// session that can be revoked, a card that has to be saved before a checkout
// subscribes, a subscription that can be canceled and reactivated.
//
// It is not a Kaiten. It proves that the journey asks the right routes in the right
// order, reads what comes back, and fails on an API that does not keep to the
// contract; it proves nothing about the API.

import { readFileSync } from "node:fs";

type Json = Record<string, any>;

const fixture = (name: string): Json =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../packages/client/tests/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  );

export interface Fake {
  /** Changes an answer before it is sent: `(route, body) => body`. Route is `METHOD /path`. */
  tamper?: (route: string, body: Json) => Json;
  /** The instance already has a subscription. */
  alreadySubscribed?: boolean;
  /** A revoked session keeps working. */
  revocationIgnored?: boolean;
  /** The total the activation invoice bills; the preview says 4900. */
  activationTotal?: number;
}

export const PUBLISHABLE_KEY = `pk_${"p".repeat(43)}`;
export const SERVER_TOKEN = `ksh_${"s".repeat(32)}`;
export const SETUP_SESSION_ID = "cs_test_setup_1";

const hour = () => new Date(Date.now() + 3_600_000).toISOString();

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": status < 400 ? "application/json" : "application/problem+json" },
  });

const problem = (status: number, code: string, detail: string) =>
  json(
    {
      type: "https://tools.ietf.org/html/rfc7231",
      title: "Refused",
      status,
      detail,
      instance: "/api/public/session",
      code,
    },
    status,
  );

export function fakeKaiten(options: Fake = {}) {
  const session = fixture("session.initech.json");
  const catalog = fixture("public-catalog.acme.json");
  const state = {
    minted: undefined as undefined | { id: string; token: string },
    customerSlug: "",
    instanceSlug: "",
    revoked: false,
    cardSaved: false,
    subscribed: options.alreadySubscribed === true,
    canceling: false,
    requests: [] as string[],
  };

  const answer = (route: string, body: Json, status = 200): Response =>
    json(options.tamper ? options.tamper(route, structuredClone(body)) : body, status);

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    const path = url.pathname.replace(/^\/api/, "");
    const route = `${method} ${path}`;
    state.requests.push(route);
    const raw = init?.body ?? (request ? await request.clone().text() : undefined);
    const body: Json = typeof raw === "string" && raw !== "" ? JSON.parse(raw) : {};

    if (route === "GET /public/catalog") {
      return headers.get("x-kaiten-publishable-key") === PUBLISHABLE_KEY
        ? answer(route, catalog)
        : problem(401, "PublicAuth.InvalidCredential", "unknown publishable key");
    }

    if (path.startsWith("/customer-sessions")) {
      if (headers.get("authorization") !== `Bearer ${SERVER_TOKEN}`) {
        return problem(401, "Auth.InvalidCredential", "unknown token");
      }
      if (route === "POST /customer-sessions") {
        state.minted = {
          id: "00000000-0000-4000-8000-0000000000aa",
          token: `kst_${"k".repeat(43)}`,
        };
        state.customerSlug = body.customerSlug;
        state.instanceSlug = body.instanceSlug;
        return answer(
          route,
          {
            id: state.minted.id,
            token: state.minted.token,
            expiresAt: new Date(Date.now() + (body.ttlSeconds ?? 1800) * 1000).toISOString(),
            customerSlug: body.customerSlug,
            ...(body.instanceSlug ? { instanceSlug: body.instanceSlug } : {}),
          },
          201,
        );
      }
      if (method === "POST" && path === `/customer-sessions/${state.minted?.id}/revoke`) {
        state.revoked = options.revocationIgnored !== true;
        return json(null, 204);
      }
      return problem(404, "NotFound", "no such route");
    }

    if (path.startsWith("/public/session/")) {
      const bearer = headers.get("authorization");
      if (!state.minted || bearer !== `Bearer ${state.minted.token}` || state.revoked) {
        return problem(401, "PublicAuth.InvalidCredential", "the session is not valid");
      }
      if (route === "GET /public/session/portal") {
        // The fixtures are Initech's; the stand-in serves whichever instance the session was minted for.
        const portal = structuredClone(
          state.subscribed ? session.portal : session.portalNeverSubscribed,
        );
        portal.customer.slug = state.customerSlug;
        portal.instance.slug = state.instanceSlug;
        return answer(route, portal);
      }
      if (route === "POST /public/session/checkout") {
        const total = 4900;
        if (body.dryRun) {
          const preview = structuredClone(session.checkoutPreview);
          preview.dueToday.total = total;
          return answer(route, preview);
        }
        if (typeof body.setupSessionId === "string") {
          if (body.setupSessionId !== SETUP_SESSION_ID || !state.cardSaved) {
            return problem(
              422,
              "CreateSessionCheckout.SetupSessionIncomplete",
              "no card was saved",
            );
          }
          state.subscribed = true;
          const subscribed = structuredClone(session.checkoutSubscribed);
          subscribed.activationInvoice.total = options.activationTotal ?? total;
          subscribed.activationInvoice.hostedInvoiceUrl = "https://pay.initech.test/i/100";
          return answer(route, subscribed, 201);
        }
        const needsCard = structuredClone(session.checkoutRequiresMethod);
        needsCard.setupSessionId = SETUP_SESSION_ID;
        needsCard.expiresAt = hour();
        return answer(route, needsCard);
      }
      if (route === "GET /public/session/invoices") {
        const activation = structuredClone(session.checkoutSubscribed.activationInvoice);
        activation.total = options.activationTotal ?? 4900;
        activation.hostedInvoiceUrl = "https://pay.initech.test/i/100";
        activation.invoicePdfUrl = "https://pay.initech.test/i/100.pdf";
        return answer(route, { items: [activation], hasMore: false });
      }
      if (route === "POST /public/session/billing/cancel") {
        state.canceling = true;
        return answer(route, session.cancel);
      }
      if (route === "POST /public/session/billing/reactivate") {
        state.canceling = false;
        return answer(route, session.reactivate);
      }
    }
    return problem(404, "NotFound", `the fake knows no ${route}`);
  };

  return {
    fetch,
    state,
    /** What the stub provider does when the customer saves a card on its page. */
    saveCard: async () => {
      state.cardSaved = true;
    },
  };
}
