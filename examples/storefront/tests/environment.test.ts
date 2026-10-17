// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { LIVE_VARIABLES, readEnvironment } from "../server/environment.ts";

const live = {
  KAITEN_API_URL: "https://kaiten.test/api",
  KAITEN_API_TOKEN: "ksh_from_the_environment",
  KAITEN_PUBLISHABLE_KEY: "pk_from_the_environment",
  STOREFRONT_CUSTOMER_SLUG: "initech",
  STOREFRONT_INSTANCE_SLUG: "initech-lab",
};

describe("which Kaiten the storefront runs against", () => {
  test("a stand-in, when nothing names a Kaiten", () => {
    expect(readEnvironment({})).toEqual({ mode: "double" });
  });

  test("a stand-in, when what names a Kaiten is empty: a test runner switches it off that way", () => {
    const emptied = Object.fromEntries(Object.values(LIVE_VARIABLES).map((name) => [name, ""]));
    expect(readEnvironment(emptied)).toEqual({ mode: "double" });
    expect(
      readEnvironment({
        ...live,
        KAITEN_API_URL: "  ",
        KAITEN_API_TOKEN: "",
        KAITEN_PUBLISHABLE_KEY: "",
        STOREFRONT_CUSTOMER_SLUG: "",
        STOREFRONT_INSTANCE_SLUG: "",
      }),
    ).toEqual({
      mode: "double",
    });
  });

  test("the Kaiten the variables name, when all of them do", () => {
    expect(readEnvironment(live)).toEqual({
      mode: "live",
      apiUrl: "https://kaiten.test/api",
      serverToken: "ksh_from_the_environment",
      publishableKey: "pk_from_the_environment",
      customerSlug: "initech",
      instanceSlug: "initech-lab",
    });
  });

  test("a refusal that names what is missing, when only some of them do", () => {
    const { KAITEN_API_TOKEN: _token, STOREFRONT_INSTANCE_SLUG: _instance, ...rest } = live;
    expect(() => readEnvironment(rest)).toThrow(
      /These are missing: KAITEN_API_TOKEN, STOREFRONT_INSTANCE_SLUG\./,
    );
    // One variable left over from another project is not a storefront.
    expect(() => readEnvironment({ KAITEN_API_URL: live.KAITEN_API_URL })).toThrow(
      /KAITEN_API_TOKEN, KAITEN_PUBLISHABLE_KEY, STOREFRONT_CUSTOMER_SLUG, STOREFRONT_INSTANCE_SLUG/,
    );
  });

  test("never repeats a value in the refusal", () => {
    const { STOREFRONT_INSTANCE_SLUG: _instance, ...rest } = live;
    let message = "";
    try {
      readEnvironment(rest);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("ksh_from_the_environment");
  });
});
