// What the conformance suite needs to know about the stack it runs against, read
// from the environment, and what it says when it does not have it.
//
// Three outcomes, not two. Nothing set is the ordinary case on a laptop and on a
// pull request from a fork, which gets no secrets: the suite skips, and says what
// would make it run. Everything set runs it. Some set, or a value that cannot be
// right, is a mistake in the configuration, and that fails: a repository that lost
// one secret must not read as a suite that passed.

import { isPublishableKeyShape } from "@kaitencloud/client";

export const VARIABLES = {
  apiUrl: "KAITEN_CONFORMANCE_API_URL",
  publishableKey: "KAITEN_CONFORMANCE_PUBLISHABLE_KEY",
  serverToken: "KAITEN_CONFORMANCE_SERVER_TOKEN",
  customerSlug: "KAITEN_CONFORMANCE_CUSTOMER_SLUG",
  instanceSlug: "KAITEN_CONFORMANCE_INSTANCE_SLUG",
  returnUrl: "KAITEN_CONFORMANCE_RETURN_URL",
  stripeTestKey: "KAITEN_CONFORMANCE_STRIPE_TEST_KEY",
  setupModule: "KAITEN_CONFORMANCE_SETUP_MODULE",
  billingEmail: "KAITEN_CONFORMANCE_BILLING_EMAIL",
  planSlug: "KAITEN_CONFORMANCE_PLAN_SLUG",
  stripeApiUrl: "KAITEN_CONFORMANCE_STRIPE_API_URL",
} as const;

export interface Configuration {
  /** The Kaiten API's URL, `/api` included. */
  apiUrl: string;
  /** The publishable key that reads the catalogue. */
  publishableKey: string;
  /** A token that may mint and revoke customer sessions, never sent to a browser. */
  serverToken: string;
  customerSlug: string;
  /** An instance of that customer that has no subscription yet. */
  instanceSlug: string;
  /** Where the hosted setup page sends the customer back: an origin the publishable key allows. */
  returnUrl: string;
  billingEmail: string;
  /** The plan to buy. Absent: the first self-serve paid plan of the catalogue. */
  planSlug?: string;
  /**
   * How the hosted setup page gets completed. The suite's own way is the
   * Stripe API, with a test-mode key; a module of your own can do it another way.
   */
  setup: { kind: "stripe"; secretKey: string; apiUrl: string } | { kind: "module"; path: string };
}

export type Loaded =
  | { state: "absent"; message: string }
  | { state: "invalid"; message: string }
  | { state: "ready"; configuration: Configuration };

/** The variables without which there is nothing to run against. */
const REQUIRED = [
  VARIABLES.apiUrl,
  VARIABLES.publishableKey,
  VARIABLES.serverToken,
  VARIABLES.customerSlug,
  VARIABLES.instanceSlug,
  VARIABLES.returnUrl,
] as const;

/** What a person has to provide, in the words the suite uses to say it has nothing to run. */
export const WHAT_TO_PROVIDE = [
  `${VARIABLES.apiUrl}  the Kaiten API's URL, /api included (http://localhost:8080/api)`,
  `${VARIABLES.publishableKey}  a publishable key (pk_...) of the organization`,
  `${VARIABLES.serverToken}  a token (ksh_...) that holds write:customer_sessions`,
  `${VARIABLES.customerSlug}  a customer of that organization`,
  `${VARIABLES.instanceSlug}  one of its instances, with no subscription yet`,
  `${VARIABLES.returnUrl}  a URL on an origin the publishable key allows`,
  `${VARIABLES.stripeTestKey}  a Stripe test-mode key (sk_test_... or rk_test_...), or ${VARIABLES.setupModule}: a module that completes the hosted setup page`,
];

function absent(): Loaded {
  return {
    state: "absent",
    message:
      "conformance: skipped, no Kaiten stack to run against. To run it, set:\n" +
      WHAT_TO_PROVIDE.map((line) => `  ${line}`).join("\n"),
  };
}

const invalid = (problems: string[]): Loaded => ({
  state: "invalid",
  message: `conformance: the configuration cannot run the suite:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
});

function isUrl(value: string, protocols: string[]): URL | undefined {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the environment. An empty value is no value: CI passes a secret it does not have as `""`. */
export function loadConfiguration(env: Record<string, string | undefined>): Loaded {
  const value = (name: string): string | undefined => {
    const raw = env[name]?.trim();
    return raw ? raw : undefined;
  };

  const present = REQUIRED.filter((name) => value(name) !== undefined);
  const setup = [VARIABLES.stripeTestKey, VARIABLES.setupModule].filter(
    (n) => value(n) !== undefined,
  );
  if (present.length === 0 && setup.length === 0) return absent();

  const problems: string[] = [];
  for (const name of REQUIRED) {
    if (value(name) === undefined) problems.push(`${name} is not set`);
  }
  if (setup.length === 0) {
    problems.push(
      `set ${VARIABLES.stripeTestKey} or ${VARIABLES.setupModule}: the hosted setup page has to be completed`,
    );
  }

  const apiUrl = value(VARIABLES.apiUrl);
  if (apiUrl !== undefined) {
    const url = isUrl(apiUrl, ["http:", "https:"]);
    if (!url) problems.push(`${VARIABLES.apiUrl} is not an http(s) URL`);
    else if (!url.pathname.replace(/\/+$/, "").endsWith("/api")) {
      problems.push(`${VARIABLES.apiUrl} must end with /api, the prefix the API is served under`);
    }
  }
  const publishableKey = value(VARIABLES.publishableKey);
  if (publishableKey !== undefined && !isPublishableKeyShape(publishableKey)) {
    problems.push(`${VARIABLES.publishableKey} is not a publishable key (pk_ and 43 characters)`);
  }
  const serverToken = value(VARIABLES.serverToken);
  if (serverToken !== undefined && !serverToken.startsWith("ksh_")) {
    problems.push(`${VARIABLES.serverToken} is not a token (ksh_...)`);
  }
  const returnUrl = value(VARIABLES.returnUrl);
  if (returnUrl !== undefined && !isUrl(returnUrl, ["http:", "https:"])) {
    problems.push(`${VARIABLES.returnUrl} is not an http(s) URL`);
  }
  const stripeKey = value(VARIABLES.stripeTestKey);
  if (stripeKey !== undefined && !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(stripeKey)) {
    problems.push(
      `${VARIABLES.stripeTestKey} is not a Stripe test-mode key: the suite never runs with a live one`,
    );
  }
  const stripeApiUrl = value(VARIABLES.stripeApiUrl) ?? "https://api.stripe.com";
  if (!isUrl(stripeApiUrl, ["http:", "https:"])) {
    problems.push(`${VARIABLES.stripeApiUrl} is not an http(s) URL`);
  }
  if (problems.length > 0) return invalid(problems);

  return {
    state: "ready",
    configuration: {
      apiUrl: apiUrl!.replace(/\/+$/, ""),
      publishableKey: publishableKey!,
      serverToken: serverToken!,
      customerSlug: value(VARIABLES.customerSlug)!,
      instanceSlug: value(VARIABLES.instanceSlug)!,
      returnUrl: returnUrl!,
      billingEmail: value(VARIABLES.billingEmail) ?? "conformance@example.test",
      planSlug: value(VARIABLES.planSlug),
      // A module of your own wins: it is what you wrote to complete the page.
      setup:
        value(VARIABLES.setupModule) !== undefined
          ? { kind: "module", path: value(VARIABLES.setupModule)! }
          : { kind: "stripe", secretKey: stripeKey!, apiUrl: stripeApiUrl.replace(/\/+$/, "") },
    },
  };
}
