import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "public-site.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4322",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "pnpm --filter @openrum/site build && pnpm --filter @openrum/site preview --host 127.0.0.1 --port 4322",
    env: { ...process.env, ASTRO_PREVIEW_BACKGROUND: "0" },
    url: "http://127.0.0.1:4322",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
