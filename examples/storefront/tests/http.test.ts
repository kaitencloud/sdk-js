// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { ServerResponse } from "node:http";

import { describe, expect, test } from "vite-plus/test";

import { sendResponse } from "../server/http.ts";

/** The part of Node's `ServerResponse` that `sendResponse` writes to, keeping what it is given. */
function fakeResponse() {
  const headers = new Map<string, string | string[]>();
  let ended: Buffer | undefined;
  const outgoing = {
    statusCode: 0,
    setHeader: (name: string, value: string | string[]) => headers.set(name.toLowerCase(), value),
    end: (body: Buffer) => {
      ended = body;
    },
  };
  return { outgoing: outgoing as unknown as ServerResponse, headers, body: () => ended };
}

describe("writing a standard response to a Node one", () => {
  test("keeps every Set-Cookie, where setHeader alone would keep the last", async () => {
    const { outgoing, headers, body } = fakeResponse();
    const response = new Response("hello", {
      status: 201,
      headers: { "Content-Type": "text/plain" },
    });
    response.headers.append("Set-Cookie", "a=1; Path=/; HttpOnly");
    response.headers.append("Set-Cookie", "b=2; Path=/; Max-Age=0");

    await sendResponse(outgoing, response);

    expect(outgoing.statusCode).toBe(201);
    expect(headers.get("content-type")).toBe("text/plain");
    expect(headers.get("set-cookie")).toEqual(["a=1; Path=/; HttpOnly", "b=2; Path=/; Max-Age=0"]);
    expect(body()?.toString()).toBe("hello");
  });

  test("sets no Set-Cookie when there is none, and an empty body is an empty body", async () => {
    const { outgoing, headers, body } = fakeResponse();

    await sendResponse(outgoing, new Response(null, { status: 204 }));

    expect(outgoing.statusCode).toBe(204);
    expect(headers.has("set-cookie")).toBe(false);
    expect(body()?.byteLength).toBe(0);
  });
});
