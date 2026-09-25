import { expect, test } from "@playwright/test";

test("registers a passkey and signs back in with it", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const authenticator = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      automaticPresenceSimulation: true,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      protocol: "ctap2",
      transport: "internal",
    },
  });

  try {
    await page.goto("/");
    await expect(page).toHaveTitle("santi020k auth playground");

    await page.getByRole("button", { name: "Generate local code" }).click();
    await expect(page.locator("#status")).toHaveText("Code generated locally and filled in.");

    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.locator("#status")).toHaveText("Signed in with the email code.");
    await expect(page.locator("#session")).toContainText("owner@example.com");

    await cdp.send("WebAuthn.setUserVerified", {
      authenticatorId: authenticator.authenticatorId,
      isUserVerified: false,
    });
    await page.getByRole("button", { name: "Add passkey" }).click();
    await expect(page.locator("#status")).toHaveAttribute("data-kind", "error");

    await cdp.send("WebAuthn.setUserVerified", {
      authenticatorId: authenticator.authenticatorId,
      isUserVerified: true,
    });
    await page.getByRole("button", { name: "Add passkey" }).click();
    await expect(page.locator("#status")).toHaveText("Passkey added.");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator("#status")).toHaveText("Signed out.");
    await expect(page.locator("#session")).toHaveText("Signed out");

    await cdp.send("WebAuthn.setUserVerified", {
      authenticatorId: authenticator.authenticatorId,
      isUserVerified: false,
    });
    await page.getByRole("button", { name: "Use passkey" }).click();
    await expect(page.locator("#session")).toHaveText("Signed out");
    await expect(page.locator("#status")).toHaveAttribute("data-kind", "error");

    await cdp.send("WebAuthn.setUserVerified", {
      authenticatorId: authenticator.authenticatorId,
      isUserVerified: true,
    });
    await page.getByRole("button", { name: "Use passkey" }).click();
    await expect(page.locator("#status")).toHaveText("Signed in with a passkey.");
    await expect(page.locator("#session")).toContainText("owner@example.com");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator("#session")).toHaveText("Signed out");

    const revokeResponse = await page.request.post("/api/dev/revoke-owner");
    expect(revokeResponse.status()).toBe(200);

    await page.getByRole("button", { name: "Use passkey" }).click();
    await expect(page.locator("#session")).toHaveText("Signed out");
    await expect(page.locator("#status")).toHaveAttribute("data-kind", "error");
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: authenticator.authenticatorId,
    });
    await cdp.send("WebAuthn.disable");
    await cdp.detach();
  }
});
