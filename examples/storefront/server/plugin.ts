// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The storefront's backend, as a plugin of its own dev and preview servers: the routes under
// `/storefront-api`, and, when no Kaiten is configured, the stand-in that plays one.
//
// A real storefront puts these routes in whatever serves its pages. Nothing in `src/` imports
// from here, which is what keeps `@kaitencloud/server` and its token out of the browser build
// (`scripts/check-no-secrets-in-example-build.mjs` scans that build to make sure).

import { randomBytes } from "node:crypto";

import { createKaitenClient } from "@kaitencloud/server";
import type { Connect, Plugin } from "vite-plus";

import { createAccountCookie } from "./account-cookie.ts";
import { accountRoutes, SessionLedger, sessionAccounts } from "./account-routes.ts";
import { createKaitenDouble, DOUBLE_PATH } from "./double/kaiten-double.ts";
import {
  describeEnvironment,
  loadEnvironment,
  readEnvironment,
  signsUp,
  type Environment,
} from "./environment.ts";
import { sendResponse, toRequest, type Route } from "./http.ts";
import { catalogueReader, type ReadCatalogue } from "./public-catalog.ts";
import { sessionRoute } from "./session-route.ts";
import { vendorRoute } from "./vendor-route.ts";

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

/**
 * The routes that know who the visitor is: whether they have an account, the sign-up and the sign-out
 * (`account-routes.ts`), and the one that mints their session (`session-route.ts`). `signUp` says, at each
 * request, whether visitors make accounts or the storefront has one customer; the stand-in answers it
 * from its scenario, and a live storefront from its environment.
 */
function accountsBackend(options: {
  client: ReturnType<typeof createKaitenClient>;
  cookieSecret: string | undefined;
  readCatalogue: ReadCatalogue;
  signUp: () => boolean;
  /** Whether the page is told what a developer needs to fix a refused sign-up (see `AccountRoutesOptions`). */
  developerDetail: boolean;
  /** The fixed customer, for when `signUp` says no. */
  fixed: { customerSlug: string; instanceSlug: string } | undefined;
}): Route[] {
  const cookie = createAccountCookie(options.cookieSecret);
  const ledger = new SessionLedger();
  return [
    accountRoutes({
      client: options.client,
      cookie,
      ledger,
      readCatalogue: options.readCatalogue,
      signUp: options.signUp,
      developerDetail: options.developerDetail,
    }),
    sessionRoute({
      client: options.client,
      ...options.fixed,
      accounts: sessionAccounts(cookie, ledger),
      signUp: options.signUp,
    }),
  ];
}

export interface StorefrontRoutesOptions {
  /**
   * Whether the page is told which scope the token lacks, and the like, when a sign-up is refused: true
   * under `vp dev`, where the visitor is the developer. A live `vp preview` keeps it to the log. The
   * stand-in always tells: nothing of it is real.
   */
  developer?: boolean;
}

/** The routes of the storefront's backend for an environment, with the stand-in's when it is one. */
export function storefrontRoutes(
  environment: Environment,
  { developer = false }: StorefrontRoutesOptions = {},
): Route[] {
  if (environment.mode === "live") {
    const config: StorefrontConfig = {
      mode: "live",
      apiUrl: environment.apiUrl,
      publishableKey: environment.publishableKey,
    };
    const visitorsSignUp = signsUp(environment);
    return [
      (request) => (new URL(request.url).pathname === CONFIG_PATH ? json(config) : undefined),
      ...accountsBackend({
        client: createKaitenClient({
          baseUrl: environment.apiUrl,
          token: environment.serverToken,
        }),
        cookieSecret: environment.cookieSecret,
        readCatalogue: catalogueReader({
          apiUrl: environment.apiUrl,
          publishableKey: environment.publishableKey,
        }),
        signUp: () => visitorsSignUp,
        developerDetail: developer,
        fixed: visitorsSignUp
          ? undefined
          : { customerSlug: environment.customerSlug!, instanceSlug: environment.instanceSlug! },
      }),
    ];
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

  const client = createKaitenClient({
    baseUrl: "http://kaiten-double.invalid",
    token: serverToken,
    fetch: fetchDouble,
  });

  return [
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
    // The stand-in plays either: one customer (its default), or a visitor who signs up (a scenario a
    // test or the journey page starts it in), so the mode is asked at each request.
    ...accountsBackend({
      client,
      cookieSecret: environment.cookieSecret,
      readCatalogue: catalogueReader({
        apiUrl: "http://kaiten-double.invalid",
        publishableKey,
        fetch: fetchDouble,
      }),
      signUp: () => double.signUp(),
      developerDetail: true,
      fixed: { customerSlug: DOUBLE_CUSTOMER, instanceSlug: DOUBLE_INSTANCE },
    }),
    // The vendor's side of a plan change, for the journey page. Only against the stand-in.
    vendorRoute({ client, instanceSlug: DOUBLE_INSTANCE }),
    double.route,
  ];
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

/**
 * The storefront's backend, for `vp dev` and `vp preview`. Which Kaiten it talks to comes from the
 * shell and from the `.env` files of Vite's `envDir` (see `loadEnvironment`), read here on the
 * server: none of it reaches the page.
 */
export function storefront(): Plugin {
  const start = (
    developer: boolean,
    server: {
      config: {
        mode: string;
        envDir: string | false;
        logger: { info: (message: string) => void };
      };
    },
  ) => {
    const { mode, envDir } = server.config;
    // `envDir: false` is a project that turned the files off: the shell is all there is.
    const environment =
      envDir === false ? readEnvironment(process.env) : loadEnvironment(mode, envDir);
    for (const line of describeEnvironment(environment)) server.config.logger.info(`  ${line}`);
    return storefrontRoutes(environment, { developer });
  };

  return {
    name: "storefront-backend",
    configureServer(server) {
      mount(server.middlewares, start(true, server));
    },
    configurePreviewServer(server) {
      mount(server.middlewares, start(false, server));
    },
  };
}
