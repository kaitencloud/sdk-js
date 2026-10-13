import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the storefront, in Chromium.
 *
 * Run them after `vp run -r build`, from this directory: `vp run test:e2e`. They serve the
 * storefront's build (`vp preview`), which is the page, its backend, and a stand-in for Kaiten:
 * `checkout.spec.ts` and `failures.spec.ts` run against that stand-in. It needs no Kaiten, no
 * account and no network, so they run everywhere, CI included.
 */
const PORT = 4173;

/** The environment of the storefront's server: what the stand-in runs on, and nothing of the shell's. */
const standInEnvironment = {
  KAITEN_API_URL: "",
  KAITEN_API_TOKEN: "",
  KAITEN_PUBLISHABLE_KEY: "",
  STOREFRONT_CUSTOMER_SLUG: "",
  STOREFRONT_INSTANCE_SLUG: "",
};

export default defineConfig({
  testDir: "e2e",
  // The stand-in is one process that every test shares, and each test starts it over.
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
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORT}` },
    },
  ],
  webServer: {
    command: `vp preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/storefront-api/config`,
    // An empty variable is an unset one: nothing the shell holds can switch this server to a Kaiten.
    env: standInEnvironment,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
