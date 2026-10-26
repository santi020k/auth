import { defineConfig, devices } from "@playwright/test";

const baseURL = `http://127.0.0.1:${process.env.PORT ?? "4393"}`;

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
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-static.mjs",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
});
