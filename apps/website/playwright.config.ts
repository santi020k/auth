import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: true,
  outputDir: "test-results",
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  testDir: "tests",
  use: {
    baseURL: "http://127.0.0.1:4393",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-static.mjs",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:4393",
  },
});
