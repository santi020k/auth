import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("presents the complete authentication boundary", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("santi020k auth");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Share authentication policy. Never share identity state.",
  );
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByText("Private production candidate", { exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://auth.santi020k.com/");

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
});
