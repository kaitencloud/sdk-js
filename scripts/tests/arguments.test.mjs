// The command line of a check: what it reads, and what it refuses.

import { describe, expect, test } from "vite-plus/test";

import { readArguments } from "../lib/arguments.mjs";

describe("readArguments", () => {
  test("reads an option as often as it is given, and a switch", () => {
    const { values, switches } = readArguments(["--dir", "a", "--report", "--dir", "b"], {
      options: ["--dir"],
      switches: ["--report"],
    });

    expect(values["--dir"]).toEqual(["a", "b"]);
    expect(switches.has("--report")).toBe(true);
  });

  test("gives an empty list for an option that was not given", () => {
    const { values, switches } = readArguments([], { options: ["--dir"], switches: ["--report"] });

    expect(values["--dir"]).toEqual([]);
    expect(switches.size).toBe(0);
  });

  test("refuses an argument it does not know, naming what it takes", () => {
    expect(() => readArguments(["--dirs", "build"], { options: ["--dir"] })).toThrow(
      'Unknown argument "--dirs". This check takes --dir.',
    );
    expect(() => readArguments(["--anything"])).toThrow("This check takes no argument.");
  });

  test("refuses an option left without its value, or followed by another option", () => {
    expect(() => readArguments(["--dir"], { options: ["--dir"] })).toThrow("--dir takes a value.");
    expect(() =>
      readArguments(["--dir", "--report"], { options: ["--dir"], switches: ["--report"] }),
    ).toThrow("--dir takes a value.");
  });
});
