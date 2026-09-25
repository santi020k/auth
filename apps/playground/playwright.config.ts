import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:8793",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      'AUTH_E2E_STATE=$(mktemp -d) && node_modules/.bin/wrangler d1 migrations apply auth-playground-development --local --persist-to "$AUTH_E2E_STATE" && pnpm run build:client && exec node_modules/.bin/wrangler dev --port 8793 --persist-to "$AUTH_E2E_STATE"',
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://localhost:8793",
  },
});
