import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("presents the complete authentication boundary", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Reusable authentication policy · santi020k auth");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Share authentication policy. Never share identity state.",
  );
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByText("Experimental public release", { exact: true })).toBeVisible();
  await expect(page.getByText(/^v0\.\d+\.\d+$/, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Available on npm as experimental 0.x.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "npm package page" })).toHaveAttribute(
    "href",
    "https://www.npmjs.com/package/@santi020k/auth-cloudflare",
  );
  await expect(page.getByText("@santi020k/auth-cloudflare", { exact: true })).toBeVisible();
  await expect(page.getByText("No cross-application account system", { exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://auth.santi020k.com/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/site.webmanifest");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://auth.santi020k.com/og/home.webp",
  );
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const structuredData = await page.locator('script[type="application/ld+json"]').textContent();
  expect(structuredData).toContain("SoftwareSourceCode");

  for (const id of ["architecture", "security", "integrate", "readiness"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
});

test("supports keyboard navigation in the package manager example", async ({ page }) => {
  await page.goto("/#integrate");
  const tablist = page.getByRole("tablist", { name: "Package installation commands" });
  const pnpmTab = tablist.getByRole("tab", { name: "pnpm" });
  const npmTab = tablist.getByRole("tab", { name: "npm", exact: true });

  await pnpmTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(npmTab).toBeFocused();
  await expect(npmTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("npm install @santi020k/auth-cloudflare", { exact: false })).toBeVisible();
});

test("documents multi-user access without moving product authorization into the package", async ({ page }) => {
  await page.goto("/multi-user");

  await expect(page).toHaveTitle("Multi-user authentication · santi020k auth");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("More accounts, without a shared account system.");
  await expect(page.getByText("Available since v0.3.0", { exact: true })).toBeVisible();
  await expect(page.getByText("createMultiUserAuth", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Membership records, roles, invitations, and recovery", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Expand access without weakening isolation." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Authentication mode comparison" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://auth.santi020k.com/multi-user");
});

test("keeps the multi-user guide accessible and within the viewport", async ({ page }) => {
  await page.goto("/multi-user");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter(({ impact }) => impact === "critical" || impact === "serious");
  expect(seriousViolations).toEqual([]);

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("documents package responsibilities and secure operating boundaries", async ({ page }) => {
  await page.goto("/packages");
  await expect(page).toHaveTitle("Package guide · santi020k auth");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Install only the authentication boundary you own.");
  await expect(page.getByText("@santi020k/auth-machine", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bound persistent rate-limit storage." })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://auth.santi020k.com/packages");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter(({ impact }) => impact === "critical" || impact === "serious");
  expect(seriousViolations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(
    false,
  );
});

test("has no serious accessibility violations or horizontal overflow", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter(({ impact }) => impact === "critical" || impact === "serious");
  expect(seriousViolations).toEqual([]);

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("serves an intentional not-found page", async ({ page }) => {
  const response = await page.goto("/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("That route is outside the boundary.");
  await expect(page.getByRole("link", { name: "Return to auth" })).toHaveAttribute("href", "/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
  );
});

test("serves generated identity and discovery assets", async ({ request }) => {
  const assets = [
    ["/favicon.svg", "image/svg+xml"],
    ["/mask-icon.svg", "image/svg+xml"],
    ["/og/home.webp", "image/webp"],
    ["/site.webmanifest", "application/manifest+json"],
  ] as const;

  for (const [path, contentType] of assets) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be available`).toBe(true);
    expect(response.headers()["content-type"]).toContain(contentType);
  }
});
