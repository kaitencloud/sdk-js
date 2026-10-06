// Code written against @kaitencloud/client 1.0.0 must keep compiling, unchanged,
// against every 1.x. This file is where that is held: `vp check` type-checks it,
// so a breaking change to the surface it touches fails the build. Do not adapt
// it to a new release to make it pass.

import { describe, expect, test } from "vite-plus/test";

import type { EntitlementType } from "../src/index.ts";

/** Compile-time equality of two types. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const exactly = <T extends true>(): T => true as T;

// `EntitlementType` is the one enumeration 1.0.0 published that has grown since.
// It named three types while the API already sent a fourth, `NUMBER_AI_CREDIT`,
// so a minor release corrected it: a `switch` over it with no `default` stops
// compiling until it has the new case. It is frozen at that state. Another
// member would break the same switches again, and fails the build here.
exactly<Equal<EntitlementType, "BOOLEAN" | "NUMBER" | "CONFIG" | "NUMBER_AI_CREDIT">>();

describe("1.0 enumerations", () => {
  test("EntitlementType is closed over the four types the API sends", () => {
    // Exhaustive without a default: it compiles only while the union is exactly
    // the four members below.
    const meter = (type: EntitlementType): "flag" | "setting" | "metered" => {
      switch (type) {
        case "BOOLEAN":
          return "flag";
        case "CONFIG":
          return "setting";
        case "NUMBER":
        case "NUMBER_AI_CREDIT":
          return "metered";
        default: {
          const unreachable: never = type;
          return unreachable;
        }
      }
    };

    expect(
      (["BOOLEAN", "NUMBER", "CONFIG", "NUMBER_AI_CREDIT"] as const).map((type) => meter(type)),
    ).toEqual(["flag", "metered", "setting", "metered"]);
  });
});
