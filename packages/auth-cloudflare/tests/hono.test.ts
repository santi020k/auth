import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Hono } from "hono";

import {
  AUTH_SESSION_VARIABLE,
  type AuthEnv,
  createAuthMiddleware,
  createOwnerAuthMiddleware,
  OWNER_AUTH_SESSION_VARIABLE,
  type OwnerAuthEnv,
} from "../src/hono.js";
import {
  type MultiUserAuthInstance,
  type OwnerAuthInstance,
  resolveAuthTableNames,
  type ResolvedAuthSessionIdentity,
} from "../src/index.js";

const identity: ResolvedAuthSessionIdentity = {
  authenticatedAt: "2026-09-25T12:00:00.000Z",
  email: "owner@example.com",
  expiresAt: "2026-10-25T12:00:00.000Z",
  sessionId: "owner-session-id",
  userId: "owner-user-id",
};

function ownerAuth(resolveSession: OwnerAuthInstance["resolveSession"]): OwnerAuthInstance {
  return {
    emergencyLockout: () => Promise.resolve(0),
    handler: () => Promise.resolve(new Response()),
    listSessions: () => Promise.resolve([]),
    policy: {
      applicationOrigin: "https://example.com",
      authServerOrigin: "https://example.com",
      basePath: "/api/auth",
      baseURL: "https://api.example.com",
      cookiePrefix: "example-owner",
      emailOtpRateLimit: { max: 3, window: 600 },
      origin: "https://example.com",
      ownerEmail: identity.email,
      relyingPartyId: "example.com",
      secureCookies: true,
      tableNames: resolveAuthTableNames(),
    },
    resolveSession,
    revokeAllSessions: () => Promise.resolve(0),
    revokeSession: () => Promise.resolve(false),
  };
}

function multiUserAuth(resolveSession: MultiUserAuthInstance["resolveSession"]): MultiUserAuthInstance {
  return {
    emergencyLockout: () => Promise.resolve(0),
    handler: () => Promise.resolve(new Response()),
    listSessions: () => Promise.resolve([]),
    policy: {
      applicationOrigin: "https://example.com",
      authServerOrigin: "https://example.com",
      basePath: "/api/auth",
      baseURL: "https://api.example.com",
      cookiePrefix: "example-members",
      emailOtpRateLimit: { max: 3, window: 600 },
      origin: "https://example.com",
      relyingPartyId: "example.com",
      secureCookies: true,
      tableNames: resolveAuthTableNames(),
    },
    resolveSession,
    revokeAllSessions: () => Promise.resolve(0),
    revokeSession: () => Promise.resolve(false),
  };
}

void describe("multi-user auth Hono middleware", () => {
  void it("exposes an approved identity through the generic session variable", async () => {
    const memberIdentity: ResolvedAuthSessionIdentity = {
      authenticatedAt: "2026-09-25T12:00:00.000Z",
      email: "member@example.com",
      expiresAt: "2026-10-25T12:00:00.000Z",
      sessionId: "member-session-id",
      userId: "member-user-id",
    };
    const app = new Hono<AuthEnv>();
    app.get("/private", createAuthMiddleware(multiUserAuth(() => Promise.resolve(memberIdentity))), (context) => {
      const session = context.get(AUTH_SESSION_VARIABLE);
      assert.strictEqual(session, memberIdentity);
      return context.json(session);
    });

    const response = await app.request("https://app.example.com/private");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), memberIdentity);
  });

  void it("returns a generic non-cacheable 401 for a rejected session", async () => {
    const app = new Hono<AuthEnv>();
    const middleware = createAuthMiddleware(multiUserAuth(() => Promise.resolve(null)));
    app.get("/private", middleware, (context) => context.text("private"));

    const response = await app.request("https://app.example.com/private");

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      code: "auth_session_required",
      message: "auth_session_required",
    });
  });
});

void describe("owner auth Hono middleware", () => {
  void it("resolves the session once and exposes the exact identity downstream", async () => {
    let calls = 0;
    let receivedHeaders: Headers | undefined;
    const auth = ownerAuth((headers) => {
      calls += 1;
      receivedHeaders = headers;
      return Promise.resolve(identity);
    });
    const app = new Hono<OwnerAuthEnv>();
    app.get("/private", createOwnerAuthMiddleware(auth), (context) => {
      const session = context.get(OWNER_AUTH_SESSION_VARIABLE);
      assert.strictEqual(session, identity);
      return context.json(session);
    });

    const response = await app.request("https://app.example.com/private", {
      headers: { Cookie: "example-owner.session_token=token" },
    });

    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.equal(receivedHeaders?.get("Cookie"), "example-owner.session_token=token");
    assert.deepEqual(await response.json(), identity);
  });

  void it("returns a non-cacheable 401 without running downstream handlers", async () => {
    let downstreamRan = false;
    const app = new Hono<OwnerAuthEnv>();
    app.get("/private", createOwnerAuthMiddleware(ownerAuth(() => Promise.resolve(null))), (context) => {
      downstreamRan = true;
      return context.text("private");
    });

    const response = await app.request("https://app.example.com/private");

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(downstreamRan, false);
    assert.deepEqual(await response.json(), {
      code: "owner_auth_session_required",
      message: "owner_auth_session_required",
    });
  });

  void it("resolves an auth instance from the current Cloudflare context", async () => {
    interface TestEnv extends OwnerAuthEnv {
      Bindings: { OWNER_EMAIL: string };
    }

    let configuredEmail: string | undefined;
    const app = new Hono<TestEnv>();
    app.get(
      "/private",
      createOwnerAuthMiddleware<TestEnv>((context) => {
        configuredEmail = context.env.OWNER_EMAIL;
        return ownerAuth(() => Promise.resolve(identity));
      }),
      (context) => context.json(context.var.ownerAuthSession),
    );

    const response = await app.request("https://app.example.com/private", undefined, {
      OWNER_EMAIL: identity.email,
    });

    assert.equal(response.status, 200);
    assert.equal(configuredEmail, identity.email);
  });
});
