import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMachineCredential } from "@santi020k/auth-machine";
import { Hono } from "hono";

import {
  createHonoAuthCors,
  createHonoAuthHandler,
  createRequireHonoAuth,
  createRequireHonoMachineAuth,
  createRequireRecentHonoAuth,
  isRecentHonoAuthentication,
  resolveHonoAuthSession,
} from "../src/index.js";

const identity = { email: "owner@example.com", userId: "owner-id" };

function authFor(request: Request) {
  return {
    handler: () => Promise.resolve(Response.json({ path: new URL(request.url).pathname })),
    resolveSession: (headers: Headers) => Promise.resolve(headers.get("Cookie") === "session=valid" ? identity : null),
  };
}

void describe("Hono authentication adapters", () => {
  void it("forwards the untouched request to the auth handler", async () => {
    const app = new Hono();
    app.all(
      "/api/auth/*",
      createHonoAuthHandler((context) => authFor(context.req.raw)),
    );
    const response = await app.request("https://example.com/api/auth/session");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { path: "/api/auth/session" });
  });

  void it("resolves sessions without inventing an identity store", async () => {
    const app = new Hono();
    app.get("/session", async (context) => {
      const session = await resolveHonoAuthSession(context, () => authFor(context.req.raw));
      return context.json(session);
    });
    assert.deepEqual(await (await app.request("https://example.com/session")).json(), null);
    assert.deepEqual(
      await (await app.request("https://example.com/session", { headers: { Cookie: "session=valid" } })).json(),
      identity,
    );
  });

  void it("protects a route and lets the consumer store its own identity shape", async () => {
    const seen: string[] = [];
    const app = new Hono();
    app.use(
      "/private",
      createRequireHonoAuth({
        createAuth: (context) => authFor(context.req.raw),
        onAuthenticated: (_context, session) => {
          seen.push(session.email);
        },
      }),
    );
    app.get("/private", (context) => context.json({ ok: true }));

    assert.equal((await app.request("https://example.com/private")).status, 401);
    assert.equal(
      (await app.request("https://example.com/private", { headers: { Cookie: "session=valid" } })).status,
      200,
    );
    assert.deepEqual(seen, ["owner@example.com"]);
  });

  void it("requires recent authentication for consumer-defined sensitive routes", async () => {
    const now = Date.parse("2026-09-25T12:00:00.000Z");
    const app = new Hono();
    app.use(
      "/sensitive",
      createRequireRecentHonoAuth({
        createAuth: (context) => ({
          handler: () => Promise.resolve(new Response()),
          resolveSession: () =>
            Promise.resolve(
              context.req.header("X-Session-Age") === "fresh"
                ? { ...identity, authenticatedAt: "2026-09-25T11:55:00.000Z" }
                : { ...identity, authenticatedAt: "2026-09-25T10:00:00.000Z" },
            ),
        }),
        maxAgeSeconds: 15 * 60,
        now: () => now,
      }),
    );
    app.get("/sensitive", (context) => context.json({ ok: true }));

    assert.equal((await app.request("https://example.com/sensitive")).status, 403);
    assert.equal(
      (await app.request("https://example.com/sensitive", { headers: { "X-Session-Age": "fresh" } })).status,
      200,
    );
    assert.equal(isRecentHonoAuthentication({ authenticatedAt: "2026-09-25T11:45:00.000Z" }, 15 * 60, now), true);
    assert.equal(isRecentHonoAuthentication({ authenticatedAt: "2026-09-25T11:44:59.999Z" }, 15 * 60, now), false);
  });

  void it("requires explicit machine scopes without accepting a browser session", async () => {
    const now = Date.parse("2026-09-25T00:00:00Z");
    const created = await createMachineCredential({
      credentialId: "reporter",
      entropySource: (length) => new Uint8Array(length).fill(3),
      expiresAt: "2027-01-01T00:00:00Z",
      name: "Reporter",
      now,
      scopes: ["reports:read"],
      subject: "machine:reporter",
    });
    const principals: string[] = [];
    const app = new Hono();
    app.use(
      "/machine",
      createRequireHonoMachineAuth({
        now: () => now,
        onAuthenticated: (_context, principal) => {
          principals.push(principal.subject);
        },
        requiredScopes: ["reports:read"],
        resolveCredential: (_context, credentialId) =>
          Promise.resolve(credentialId === created.record.credentialId ? created.record : null),
      }),
    );
    app.get("/machine", (context) => context.json({ ok: true }));

    const browserOnly = await app.request("https://example.com/machine", {
      headers: { Cookie: "session=valid" },
    });
    assert.equal(browserOnly.status, 401);
    assert.equal(browserOnly.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await browserOnly.json(), { error: "machine_authentication_required" });

    const authorized = await app.request("https://example.com/machine", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(principals, ["machine:reporter"]);
  });

  void it("keeps machine failure status and security headers package-owned", async () => {
    const now = Date.parse("2026-09-25T00:00:00Z");
    const created = await createMachineCredential({
      credentialId: "reporter",
      expiresAt: "2027-01-01T00:00:00Z",
      name: "Reporter",
      now,
      scopes: ["reports:read"],
      subject: "machine:reporter",
    });
    const app = new Hono();
    app.use(
      "/admin",
      createRequireHonoMachineAuth({
        insufficientScopeBody: (reason, principal) => ({ error: "scope_missing", reason, subject: principal.subject }),
        now: () => now,
        requiredScopes: ["reports:write"],
        resolveCredential: () => created.record,
        unauthorizedBody: (reason) => ({ error: "credential_missing", reason }),
      }),
    );
    app.get("/admin", (context) => context.json({ ok: true }));

    const unauthorized = await app.request("https://example.com/admin");
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await unauthorized.json(), {
      error: "credential_missing",
      reason: "machine_authentication_required",
    });

    const forbidden = await app.request("https://example.com/admin", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.get("Cache-Control"), "no-store");
    const forbiddenBody: unknown = await forbidden.json();
    assert.deepEqual(forbiddenBody, {
      error: "scope_missing",
      reason: "machine_scope_required",
      subject: "machine:reporter",
    });
    assert.equal(JSON.stringify(forbiddenBody).includes(created.token), false);
  });

  void it("falls back to a safe body when custom machine error serialization fails", async () => {
    const unsafeBody = Object.defineProperty({ error: "custom" }, "unsafe", {
      enumerable: true,
      get() {
        throw new Error("serialization failed");
      },
    });
    const app = new Hono();
    app.use(
      "/machine",
      createRequireHonoMachineAuth({
        requiredScopes: ["reports:read"],
        resolveCredential: () => null,
        unauthorizedBody: () => unsafeBody,
      }),
    );
    app.get("/machine", (context) => context.json({ ok: true }));
    const response = await app.request("https://example.com/machine");
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: "machine_authentication_required" });
  });

  void it("falls back to a protected response when a machine body mapper throws", async () => {
    const app = new Hono();
    app.use(
      "/machine",
      createRequireHonoMachineAuth({
        requiredScopes: ["reports:read"],
        resolveCredential: () => null,
        unauthorizedBody: () => {
          throw new Error("consumer mapper failed");
        },
      }),
    );
    app.get("/machine", (context) => context.json({ ok: true }));
    const response = await app.request("https://example.com/machine");
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: "machine_authentication_required" });
  });

  void it("rejects missing, duplicate, or malformed machine scope configuration", () => {
    for (const requiredScopes of [
      [],
      ["reports"],
      ["reports:read", "reports:read"],
      [`reports:${"a".repeat(120)}`],
      Array.from({ length: 51 }, (_value, index) => `reports:read_${index}`),
    ]) {
      assert.throws(
        () => createRequireHonoMachineAuth({ requiredScopes, resolveCredential: () => null }),
        /auth_hono_machine_scopes_invalid/u,
      );
    }
  });

  void it("allows credentials for exact configured origins and varies caches", async () => {
    const app = new Hono();
    app.use("/api/auth/*", createHonoAuthCors({ allowedOrigins: ["https://app.example.com"] }));
    app.get("/api/auth/session", (context) => context.json({ ok: true }));

    const response = await app.request("https://api.example.com/api/auth/session", {
      headers: { Origin: "https://app.example.com" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.match(response.headers.get("Vary") ?? "", /Origin/u);
  });

  void it("adds Origin to Vary without discarding headers the downstream handler already set", async () => {
    const app = new Hono();
    app.use("/api/auth/*", createHonoAuthCors({ allowedOrigins: ["https://app.example.com"] }));
    app.get("/api/auth/session", (context) => {
      context.header("Vary", "Accept-Encoding");
      context.header("X-Downstream", "kept");
      return context.json({ ok: true });
    });

    const response = await app.request("https://api.example.com/api/auth/session", {
      headers: { Origin: "https://app.example.com" },
    });
    assert.equal(response.status, 200);
    const vary = response.headers.get("Vary") ?? "";
    assert.match(vary, /Accept-Encoding/u);
    assert.match(vary, /Origin/u);
    assert.equal(response.headers.get("X-Downstream"), "kept");
  });

  void it("handles valid preflight requests and rejects origin, method, or header widening", async () => {
    const app = new Hono();
    app.use(
      "/api/auth/*",
      createHonoAuthCors({
        allowHeaders: ["Content-Type", "X-CSRF-Token"],
        allowedOrigins: ["https://app.example.com"],
        maxAgeSeconds: 600,
      }),
    );
    app.all("/api/auth/*", (context) => context.text("unexpected"));

    const valid = await app.request("https://api.example.com/api/auth/sign-in", {
      headers: {
        "Access-Control-Request-Headers": "content-type, x-csrf-token",
        "Access-Control-Request-Method": "POST",
        Origin: "https://app.example.com",
      },
      method: "OPTIONS",
    });
    assert.equal(valid.status, 204);
    assert.equal(valid.headers.get("Access-Control-Max-Age"), "600");

    for (const headers of [
      { "Access-Control-Request-Method": "POST", Origin: "https://evil.example.com" },
      { "Access-Control-Request-Method": "TRACE", Origin: "https://app.example.com" },
      {
        "Access-Control-Request-Headers": "Authorization",
        "Access-Control-Request-Method": "POST",
        Origin: "https://app.example.com",
      },
    ]) {
      assert.equal(
        (await app.request("https://api.example.com/api/auth/sign-in", { headers, method: "OPTIONS" })).status,
        403,
      );
    }
  });

  void it("rejects wildcard, insecure remote, and non-origin configuration", () => {
    for (const origin of ["*", "http://example.com", "https://example.com/path"]) {
      assert.throws(() => createHonoAuthCors({ allowedOrigins: [origin] }), /auth_hono_cors_origin_invalid/u);
    }
  });
});
