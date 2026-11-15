// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A fetch that keeps what went over the wire, so that the suite can hold the real
// answers of a Kaiten to the contract, not the values the SDKs made of them.

import { responseProblems } from "../../../packages/client/tests/support/contract-schema.ts";

/** One request and its answer, as the network carried them. */
export interface Exchange {
  method: string;
  /** The request's path below the API's own prefix, without its query: `/public/catalog`. */
  path: string;
  status: number;
  /** The answer's JSON, `undefined` when it has no body. */
  body: unknown;
  /**
   * The request's headers, by lower-case name. A credential is cut to its prefix
   * (`Bearer kst_…`, `pk_…`): enough to say which kind went where, and nothing a
   * failing test could print.
   */
  requestHeaders: Record<string, string>;
  /** The answer's headers, by lower-case name. */
  responseHeaders: Record<string, string>;
}

type Fetch = typeof globalThis.fetch;

const CREDENTIAL_HEADERS = ["authorization", "x-kaiten-publishable-key"];

/** A credential reduced to what says which kind it is. */
function shortened(name: string, value: string): string {
  if (!CREDENTIAL_HEADERS.includes(name)) return value;
  return `${value.slice(0, value.startsWith("Bearer ") ? "Bearer kst_".length : "pk_".length)}…`;
}

/**
 * Wraps `inner`, which defaults to the global `fetch`, and records every exchange.
 * `apiPrefix` is the path the API is served under (`/api`), taken off each path so
 * that it can be looked up in the contract.
 */
export function recordingFetch(apiPrefix: string, inner: Fetch = (...args) => fetch(...args)) {
  const exchanges: Exchange[] = [];
  let seen = 0;

  const wrapped: Fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const requestHeaders: Record<string, string> = {};
    new Headers(init?.headers ?? request?.headers).forEach((value, name) => {
      requestHeaders[name.toLowerCase()] = shortened(name.toLowerCase(), value);
    });

    const response = await inner(input, init);

    const text = await response.clone().text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name.toLowerCase()] = value;
    });
    let body: unknown;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    exchanges.push({
      method,
      path: url.pathname.startsWith(apiPrefix)
        ? url.pathname.slice(apiPrefix.length)
        : url.pathname,
      status: response.status,
      body,
      requestHeaders,
      responseHeaders,
    });
    return response;
  };

  return {
    fetch: wrapped,
    /** Every exchange so far. */
    exchanges,
    /** The exchanges since the last time this was called. */
    since(): Exchange[] {
      const fresh = exchanges.slice(seen);
      seen = exchanges.length;
      return fresh;
    },
  };
}

/** A Kaiten token (`kst_…`, `ksh_…`, `ksm_…`) cut to its prefix, wherever the text holds one. */
export function withoutTokens(text: string): string {
  return text.replace(/\b(k(?:st|sh|sm)_)[A-Za-z0-9_-]+/g, "$1…");
}

/**
 * What is wrong with the answers, each held to the response the contract declares;
 * empty when they fit. A problem quotes the value that is wrong, and the answer that
 * mints a session carries its token: nothing returned here holds one whole.
 */
export function contractProblemsOf(exchanges: readonly Exchange[]): string[] {
  return exchanges.flatMap(({ method, path, status, body }) =>
    responseProblems(method, path, status, body).map(withoutTokens),
  );
}
