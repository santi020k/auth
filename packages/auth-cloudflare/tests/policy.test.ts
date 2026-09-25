import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  enforceOwnerAuthRequest,
  normalizeAuthEmail,
  normalizeOwnerEmail,
  type OwnerAuthPolicyOptions,
  resolveMultiUserAuthPolicy,
  resolveOwnerAuthPolicy,
} from "../src/index.js";

type SimpleOwnerAuthPolicyOptions = Extract<OwnerAuthPolicyOptions, { secret: string }>;

function options(overrides: Partial<SimpleOwnerAuthPolicyOptions> = {}): SimpleOwnerAuthPolicyOptions {
  return {
    appName: "Example Owner Workspace",
    applicationOrigin: "https://planner.example.com",
    authServerURL: "https://api.planner.example.com",
    cookiePrefix: "example-owner",
    ownerEmail: "Owner@Example.com",
    secret: "a".repeat(32),
    ...overrides,
  };
}

void describe("owner auth policy", () => {
  void it("normalizes the owner identity and derives an isolated relying-party ID", () => {
    const policy = resolveOwnerAuthPolicy(options());
    assert.deepEqual(policy, {
      applicationOrigin: "https://planner.example.com",
      authServerOrigin: "https://api.planner.example.com",
      basePath: "/api/auth",
      cookiePrefix: "example-owner",
      emailOtpRateLimit: { max: 3, window: 600 },
      ownerEmail: "owner@example.com",
      relyingPartyId: "planner.example.com",
      secureCookies: true,
    });
    assert.equal(normalizeAuthEmail(" MEMBER@EXAMPLE.COM "), "member@example.com");
    assert.equal(normalizeOwnerEmail(" OWNER@EXAMPLE.COM "), "owner@example.com");
  });

  void it("resolves the shared policy without exposing a consumer authorization callback", () => {
    const policy = resolveMultiUserAuthPolicy(options());
    assert.deepEqual(policy, {
      applicationOrigin: "https://planner.example.com",
      authServerOrigin: "https://api.planner.example.com",
      basePath: "/api/auth",
      cookiePrefix: "example-owner",
      emailOtpRateLimit: { max: 3, window: 600 },
      relyingPartyId: "planner.example.com",
      secureCookies: true,
    });
  });

  void it("allows HTTP only for local development origins", () => {
    assert.equal(
      resolveOwnerAuthPolicy(
        options({ applicationOrigin: "http://127.0.0.1:4321", authServerURL: "http://127.0.0.1:8792" }),
      ).secureCookies,
      false,
    );
    assert.throws(
      () => resolveOwnerAuthPolicy(options({ applicationOrigin: "http://planner.example.com" })),
      /owner_auth_origin_invalid/u,
    );
    assert.throws(
      () => resolveOwnerAuthPolicy(options({ authServerURL: "https://api.planner.example.com/path" })),
      /owner_auth_origin_invalid/u,
    );
  });

  void it("requires the auth server to use the application's exact scheme and site", () => {
    assert.throws(
      () => resolveOwnerAuthPolicy(options({ authServerURL: "https://api.example.com" })),
      /owner_auth_origins_not_same_site/u,
    );
    assert.throws(
      () => resolveOwnerAuthPolicy(options({ authServerURL: "https://planner.example.net" })),
      /owner_auth_origins_not_same_site/u,
    );
  });

  void it("requires a unique cookie prefix and a strong application secret", () => {
    assert.throws(() => resolveOwnerAuthPolicy(options({ cookiePrefix: "x" })), /owner_auth_cookie_prefix_invalid/u);
    assert.throws(() => resolveOwnerAuthPolicy(options({ secret: "short" })), /owner_auth_secret_invalid/u);
  });

  void it("accepts validated versioned secrets with an optional legacy fallback", () => {
    const policy = resolveOwnerAuthPolicy({
      appName: "Example Owner Workspace",
      applicationOrigin: "https://planner.example.com",
      authServerURL: "https://api.planner.example.com",
      cookiePrefix: "example-owner",
      legacySecret: "l".repeat(32),
      ownerEmail: "owner@example.com",
      secrets: [
        { value: "c".repeat(32), version: 2 },
        { value: "p".repeat(32), version: 1 },
      ],
    });
    assert.equal(policy.relyingPartyId, "planner.example.com");
  });

  void it("validates email OTP rate-limit overrides", () => {
    assert.deepEqual(
      resolveOwnerAuthPolicy(options({ emailOtpRateLimit: { max: 2, window: 900 } })).emailOtpRateLimit,
      {
        max: 2,
        window: 900,
      },
    );
    assert.throws(
      () => resolveOwnerAuthPolicy(options({ emailOtpRateLimit: { max: 0, window: 600 } })),
      /owner_auth_email_otp_rate_limit_invalid/u,
    );
  });

  void it("rejects unsafe cross-origin requests before Better Auth handles them", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://api.planner.example.com/api/auth/sign-in/email-otp", {
        body: JSON.stringify({ email: "owner@example.com", otp: "123456" }),
        headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
        method: "POST",
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      code: "request_origin_not_allowed",
      message: "request_origin_not_allowed",
    });
  });

  void it("rejects an unsafe request when the Origin header is missing", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://api.planner.example.com/api/auth/sign-in/email-otp", {
        body: JSON.stringify({ email: "owner@example.com", otp: "123456" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 403);
  });

  void it("lets allowed OTP send requests reach the response-normalizing handler", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const inputs = [
      { email: "owner@example.com", type: "sign-in" },
      { email: "other@example.com", type: "sign-in" },
      { email: "owner@example.com", type: "invalid" },
      { email: "other@example.com", type: "invalid" },
    ];
    for (const body of inputs) {
      const response = await enforceOwnerAuthRequest(
        policy,
        new Request("https://api.planner.example.com/api/auth/email-otp/send-verification-otp", {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json", Origin: "https://planner.example.com" },
          method: "POST",
        }),
      );
      assert.equal(response, null);
    }
  });

  void it("rejects a non-owner sign-in without revealing the configured email", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://api.planner.example.com/api/auth/sign-in/email-otp", {
        body: JSON.stringify({ email: "other@example.com", otp: "123456" }),
        headers: { "Content-Type": "application/json", Origin: "https://planner.example.com" },
        method: "POST",
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      code: "invalid_owner_credentials",
      message: "invalid_owner_credentials",
    });
  });

  void it("handles an allowed preflight with exact credentialed CORS headers", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://api.planner.example.com/api/auth/sign-in/email-otp", {
        headers: {
          "Access-Control-Request-Headers": "content-type",
          "Access-Control-Request-Method": "POST",
          Origin: "https://planner.example.com",
        },
        method: "OPTIONS",
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://planner.example.com");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  });

  void it("rejects a preflight from every origin except the configured application", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://api.planner.example.com/api/auth/sign-in/email-otp", {
        headers: { "Access-Control-Request-Method": "POST", Origin: "https://other.planner.example.com" },
        method: "OPTIONS",
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  });

  void it("ignores requests outside the configured auth boundary", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://planner.example.com/api/projects", {
        method: "POST",
      }),
    );
    assert.equal(response, null);
  });
});
