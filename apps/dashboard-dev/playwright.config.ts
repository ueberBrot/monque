import { defineConfig, devices } from "@playwright/test";

const legacyTests = "./tests/real-db";

export default defineConfig<{ authenticated: boolean; adapter: "express" | "effect" }>({
  testDir: "./tests",
  outputDir: "test-results",
  timeout: 30_000,
  workers: 4,
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    // Headless shell can lose new-tab events: https://github.com/microsoft/playwright/issues/42142
    channel: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "Europe/Berlin",
  },
  projects: [
    {
      name: "host-express",
      testDir: "./tests/hosts",
      use: { ...devices["Desktop Chrome"], adapter: "express" },
    },
    {
      name: "host-effect",
      testDir: "./tests/hosts",
      use: { ...devices["Desktop Chrome"], adapter: "effect" },
    },
    { testDir: legacyTests, name: "mongo-desktop", use: { ...devices["Desktop Chrome"] } },
    { testDir: legacyTests, name: "mongo-mobile", use: { ...devices["Pixel 7"] } },
    {
      testDir: legacyTests,
      name: "mongo-desktop-auth",
      use: { ...devices["Desktop Chrome"], authenticated: true },
    },
    {
      testDir: legacyTests,
      name: "mongo-mobile-auth",
      use: { ...devices["Pixel 7"], authenticated: true },
    },
  ],
});
