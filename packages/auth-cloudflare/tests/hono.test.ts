import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Hono } from "hono";

import { createOwnerAuthMiddleware, OWNER_AUTH_SESSION_VARIABLE, type OwnerAuthEnv } from "../src/hono.js";
import type { OwnerAuthInstance, OwnerAuthSessionIdentity } from "../src/index.js";

const identity: OwnerAuthSessionIdentity = {
  email: "owner@example.com",
  userId: "owner-user-id",
};

function ownerAuth(resolveSession: OwnerAuthInstance["resolveSession"]): OwnerAuthInstance {
  return {
    handler: () => Promise.resolve(new Response()),
    policy: {
      applicationOrigin: "https://example.com",
      authServerOrigin: "https://api.example.com",
      basePath: "/api/auth",
      cookiePrefix: "example-owner",
      emailOtpRateLimit: { max: 3, window: 600 },
      ownerEmail: identity.email,
      relyingPartyId: "example.com",
      secureCookies: true,
    },
    resolveSession,
  };
}

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
