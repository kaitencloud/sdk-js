// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// Cloudflare's script, loaded once for the page: the first widget asks for it, the others wait for
// the same load, a script that fails is forgotten so that the next try is a new one, and a host's own
// script or a `turnstile` already in the page is used and not loaded twice.

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import {
  loadTurnstile,
  TURNSTILE_SCRIPT_URL,
  type TurnstileApi,
} from "../src/hooks/billing/turnstile.ts";

const api: TurnstileApi = { render: () => "w1", reset: () => {}, remove: () => {} };
const scripts = () =>
  [...document.querySelectorAll<HTMLScriptElement>("script")].filter((script) =>
    script.src.startsWith(TURNSTILE_SCRIPT_URL),
  );

beforeEach(() => {
  vi.useFakeTimers();
  delete (globalThis as { turnstile?: TurnstileApi }).turnstile;
  document.head.innerHTML = "";
});

afterEach(() => {
  delete (globalThis as { turnstile?: TurnstileApi }).turnstile;
  vi.useRealTimers();
});

test("the script is asked for once, for explicit rendering, whoever asks and however often", async () => {
  const first = loadTurnstile();
  const second = loadTurnstile();
  expect(scripts()).toHaveLength(1);
  const [script] = scripts();
  expect(script!.src).toBe(`${TURNSTILE_SCRIPT_URL}?render=explicit`);
  expect(script!.async).toBe(true);

  (globalThis as { turnstile?: TurnstileApi }).turnstile = api;
  script!.dispatchEvent(new Event("load"));
  await expect(first).resolves.toBe(api);
  await expect(second).resolves.toBe(api);
});

test("a turnstile the page already has is used, and no script is added", async () => {
  (globalThis as { turnstile?: TurnstileApi }).turnstile = api;
  await expect(loadTurnstile()).resolves.toBe(api);
  expect(scripts()).toHaveLength(0);
});

test("a script that fails is removed and rejected, and the next try is a new one", async () => {
  const failed = loadTurnstile();
  scripts()[0]!.dispatchEvent(new Event("error"));
  await expect(failed).rejects.toThrow(/could not be loaded/);
  expect(scripts()).toHaveLength(0);

  const again = loadTurnstile();
  expect(scripts()).toHaveLength(1);
  (globalThis as { turnstile?: TurnstileApi }).turnstile = api;
  scripts()[0]!.dispatchEvent(new Event("load"));
  await expect(again).resolves.toBe(api);
});

test("a script that loads and defines nothing is a failure", async () => {
  const empty = loadTurnstile();
  scripts()[0]!.dispatchEvent(new Event("load"));
  await expect(empty).rejects.toThrow(/did not define turnstile/);
  expect(scripts()).toHaveLength(0);
});

test("a script that neither loads nor fails is given up on after 15 seconds", async () => {
  const hung = loadTurnstile();
  const settled = expect(hung).rejects.toThrow(/too long/);
  await vi.advanceTimersByTimeAsync(15_000);
  await settled;
  expect(scripts()).toHaveLength(0);
});

test("the host's own script is waited for, not loaded again", async () => {
  const own = document.createElement("script");
  own.src = `${TURNSTILE_SCRIPT_URL}?onload=ready`;
  document.head.appendChild(own);

  const loading = loadTurnstile();
  expect(scripts()).toHaveLength(1);
  // Loaded before anyone listened: the API appears, and is found.
  (globalThis as { turnstile?: TurnstileApi }).turnstile = api;
  await vi.advanceTimersByTimeAsync(100);
  await expect(loading).resolves.toBe(api);
  // A host's script that stays is not ours to remove.
  expect(scripts()).toHaveLength(1);
});
