// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Node's request and response, and the standard ones. The routes of this storefront take a
// `Request` and answer a `Response`, so that a test calls them without a socket; this is
// the one place that knows about `http`.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/** A route: the standard request in, the standard response out, `undefined` when it is not its own. */
export type Route = (request: Request) => Response | undefined | Promise<Response | undefined>;

/** The request a Node server received, as the standard one. The body is read lazily. */
export function toRequest(incoming: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((each) => headers.append(name, each));
    else if (value !== undefined) headers.set(name, value);
  }
  const protocol = "encrypted" in incoming.socket && incoming.socket.encrypted ? "https" : "http";
  const url = `${protocol}://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`;
  const method = incoming.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(incoming) as ReadableStream, duplex: "half" } : {}),
  } as RequestInit);
}

/** Writes a standard response to a Node one. */
export async function sendResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}
