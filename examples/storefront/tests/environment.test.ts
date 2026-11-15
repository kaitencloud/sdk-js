// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, loadEnv, preview, resolveConfig, type UserConfigFnObject } from "vite-plus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import {
  describeEnvironment,
  LIVE_VARIABLES,
  loadEnvironment,
  loadEnvironmentVariables,
  readEnvironment,
  signsUp,
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

  test("sign-up mode, when the Kaiten is named and no customer is: visitors make their own", () => {
    const {
      STOREFRONT_CUSTOMER_SLUG: _customer,
      STOREFRONT_INSTANCE_SLUG: _instance,
      ...kaiten
    } = live;
    const environment = readEnvironment(kaiten);
    expect(environment).toEqual({
      mode: "live",
      apiUrl: "https://kaiten.test/api",
      serverToken: "ksh_from_the_environment",
      publishableKey: "pk_from_the_environment",
    });
    expect("customerSlug" in environment).toBe(false);
    expect(signsUp(environment)).toBe(true);
    expect(signsUp(readEnvironment(live))).toBe(false);
    expect(signsUp(readEnvironment({}))).toBe(false);
    // Empty slugs are no slugs, as everywhere.
    expect(
      signsUp(
        readEnvironment({ ...kaiten, STOREFRONT_CUSTOMER_SLUG: " ", STOREFRONT_INSTANCE_SLUG: "" }),
      ),
    ).toBe(true);
  });

  test.each([
    ["STOREFRONT_CUSTOMER_SLUG", "STOREFRONT_INSTANCE_SLUG"],
    ["STOREFRONT_INSTANCE_SLUG", "STOREFRONT_CUSTOMER_SLUG"],
  ])(
    "a refusal that names the half of the pair that is missing, when only %s is set",
    (given, missing) => {
      const { KAITEN_API_URL, KAITEN_API_TOKEN, KAITEN_PUBLISHABLE_KEY } = live;
      const variables = {
        KAITEN_API_URL,
        KAITEN_API_TOKEN,
        KAITEN_PUBLISHABLE_KEY,
        [given]: "initech",
      };
      expect(() => readEnvironment(variables)).toThrow(
        new RegExp(`These are missing: ${missing}\\.`),
      );
      expect(() => readEnvironment(variables)).toThrow(
        /STOREFRONT_CUSTOMER_SLUG and STOREFRONT_INSTANCE_SLUG go together: both to sign in as one customer, neither to let visitors sign up/,
      );
    },
  );

  test("a customer without a Kaiten is refused, naming the Kaiten", () => {
    expect(() =>
      readEnvironment({
        STOREFRONT_CUSTOMER_SLUG: "initech",
        STOREFRONT_INSTANCE_SLUG: "initech-lab",
      }),
    ).toThrow(/These are missing: KAITEN_API_URL, KAITEN_API_TOKEN, KAITEN_PUBLISHABLE_KEY\./);
  });

  test("a half Kaiten and half a customer is refused, naming both", () => {
    expect(() =>
      readEnvironment({ KAITEN_API_URL: live.KAITEN_API_URL, STOREFRONT_CUSTOMER_SLUG: "initech" }),
    ).toThrow(
      /These are missing: KAITEN_API_TOKEN, KAITEN_PUBLISHABLE_KEY, STOREFRONT_INSTANCE_SLUG\./,
    );
  });

  test("a secret for the cookie is taken when it is long enough, in every mode", () => {
    const secret = "s".repeat(32);
    const {
      STOREFRONT_CUSTOMER_SLUG: _customer,
      STOREFRONT_INSTANCE_SLUG: _instance,
      ...kaiten
    } = live;
    expect(readEnvironment({ ...kaiten, STOREFRONT_COOKIE_SECRET: secret })).toEqual({
      mode: "live",
      apiUrl: "https://kaiten.test/api",
      serverToken: "ksh_from_the_environment",
      publishableKey: "pk_from_the_environment",
      cookieSecret: secret,
    });
    expect(readEnvironment({ ...live, STOREFRONT_COOKIE_SECRET: secret })).toMatchObject({
      customerSlug: "initech",
      cookieSecret: secret,
    });
    expect(readEnvironment({ STOREFRONT_COOKIE_SECRET: secret })).toEqual({
      mode: "double",
      cookieSecret: secret,
    });
    // Surrounding space is not part of a secret, and an empty one is none.
    expect(readEnvironment({ STOREFRONT_COOKIE_SECRET: `  ${secret}\n` })).toMatchObject({
      cookieSecret: secret,
    });
    expect(readEnvironment({ ...kaiten, STOREFRONT_COOKIE_SECRET: "" })).not.toHaveProperty(
      "cookieSecret",
    );
  });

  test("a secret that is too short is refused, by name, and never repeated", () => {
    let message = "";
    try {
      readEnvironment({ ...live, STOREFRONT_COOKIE_SECRET: "tooshort-secret" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/STOREFRONT_COOKIE_SECRET must be at least 32 characters/);
    expect(message).not.toContain("tooshort-secret");
    // In the stand-in's mode too: a secret that is wrong is wrong wherever it is.
    expect(() => readEnvironment({ STOREFRONT_COOKIE_SECRET: "short" })).toThrow(
      /STOREFRONT_COOKIE_SECRET/,
    );
  });

  test("the secret is not what tells the stand-in from a Kaiten", () => {
    expect(readEnvironment({ STOREFRONT_COOKIE_SECRET: "" })).toEqual({ mode: "double" });
    expect(() =>
      readEnvironment({ ...live, KAITEN_API_TOKEN: "", STOREFRONT_COOKIE_SECRET: "s".repeat(40) }),
    ).toThrow(/These are missing: KAITEN_API_TOKEN\./);
  });

  test("says at start what the storefront runs against, and what a sign-up needs", () => {
    const {
      STOREFRONT_CUSTOMER_SLUG: _customer,
      STOREFRONT_INSTANCE_SLUG: _instance,
      ...kaiten
    } = live;

    expect(describeEnvironment(readEnvironment(live))).toEqual([
      "storefront: running against the Kaiten at https://kaiten.test/api, as the customer initech",
    ]);
    const signUp = describeEnvironment(readEnvironment(kaiten));
    expect(signUp[0]).toBe(
      "storefront: running against the Kaiten at https://kaiten.test/api; visitors sign up (KAITEN_API_TOKEN needs write:customers, write:instances and write:customer_sessions)",
    );
    // Without a secret the accounts are forgotten at each restart, and the log says so.
    expect(signUp[1]).toContain("forgotten when the server restarts");
    expect(signUp[1]).toContain("STOREFRONT_COOKIE_SECRET");
    expect(signUp).toHaveLength(2);
    expect(
      describeEnvironment(readEnvironment({ ...kaiten, STOREFRONT_COOKIE_SECRET: "s".repeat(32) })),
    ).toHaveLength(1);
    const double = describeEnvironment(readEnvironment({}));
    expect(double[0]).toContain("stand-in for Kaiten");
    // The stand-in's accounts are as short-lived as a live storefront's without a secret, and it says so too.
    expect(double[1]).toContain("forgotten when the server restarts");
    expect(double).toHaveLength(2);
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

  test("a .env file that names the Kaiten and no customer is a storefront whose visitors sign up", () => {
    const {
      STOREFRONT_CUSTOMER_SLUG: _customer,
      STOREFRONT_INSTANCE_SLUG: _instance,
      ...kaiten
    } = live;
    write(".env", { ...kaiten, STOREFRONT_COOKIE_SECRET: "f".repeat(40) });
    expect(loadEnvironment("development", directory)).toEqual({
      mode: "live",
      apiUrl: "https://kaiten.test/api",
      serverToken: "ksh_from_the_environment",
      publishableKey: "pk_from_the_environment",
      cookieSecret: "f".repeat(40),
    });
    // The shell wins here too, and an empty one takes the secret away.
    process.env.STOREFRONT_COOKIE_SECRET = "";
    expect(loadEnvironment("development", directory)).not.toHaveProperty("cookieSecret");
  });

  test("a .env file with half of a customer is refused", () => {
    write(".env", { ...live, STOREFRONT_INSTANCE_SLUG: "" });
    expect(() => loadEnvironment("development", directory)).toThrow(
      /These are missing: STOREFRONT_INSTANCE_SLUG\./,
    );
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

  test("only the storefront's variables are taken from the files", () => {
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

    test("the dev server says that visitors sign up, and what that needs, when no customer is named", async () => {
      const {
        STOREFRONT_CUSTOMER_SLUG: _customer,
        STOREFRONT_INSTANCE_SLUG: _instance,
        ...kaiten
      } = live;
      write(".env", kaiten);
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
      const log = lines.join("\n");
      expect(log).toContain(
        "running against the Kaiten at https://kaiten.test/api; visitors sign up",
      );
      expect(log).toContain("write:customers, write:instances and write:customer_sessions");
      expect(log).toContain("forgotten when the server restarts");
      expect(log).not.toContain("as the customer");
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
