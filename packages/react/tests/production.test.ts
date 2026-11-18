// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
//
// Whether the host runs a production build, as every development-only warning of this package
// asks it. A bundler replaces `process.env.NODE_ENV` only as a whole expression: a `typeof
// process` check beside it is left as it is, and is false in a browser, so a guard written that
// way never saw a production bundle, and its warnings reached production consoles.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { transformWithOxc } from "vite-plus";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { isProduction } from "../src/lib/production.ts";

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const HELPER = "src/lib/production.ts";

/**
 * The helper as a bundler hands it to a browser: `define` says what the bundler replaces, and
 * the context it runs in has no `process`.
 */
async function bundledForABrowser(define: Record<string, string>): Promise<boolean> {
  const { code } = await transformWithOxc(readFileSync(join(PACKAGE, HELPER), "utf8"), HELPER, {
    define,
  });
  const browser: { isProduction?: () => boolean } = {};
  runInNewContext(code.replace(/^export /gm, ""), browser);
  return browser.isProduction!();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isProduction", () => {
  test("is true in a production bundle, which replaced NODE_ENV and has no process", async () => {
    expect(await bundledForABrowser({ "process.env.NODE_ENV": '"production"' })).toBe(true);
  });

  test("is false in a development bundle", async () => {
    expect(await bundledForABrowser({ "process.env.NODE_ENV": '"development"' })).toBe(false);
  });

  test("is false, and throws nothing, where nothing replaced NODE_ENV and there is no process", async () => {
    expect(await bundledForABrowser({})).toBe(false);
  });

  test("reads NODE_ENV where there is a process", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(isProduction()).toBe(false);
  });
});

test("every source reads NODE_ENV through the helper alone", () => {
  const readers = readdirSync(join(PACKAGE, "src"), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => `src/${file}`)
    .filter((file) => readFileSync(join(PACKAGE, file), "utf8").includes("NODE_ENV"))
    .sort();
  expect(readers).toEqual([HELPER]);
});
