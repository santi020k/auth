import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSantiAuthClient,
  createSantiAuthHelpers,
  normalizeAuthClientError,
  resolveAuthClientOptions,
} from "../src/index.js";

void describe("auth browser client", () => {
  void it("normalizes an exact HTTPS origin and auth path", () => {
    assert.deepEqual(resolveAuthClientOptions({ basePath: "/auth/v2", baseURL: "https://auth.example.com" }), {
      basePath: "/auth/v2",
      baseURL: "https://auth.example.com",
    });
  });

  void it("allows local HTTP while rejecting unsafe or ambiguous base URLs", () => {
    assert.equal(resolveAuthClientOptions({ baseURL: "http://127.0.0.1:8787" }).baseURL, "http://127.0.0.1:8787");
    assert.throws(() => resolveAuthClientOptions({ baseURL: "http://example.com" }), /auth_client_base_url_invalid/u);
    assert.throws(
      () => resolveAuthClientOptions({ baseURL: "https://example.com/path" }),
      /auth_client_base_url_invalid/u,
    );
    assert.throws(
      () => resolveAuthClientOptions({ basePath: "/api/auth/", baseURL: "https://example.com" }),
      /auth_client_base_path_invalid/u,
    );
    assert.throws(() => resolveAuthClientOptions({ baseURL: "not a URL" }), /auth_client_base_url_invalid/u);
  });

  void it("exposes the email OTP, passkey, session, and sign-out client contracts", () => {
    const client = createSantiAuthClient({ baseURL: "https://example.com" });
    assert.equal(typeof client.emailOtp.sendVerificationOtp, "function");
    assert.equal(typeof client.signIn.emailOtp, "function");
    assert.equal(typeof client.signIn.passkey, "function");
    assert.equal(typeof client.passkey.addPasskey, "function");
    assert.equal(typeof client.getSession, "function");
    assert.equal(typeof client.signOut, "function");
  });

  void it("normalizes Better Fetch, thrown, and unknown errors", () => {
    assert.deepEqual(normalizeAuthClientError({ code: "INVALID OTP", message: "The code is invalid", status: 401 }), {
      code: "invalid_otp",
      message: "The code is invalid",
      status: 401,
    });
    assert.deepEqual(normalizeAuthClientError(new Error("offline")), {
      code: "auth_request_failed",
      message: "offline",
      status: null,
    });
    assert.deepEqual(normalizeAuthClientError(null), {
      code: "auth_request_failed",
      message: "Authentication request failed",
      status: null,
    });
  });

  void it("exposes stable result-based helpers without returning session tokens", async () => {
    const originalFetch = globalThis.fetch;
    const requests: { body: string | null; captchaResponse: string | null; method: string; url: string }[] = [];
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      return request.text().then((body) => {
        requests.push({
          body: body || null,
          captchaResponse: request.headers.get("x-captcha-response"),
          method: request.method,
          url: request.url,
        });
        if (request.url.endsWith("/list-sessions")) {
          return Response.json([
            {
              createdAt: "2026-09-25T12:00:00.000Z",
              expiresAt: "2026-10-25T12:00:00.000Z",
              id: "safe-session-id",
              ipAddress: "127.0.0.1",
              token: "secret-session-token",
              updatedAt: "2026-09-25T12:00:00.000Z",
              userAgent: "test browser",
            },
          ]);
        }
        if (request.url.endsWith("/get-session")) {
          return Response.json({
            session: {
              createdAt: "2026-09-25T12:00:00.000Z",
              expiresAt: "2026-10-25T12:00:00.000Z",
              id: "safe-session-id",
            },
            user: { email: "owner@example.com", id: "owner-id" },
          });
        }
        if (request.url.endsWith("/passkey/list-user-passkeys")) {
          return Response.json([
            {
              backedUp: true,
              createdAt: "2026-09-25T12:00:00.000Z",
              deviceType: "multiDevice",
              id: "passkey-id",
              name: "Laptop",
              publicKey: "not-for-ui",
            },
          ]);
        }
        if (request.url.endsWith("/sign-in/social") || request.url.endsWith("/link-social")) {
          return Response.json({ redirect: true, url: "https://accounts.example.com/authorize" });
        }
        return Response.json({ status: true });
      });
    };

    try {
      const helpers = createSantiAuthHelpers({ baseURL: "https://example.com" });
      assert.equal(typeof helpers.addPasskey, "function");
      assert.equal(typeof helpers.deletePasskey, "function");
      assert.equal(typeof helpers.listPasskeys, "function");
      assert.equal(typeof helpers.renamePasskey, "function");
      assert.equal(typeof helpers.signInWithPasskey, "function");
      assert.equal(typeof helpers.requestEmailOtp, "function");
      assert.equal(typeof helpers.signInWithSocial, "function");
      assert.equal(typeof helpers.linkSocialAccount, "function");

      const codeRequest = await helpers.requestEmailOtp("owner@example.com", { captchaResponse: "turnstile-token" });
      assert.equal(codeRequest.ok, true);
      assert.equal(
        requests.find((request) => request.url.endsWith("/email-otp/send-verification-otp"))?.captchaResponse,
        "turnstile-token",
      );

      const missing = await helpers.revokeSession("not-loaded");
      assert.equal(missing.ok, false);
      assert.equal(missing.error.code, "auth_session_not_loaded");

      const inventory = await helpers.listSessions();
      assert.equal(inventory.ok, true);
      assert.deepEqual(inventory.data, [
        {
          createdAt: "2026-09-25T12:00:00.000Z",
          expiresAt: "2026-10-25T12:00:00.000Z",
          id: "safe-session-id",
          ipAddress: "127.0.0.1",
          updatedAt: "2026-09-25T12:00:00.000Z",
          userAgent: "test browser",
        },
      ]);
      assert.equal(JSON.stringify(inventory.data).includes("secret-session-token"), false);

      const currentSession = await helpers.getSession();
      assert.deepEqual(currentSession, {
        data: {
          authenticatedAt: "2026-09-25T12:00:00.000Z",
          email: "owner@example.com",
          expiresAt: "2026-10-25T12:00:00.000Z",
          sessionId: "safe-session-id",
          userId: "owner-id",
        },
        error: null,
        ok: true,
      });

      const passkeys = await helpers.listPasskeys();
      assert.equal(passkeys.ok, true);
      assert.deepEqual(passkeys.data, [
        {
          backedUp: true,
          createdAt: "2026-09-25T12:00:00.000Z",
          deviceType: "multiDevice",
          id: "passkey-id",
          name: "Laptop",
        },
      ]);
      assert.equal(JSON.stringify(passkeys.data).includes("not-for-ui"), false);

      const revoked = await helpers.revokeSession("safe-session-id");
      assert.equal(revoked.ok, true);
      const revokeRequest = requests.find((request) => request.url.endsWith("/revoke-session"));
      assert.ok(revokeRequest?.body);
      assert.deepEqual(JSON.parse(revokeRequest.body), { token: "secret-session-token" });

      const social = await helpers.signInWithSocial("google", {
        callbackURL: "https://example.com/auth/complete",
        disableRedirect: true,
        scopes: ["openid", "email"],
      });
      assert.deepEqual(social, {
        data: { redirect: true, url: "https://accounts.example.com/authorize" },
        error: null,
        ok: true,
      });
      const socialRequest = requests.find((request) => request.url.endsWith("/sign-in/social"));
      assert.ok(socialRequest?.body);
      assert.deepEqual(JSON.parse(socialRequest.body), {
        callbackURL: "https://example.com/auth/complete",
        disableRedirect: true,
        provider: "google",
        scopes: ["openid", "email"],
      });

      const invalidProvider = await helpers.signInWithSocial("Not Valid");
      assert.equal(invalidProvider.ok, false);
      assert.equal(invalidProvider.error.code, "auth_request_failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
