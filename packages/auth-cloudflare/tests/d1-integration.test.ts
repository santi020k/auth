import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { Miniflare } from "miniflare";

import { createOwnerAuth, type OwnerAuthInstance } from "../src/index.js";

const origin = "http://127.0.0.1:8787";
const ownerEmail = "owner@example.com";
const schema = `
CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL UNIQUE,
  "expiresAt" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");
CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "accessTokenExpiresAt" INTEGER,
  "refreshTokenExpiresAt" INTEGER,
  "scope" TEXT,
  "idToken" TEXT,
  "password" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
CREATE TABLE "passkey" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL UNIQUE,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" INTEGER NOT NULL,
  "transports" TEXT,
  "createdAt" INTEGER,
  "aaguid" TEXT
);
CREATE INDEX "passkey_userId_idx" ON "passkey" ("userId");
CREATE TABLE "rateLimit" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);
`;

interface DeliveredCode {
  email: string;
  otp: string;
}

let auth: OwnerAuthInstance;
let app: Hono;
let database: D1Database;
let deliveredCode: DeliveredCode | null = null;
let miniflare: Miniflare | undefined;

function authRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`${origin}/api/auth${path}`, {
    body: JSON.stringify(body),
    headers: { "CF-Connecting-IP": "127.0.0.1", "Content-Type": "application/json", Origin: origin },
    method: "POST",
  });
}

before(async () => {
  miniflare = new Miniflare({
    workers: [
      {
        config: {
          compatibilityDate: "2026-09-24",
          env: { AUTH_DB: { name: "auth-integration-test", type: "d1" } },
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                contents: "export default { fetch() { return new Response('unused'); } };",
                type: "esm",
              },
            },
            modulesRoot: fileURLToPath(new URL(".", import.meta.url)),
          },
          name: "auth-integration-test",
        },
      },
    ],
  });
  database = await miniflare.getD1Database("AUTH_DB");
  const statements = schema
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await database.batch(statements.map((statement) => database.prepare(statement)));
  auth = createOwnerAuth({
    appName: "Owner auth integration test",
    baseURL: origin,
    cookiePrefix: "integration-owner",
    database,
    ownerEmail,
    secret: "integration-test-secret-that-is-at-least-32-characters",
    sendVerificationOTP: (email) => {
      deliveredCode = email;
      return Promise.resolve();
    },
  });
  app = new Hono();
  app.all("/api/auth/*", (context) => auth.handler(context.req.raw));
});

after(async () => {
  await miniflare?.dispose();
});

void describe("Cloudflare D1 integration", () => {
  void it("signs in the owner through a hashed email OTP and resolves the session", async () => {
    const sendResponse = await app.request(
      authRequest("/email-otp/send-verification-otp", {
        email: ownerEmail,
        type: "sign-in",
      }),
    );
    assert.equal(sendResponse.status, 200);
    assert.ok(deliveredCode);
    const code = deliveredCode.otp;
    assert.match(code, /^\d{6}$/u);

    const verification = await database
      .prepare("SELECT value FROM verification WHERE identifier = ? ORDER BY createdAt DESC LIMIT 1")
      .bind(`sign-in-otp-${ownerEmail}`)
      .first<{ value: string }>();
    assert.ok(verification);
    assert.notEqual(verification.value, code);

    const signInResponse = await app.request(authRequest("/sign-in/email-otp", { email: ownerEmail, otp: code }));
    assert.equal(signInResponse.status, 200, await signInResponse.clone().text());
    const setCookie = signInResponse.headers.get("Set-Cookie");
    assert.ok(setCookie);
    const cookie = setCookie.split(";", 1)[0];
    assert.ok(cookie);

    const session = await auth.resolveSession(new Headers({ Cookie: cookie }));
    assert.ok(session);
    assert.equal(session.email, ownerEmail);
    assert.match(session.userId, /^[A-Za-z0-9_-]{20,}$/u);

    const user = await database
      .prepare("SELECT email, emailVerified FROM user WHERE id = ?")
      .bind(session.userId)
      .first<{ email: string; emailVerified: number }>();
    assert.deepEqual(user, { email: ownerEmail, emailVerified: 1 });
    const rateLimit = await database.prepare("SELECT COUNT(*) AS total FROM rateLimit").first<{ total: number }>();
    assert.ok(rateLimit && rateLimit.total > 0);
  });

  void it("does not persist or deliver an OTP for another email", async () => {
    deliveredCode = null;
    const response = await app.request(
      authRequest("/email-otp/send-verification-otp", {
        email: "not-the-owner@example.com",
        type: "sign-in",
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(deliveredCode, null);
    const row = await database
      .prepare("SELECT id FROM verification WHERE identifier = ?")
      .bind("sign-in-otp-not-the-owner@example.com")
      .first();
    assert.equal(row, null);
  });
});
