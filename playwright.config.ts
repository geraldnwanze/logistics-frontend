import { defineConfig, devices } from "@playwright/test";

const STUB_PORT = 4010;
const APP_PORT = 3100;

export const STUB_URL = `http://localhost:${STUB_PORT}`;
export const APP_URL = `http://localhost:${APP_PORT}`;
export const REVALIDATE_SECRET = "e2e-revalidate-secret";

/**
 * The app is built and started against a stub of the Laravel public CMS API (tests/e2e/support).
 * Run `npm run test:e2e`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: APP_URL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "node tests/e2e/support/stub-api.mjs",
      url: `${STUB_URL}/__health`,
      reuseExistingServer: !process.env.CI,
      env: { STUB_API_PORT: String(STUB_PORT) },
    },
    {
      command: `npx next build && npx next start -p ${APP_PORT}`,
      url: APP_URL,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        API_URL: STUB_URL,
        NEXT_PUBLIC_API_URL: STUB_URL,
        NEXT_PUBLIC_SITE_URL: APP_URL,
        REVALIDATE_SECRET,
      },
    },
  ],
});
