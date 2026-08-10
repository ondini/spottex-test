import { randomUUID } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

const testClientId = randomUUID();

const config = defineConfig({
  testDir: "./e2e",
  // E2E scenarios intentionally share one PostgreSQL database and exercise
  // globally published catalog versions. Running files in parallel would let a
  // short-lived catalog fixture leak into another customer's analysis.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3004",
    extraHTTPHeaders: { "x-spottex-test-client": testClientId },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3004",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

export default config;
