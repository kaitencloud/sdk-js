// The storefront's backend, as a plugin of its own dev and preview servers: the routes under
// `/storefront-api`, and, when no Kaiten is configured, the stand-in that plays one.
//
// A real storefront puts these routes in whatever serves its pages. Nothing in `src/` imports
// from here, which is what keeps `@kaitencloud/server` and its token out of the browser build
// (`scripts/check-no-secrets-in-example-build.mjs` scans that build to make sure).

import { randomBytes } from "node:crypto";

import { createKaitenClient } from "@kaitencloud/server";
import type { Connect, Plugin } from "vite-plus";

import { createKaitenDouble, DOUBLE_PATH } from "./double/kaiten-double.ts";
import { readEnvironment, type Environment } from "./environment.ts";
import { sendResponse, toRequest, type Route } from "./http.ts";
import { sessionRoute } from "./session-route.ts";

/** The path the page reads what it needs to reach Kaiten from. */
export const CONFIG_PATH = "/storefront-api/config";

/** What the page needs to know to reach Kaiten: nothing that is secret. */
export interface StorefrontConfig {
  mode: Environment["mode"];
  /** Where the page reaches Kaiten's API. */
  apiUrl: string;
  /** The publishable key that reads the catalogue. */
  publishableKey: string;
}

/** The demo customer and instance the stand-in knows. A live storefront names its own. */
const DOUBLE_CUSTOMER = "acme-customer";
const DOUBLE_INSTANCE = "acme-instance";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** The routes of the storefront's backend for an environment, and the stand-in when it is one. */
export function storefrontRoutes(environment: Environment): {
  routes: Route[];
  double?: ReturnType<typeof createKaitenDouble>;
} {
  if (environment.mode === "live") {
    const config: StorefrontConfig = {
      mode: "live",
      apiUrl: environment.apiUrl,
      publishableKey: environment.publishableKey,
    };
    return {
      routes: [
        (request) => (new URL(request.url).pathname === CONFIG_PATH ? json(config) : undefined),
        sessionRoute({
          client: createKaitenClient({
            baseUrl: environment.apiUrl,
            token: environment.serverToken,
          }),
          customerSlug: environment.customerSlug,
          instanceSlug: environment.instanceSlug,
        }),
      ],
    };
  }

  // Fresh credentials for each start: the stand-in's are not in the repository, and a test
  // that finds one in a build has found a leak.
  const serverToken = `ksh_${randomBytes(32).toString("base64url")}`;
  const publishableKey = `pk_${randomBytes(32).toString("base64url")}`;
  const double = createKaitenDouble({ serverToken, publishableKey });
  const fetchDouble: typeof fetch = async (input, init) => {
    const response = await double.route(new Request(input, init));
    if (!response) throw new TypeError("The stand-in for Kaiten has no such route.");
    return response;
  };

  return {
    double,
    routes: [
      (request) => {
        const url = new URL(request.url);
        if (url.pathname !== CONFIG_PATH) return undefined;
        const config: StorefrontConfig = {
          mode: "double",
          apiUrl: `${url.origin}${DOUBLE_PATH}/api`,
          publishableKey,
        };
        return json(config);
      },
      sessionRoute({
        client: createKaitenClient({
          baseUrl: "http://kaiten-double.invalid",
          token: serverToken,
          fetch: fetchDouble,
        }),
        customerSlug: DOUBLE_CUSTOMER,
        instanceSlug: DOUBLE_INSTANCE,
      }),
      double.route,
    ],
  };
}

function mount(middlewares: Connect.Server, routes: Route[]): void {
  middlewares.use((incoming, outgoing, next) => {
    const url = incoming.url ?? "";
    if (!url.startsWith("/storefront-api/") && !url.startsWith(`${DOUBLE_PATH}/`)) {
      next();
      return;
    }
    void (async () => {
      const request = toRequest(incoming);
      for (const route of routes) {
        const response = await route(request);
        if (response) {
          await sendResponse(outgoing, response);
          return;
        }
      }
      next();
    })().catch(next);
  });
}

/** The storefront's backend, for `vp dev` and `vp preview`. */
export function storefront(): Plugin {
  const start = (server: { config: { logger: { info: (message: string) => void } } }) => {
    const environment = readEnvironment();
    server.config.logger.info(
      environment.mode === "live"
        ? `  storefront: running against the Kaiten at ${environment.apiUrl}`
        : "  storefront: running against a stand-in for Kaiten (set KAITEN_API_URL and the other variables of the README to use yours)",
    );
    return storefrontRoutes(environment).routes;
  };

  return {
    name: "storefront-backend",
    configureServer(server) {
      mount(server.middlewares, start(server));
    },
    configurePreviewServer(server) {
      mount(server.middlewares, start(server));
    },
  };
}
