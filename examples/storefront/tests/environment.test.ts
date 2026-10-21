// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, loadEnv, preview, resolveConfig, type UserConfigFnObject } from "vite-plus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import {
  LIVE_VARIABLES,
  loadEnvironment,
  loadEnvironmentVariables,
  readEnvironment,
} from "../server/environment.ts";
import { storefront } from "../server/plugin.ts";
import config from "../vite.config.ts";

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

const NAMES = Object.values(LIVE_VARIABLES);

/** The same five variables, as the text of an env file. */
const envFile = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");

const other = {
  KAITEN_API_URL: "https://other.test/api",
  KAITEN_API_TOKEN: "ksh_from_another_file",
  KAITEN_PUBLISHABLE_KEY: "pk_from_another_file",
  STOREFRONT_CUSTOMER_SLUG: "globex",
  STOREFRONT_INSTANCE_SLUG: "globex-lab",
};

describe("which Kaiten the storefront runs against, from the shell and the .env files", () => {
  let directory: string;
  let saved: Record<string, string | undefined>;

  const write = (name: string, values: Record<string, string>) =>
    writeFileSync(join(directory, name), envFile(values));

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "storefront-env-"));
    // A developer's own shell may hold these: the tests set the shell they mean.
    saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
    for (const name of NAMES) delete process.env[name];
  });

  afterEach(() => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(directory, { recursive: true, force: true });
  });

  test("a stand-in, with no file and an empty shell", () => {
    expect(loadEnvironment("development", directory)).toEqual({ mode: "double" });
  });

  test("the Kaiten a .env file names, with nothing in the shell", () => {
    write(".env", live);
    expect(loadEnvironment("development", directory)).toEqual({
      mode: "live",
      apiUrl: "https://kaiten.test/api",
      serverToken: "ksh_from_the_environment",
      publishableKey: "pk_from_the_environment",
      customerSlug: "initech",
      instanceSlug: "initech-lab",
    });
  });

  test("the Kaiten the shell names, with no file", () => {
    Object.assign(process.env, live);
    expect(loadEnvironment("development", directory)).toMatchObject({
      mode: "live",
      apiUrl: "https://kaiten.test/api",
      instanceSlug: "initech-lab",
    });
  });

  test("a variable of the shell wins over the file", () => {
    write(".env", live);
    process.env.KAITEN_API_URL = "https://shell.test/api";
    process.env.STOREFRONT_INSTANCE_SLUG = "shell-lab";
    expect(loadEnvironment("development", directory)).toMatchObject({
      mode: "live",
      apiUrl: "https://shell.test/api",
      serverToken: "ksh_from_the_environment",
      instanceSlug: "shell-lab",
    });
  });

  test("an empty shell variable wins over the file: a test runner switches live mode off that way", () => {
    write(".env", live);
    write(".env.local", live);
    for (const name of NAMES) process.env[name] = "";
    expect(loadEnvironment("development", directory)).toEqual({ mode: "double" });
    expect(loadEnvironment("production", directory)).toEqual({ mode: "double" });
  });

  test("a single empty shell variable removes that variable, and the storefront refuses to start", () => {
    write(".env", live);
    process.env.KAITEN_API_TOKEN = "";
    expect(() => loadEnvironment("development", directory)).toThrow(
      /These are missing: KAITEN_API_TOKEN\./,
    );
  });

  test("a partial set is refused, naming what is missing, and says where the variables can come from", () => {
    const { KAITEN_API_TOKEN: _token, STOREFRONT_INSTANCE_SLUG: _instance, ...rest } = live;
    write(".env", rest);
    expect(() => loadEnvironment("development", directory)).toThrow(
      /These are missing: KAITEN_API_TOKEN, STOREFRONT_INSTANCE_SLUG\./,
    );
    expect(() => loadEnvironment("development", directory)).toThrow(
      /in the shell or in a \.env file/,
    );
    // The two halves add up: three in the file and the rest in the shell is a whole set.
    process.env.KAITEN_API_TOKEN = "ksh_from_the_shell";
    process.env.STOREFRONT_INSTANCE_SLUG = "shell-lab";
    expect(loadEnvironment("development", directory)).toMatchObject({
      mode: "live",
      serverToken: "ksh_from_the_shell",
      instanceSlug: "shell-lab",
    });
  });

  test("the files are read the way Vite reads them: .env, .env.local, .env.[mode], .env.[mode].local", () => {
    write(".env", live);
    expect(loadEnvironment("development", directory)).toMatchObject({ customerSlug: "initech" });

    write(".env.production", { ...live, STOREFRONT_CUSTOMER_SLUG: "from-mode" });
    expect(loadEnvironment("development", directory)).toMatchObject({ customerSlug: "initech" });
    expect(loadEnvironment("production", directory)).toMatchObject({ customerSlug: "from-mode" });

    write(".env.local", { STOREFRONT_CUSTOMER_SLUG: "from-local" });
    expect(loadEnvironment("development", directory)).toMatchObject({
      customerSlug: "from-local",
    });
    // .env.[mode] outranks .env.local, and .env.[mode].local outranks both.
    expect(loadEnvironment("production", directory)).toMatchObject({ customerSlug: "from-mode" });
    write(".env.production.local", other);
    expect(loadEnvironment("production", directory)).toMatchObject({
      apiUrl: "https://other.test/api",
      customerSlug: "globex",
    });
  });

  test("Vite expands $NAME in a file's values, and a backslash keeps a literal $", () => {
    process.env.STOREFRONT_TEST_PREFIX = "ksh_expanded";
    try {
      writeFileSync(
        join(directory, ".env"),
        envFile({ ...live, KAITEN_API_TOKEN: "$STOREFRONT_TEST_PREFIX" }) +
          "\nSTOREFRONT_CUSTOMER_SLUG=in\\$itech\n",
      );
      const variables = loadEnvironmentVariables("development", directory);
      expect(variables.KAITEN_API_TOKEN).toBe("ksh_expanded");
      expect(variables.STOREFRONT_CUSTOMER_SLUG).toBe("in$itech");
    } finally {
      delete process.env.STOREFRONT_TEST_PREFIX;
    }
  });

  test("only the five variables are taken from the files", () => {
    write(".env", { ...live, SOMETHING_ELSE: "x", VITE_PUBLIC: "y" });
    expect(Object.keys(loadEnvironmentVariables("development", directory)).sort()).toEqual(
      [...NAMES].sort(),
    );
  });

  describe("on the server only", () => {
    const backend = (mode: string) => {
      const resolved = (config as UserConfigFnObject)({
        command: "serve",
        mode,
        isSsrBuild: false,
        isPreview: false,
      });
      const plugins = (resolved.plugins ?? []) as { name?: string }[];
      return plugins.some((plugin) => plugin?.name === "storefront-backend");
    };

    test("`vp test` does not start the backend, so a developer's .env cannot make it go live or stop it", () => {
      expect(backend("test")).toBe(false);
      expect(backend("development")).toBe(true);
      expect(backend("production")).toBe(true);
    });

    test("Vite exposes none of them to the page, whatever the files hold", async () => {
      write(".env", live);
      write(".env.local", { ...live, VITE_PUBLIC: "visible" });

      // What `import.meta.env` can hold: the variables of the default `VITE_` prefix.
      expect(loadEnv("development", directory, "VITE_")).toEqual({ VITE_PUBLIC: "visible" });

      const config = await resolveConfig(
        { root: directory, configFile: false, envDir: directory, logLevel: "silent" },
        "build",
      );
      expect(config.env).toMatchObject({ VITE_PUBLIC: "visible" });
      const exposed = JSON.stringify(config.env);
      for (const name of NAMES) expect(exposed).not.toContain(name);
      for (const value of Object.values(live)) expect(exposed).not.toContain(value);
    });

    test("the dev server reads the .env file of its envDir", async () => {
      write(".env", live);
      const lines: string[] = [];
      const server = await createServer({
        root: directory,
        configFile: false,
        envDir: directory,
        plugins: [storefront()],
        server: { middlewareMode: true },
        customLogger: {
          info: (message) => lines.push(message),
          warn: () => {},
          warnOnce: () => {},
          error: () => {},
          clearScreen: () => {},
          hasErrorLogged: () => false,
          hasWarned: false,
        },
      });
      await server.close();
      expect(lines.join("\n")).toContain("running against the Kaiten at https://kaiten.test/api");
    });

    test("so does the preview server, and a variable of the shell wins there too", async () => {
      write(".env", live);
      process.env.KAITEN_API_URL = "https://shell.test/api";
      mkdirSync(join(directory, "dist"));
      const lines: string[] = [];
      const server = await preview({
        root: directory,
        configFile: false,
        envDir: directory,
        plugins: [storefront()],
        preview: { host: "127.0.0.1", port: 0 },
        customLogger: {
          info: (message) => lines.push(message),
          warn: () => {},
          warnOnce: () => {},
          error: () => {},
          clearScreen: () => {},
          hasErrorLogged: () => false,
          hasWarned: false,
        },
      });
      await new Promise<void>((done) => server.httpServer.close(() => done()));
      expect(lines.join("\n")).toContain("running against the Kaiten at https://shell.test/api");
    });

    test("an empty shell keeps the dev server on the stand-in, whatever a .env.local holds", async () => {
      write(".env.local", live);
      for (const name of NAMES) process.env[name] = "";
      const lines: string[] = [];
      const server = await createServer({
        root: directory,
        configFile: false,
        envDir: directory,
        plugins: [storefront()],
        server: { middlewareMode: true },
        customLogger: {
          info: (message) => lines.push(message),
          warn: () => {},
          warnOnce: () => {},
          error: () => {},
          clearScreen: () => {},
          hasErrorLogged: () => false,
          hasWarned: false,
        },
      });
      await server.close();
      expect(lines.join("\n")).toContain("running against a stand-in for Kaiten");
    });
  });
});
