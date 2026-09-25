import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Hono } from "hono";

import {
  createHonoAuthCors,
  createHonoAuthHandler,
  createRequireHonoAuth,
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
