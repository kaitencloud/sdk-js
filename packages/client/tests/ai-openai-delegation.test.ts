// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vite-plus/test";

import { wrapByDelegation as delegate } from "../src/ai/wrap.ts";

const METHODS = ["chat.completions.create"];

function wrap(client: object) {
  return delegate(
    client,
    METHODS,
    (_method, fn, owner) =>
      (...args) =>
        fn.apply(owner, args),
  );
}

describe("OpenAI delegation", () => {
  it("does not mutate nested non-extensible provider resources", () => {
    const completions = Object.preventExtensions({ create: () => "answer" });
    const chat = Object.preventExtensions({ completions });
    const client = { chat };
    const beforeChat = Object.getOwnPropertyDescriptors(chat);
    const beforeCompletions = Object.getOwnPropertyDescriptors(completions);
    const wrapped = wrap(client) as typeof client;

    expect(wrapped.chat.completions.create()).toBe("answer");
    expect(Object.getOwnPropertyDescriptors(chat)).toEqual(beforeChat);
    expect(Object.getOwnPropertyDescriptors(completions)).toEqual(beforeCompletions);
    expect(wrapped.chat).toBe(wrapped.chat);
    expect(wrapped.chat.completions.create).toBe(wrapped.chat.completions.create);
  });

  it("refreshes cached wrappers when a provider method or resource is reassigned", () => {
    const client = { chat: { completions: { create: () => "first" } } };
    const wrapped = wrap(client) as typeof client;
    expect(wrapped.chat.completions.create()).toBe("first");

    client.chat.completions.create = () => "second";
    expect(wrapped.chat.completions.create()).toBe("second");

    client.chat.completions = { create: () => "third" };
    expect(wrapped.chat.completions.create()).toBe("third");
    expect(Object.hasOwn(client.chat, "__source")).toBe(false);
    expect(Object.hasOwn(client.chat.completions, "__source")).toBe(false);
  });
});
