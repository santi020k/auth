import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  enforceOwnerAuthRequest,
  isRecentAuthentication,
  normalizeAuthEmail,
  normalizeOwnerEmail,
  type OwnerAuthPolicyOptions,
  resolveOwnerAuthPolicy,
} from "../src/index.js";

function options(overrides: Partial<OwnerAuthPolicyOptions> = {}): OwnerAuthPolicyOptions {
  return {
    appName: "Example Owner Workspace",
    baseURL: "https://planner.example.com",
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
      basePath: "/api/auth",
      baseURL: "https://planner.example.com",
      cookiePrefix: "example-owner",
      origin: "https://planner.example.com",
      ownerEmail: "owner@example.com",
      relyingPartyId: "planner.example.com",
      secureCookies: true,
      tableNames: {
        account: "account",
        passkey: "passkey",
        rateLimit: "rateLimit",
        session: "session",
        user: "user",
        verification: "verification",
      },
    });
    assert.equal(normalizeAuthEmail(" MEMBER@EXAMPLE.COM "), "member@example.com");
    assert.equal(normalizeOwnerEmail(" OWNER@EXAMPLE.COM "), "owner@example.com");
  });

  void it("separates the API base URL from a browser and WebAuthn origin", () => {
    const policy = resolveOwnerAuthPolicy(
      options({
        baseURL: "https://api.observatory.example.com",
        browserOrigin: "https://observatory.example.com",
      }),
    );
    assert.deepEqual(policy, {
      basePath: "/api/auth",
      baseURL: "https://api.observatory.example.com",
      cookiePrefix: "example-owner",
      origin: "https://observatory.example.com",
      ownerEmail: "owner@example.com",
      relyingPartyId: "observatory.example.com",
      secureCookies: true,
      tableNames: {
        account: "account",
        passkey: "passkey",
        rateLimit: "rateLimit",
        session: "session",
        user: "user",
        verification: "verification",
      },
    });
  });

  void it("resolves collision-safe model names from one validated prefix", () => {
    const policy = resolveOwnerAuthPolicy(options({ tablePrefix: "owner_v2" }));
    assert.deepEqual(policy.tableNames, {
      account: "owner_v2_account",
      passkey: "owner_v2_passkey",
      rateLimit: "owner_v2_rateLimit",
      session: "owner_v2_session",
      user: "owner_v2_user",
      verification: "owner_v2_verification",
    });
  });

  void it("allows HTTP only for local development origins", () => {
    assert.equal(resolveOwnerAuthPolicy(options({ baseURL: "http://127.0.0.1:8792" })).secureCookies, false);
    assert.throws(
      () => resolveOwnerAuthPolicy(options({ baseURL: "http://planner.example.com" })),
      /owner_auth_origin_invalid/u,
    );
    assert.throws(
      () => resolveOwnerAuthPolicy(options({ baseURL: "https://planner.example.com/path" })),
      /owner_auth_origin_invalid/u,
    );
  });

  void it("requires a unique cookie prefix and a strong application secret", () => {
    assert.throws(() => resolveOwnerAuthPolicy(options({ cookiePrefix: "x" })), /owner_auth_cookie_prefix_invalid/u);
    assert.throws(() => resolveOwnerAuthPolicy(options({ secret: "short" })), /owner_auth_secret_invalid/u);
  });

  void it("checks consumer-defined step-up freshness at exact boundaries", () => {
    const now = Date.parse("2026-09-25T12:00:00.000Z");
    assert.equal(isRecentAuthentication({ authenticatedAt: "2026-09-25T11:45:00.000Z" }, 15 * 60, now), true);
    assert.equal(isRecentAuthentication({ authenticatedAt: "2026-09-25T11:44:59.999Z" }, 15 * 60, now), false);
    assert.equal(isRecentAuthentication({ authenticatedAt: "invalid" }, 15 * 60, now), false);
    assert.throws(
      () => isRecentAuthentication({ authenticatedAt: "2026-09-25T12:00:00.000Z" }, 0, now),
      /auth_step_up_max_age_invalid/u,
    );
  });

  void it("rejects unsafe cross-origin requests before Better Auth handles them", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://planner.example.com/api/auth/sign-in/email-otp", {
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
      new Request("https://planner.example.com/api/auth/sign-in/email-otp", {
        body: JSON.stringify({ email: "owner@example.com", otp: "123456" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 403);
  });

  void it("does not reveal whether a requested email is the configured owner", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://planner.example.com/api/auth/email-otp/send-verification-otp", {
        body: JSON.stringify({ email: "other@example.com", type: "sign-in" }),
        headers: { "Content-Type": "application/json", Origin: "https://planner.example.com" },
        method: "POST",
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
  });

  void it("lets same-origin requests for the owner reach Better Auth", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://planner.example.com/api/auth/email-otp/send-verification-otp", {
        body: JSON.stringify({ email: "owner@example.com", type: "sign-in" }),
        headers: { "Content-Type": "application/json", Origin: "https://planner.example.com" },
        method: "POST",
      }),
    );
    assert.equal(response, null);
  });

  void it("rejects a non-owner sign-in without revealing the configured email", async () => {
    const policy = resolveOwnerAuthPolicy(options());
    const response = await enforceOwnerAuthRequest(
      policy,
      new Request("https://planner.example.com/api/auth/sign-in/email-otp", {
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
