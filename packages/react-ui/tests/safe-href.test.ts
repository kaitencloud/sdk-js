// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
//
// Where a component links a host's address. Run with no window, as a page rendered on the
// server is: the verdict must be the one the browser gives on an http(s) page, or the HTML
// the server sends and the one the browser hydrates disagree.

import { expect, test } from "vite-plus/test";

import { safeHref } from "../src/lib/safe-href.ts";

test("there is no window here", () => {
  expect(typeof window).toBe("undefined");
});

test("http(s) addresses, absolute or relative, are kept as written", () => {
  for (const url of [
    "https://acme.test/contact",
    "http://acme.test/contact",
    "/contact",
    "contact?plan=pro",
    "//acme.test/contact",
  ]) {
    expect(safeHref(url)).toBe(url);
  }
});

test("any other address gives no link", () => {
  for (const url of [
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,<p>hi</p>",
    "mailto:sales@acme.test",
    "http://",
    "",
    null,
    undefined,
  ]) {
    expect(safeHref(url)).toBeNull();
  }
});
