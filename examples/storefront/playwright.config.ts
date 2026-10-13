import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the storefront, in Chromium.
 *
 * Run them after `vp run -r build`, from this directory: `vp run test:e2e`. They serve the
 * storefront's build (`vp preview`), which is the page, its backend, and a stand-in for Kaiten.
 *
 * - `stand-in` runs `checkout.spec.ts` and `failures.spec.ts` against that stand-in. It needs no
 *   Kaiten, no account and no network, so it runs everywhere, CI included.
 * - `live` runs `live.spec.ts` against a Kaiten of yours, and is skipped without the variables
 *   below. With some of them it fails, and says which are missing, so that a repository that lost
 *   a secret does not look like one that passed.
 */
const LIVE = {
  KAITEN_API_URL: "STOREFRONT_LIVE_API_URL",
  KAITEN_API_TOKEN: "STOREFRONT_LIVE_SERVER_TOKEN",
  KAITEN_PUBLISHABLE_KEY: "STOREFRONT_LIVE_PUBLISHABLE_KEY",
  STOREFRONT_CUSTOMER_SLUG: "STOREFRONT_LIVE_CUSTOMER_SLUG",
  STOREFRONT_INSTANCE_SLUG: "STOREFRONT_LIVE_INSTANCE_SLUG",
} as const;

const given = Object.values(LIVE).filter((name) => (process.env[name] ?? "").trim() !== "");
const live = given.length === Object.values(LIVE).length;
if (given.length > 0 && !live) {
  const missing = Object.values(LIVE).filter((name) => !given.includes(name));
  throw new Error(
    `The live end-to-end tests need all of ${Object.values(LIVE).join(", ")}, or none of them. These are missing: ${missing.join(", ")}.`,
  );
}

const STAND_IN_PORT = 4173;
const LIVE_PORT = 4174;

/** The environment of a storefront server: what the stand-in runs on, and nothing of the shell's. */
const storefrontEnvironment = (values: Partial<Record<keyof typeof LIVE, string>>) =>
  Object.fromEntries(
    Object.keys(LIVE).map((name) => [name, values[name as keyof typeof LIVE] ?? ""]),
  );

export default defineConfig({
  testDir: "e2e",
  // The stand-in is one process that every test of a project shares, and each test starts it over.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: "stand-in",
      testMatch: /(checkout|failures)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${STAND_IN_PORT}` },
    },
    {
      name: "live",
      testMatch: /live\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${LIVE_PORT}` },
    },
  ],
  webServer: [
    {
      command: `vp preview --host 127.0.0.1 --port ${STAND_IN_PORT} --strictPort`,
      url: `http://127.0.0.1:${STAND_IN_PORT}/storefront-api/config`,
      // An empty variable is an unset one: nothing the shell holds can switch this server to a Kaiten.
      env: storefrontEnvironment({}),
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    ...(live
      ? [
          {
            command: `vp preview --host 127.0.0.1 --port ${LIVE_PORT} --strictPort`,
            url: `http://127.0.0.1:${LIVE_PORT}/storefront-api/config`,
            env: storefrontEnvironment(
              Object.fromEntries(
                Object.entries(LIVE).map(([name, source]) => [name, process.env[source]!]),
              ),
            ),
            reuseExistingServer: false,
            timeout: 30_000,
            stdout: "ignore" as const,
            stderr: "pipe" as const,
          },
        ]
      : []),
  ],
});
