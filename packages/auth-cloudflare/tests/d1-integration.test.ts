import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { Miniflare } from "miniflare";

import { createMultiUserAuth, createOwnerAuth, type OwnerAuthInstance } from "../src/index.js";

const origin = "http://127.0.0.1:8787";
const ownerEmail = "owner@example.com";

interface DeliveredCode {
  email: string;
  otp: string;
}

let auth: OwnerAuthInstance;
let app: Hono;
let database: D1Database;
let deliveredCode: DeliveredCode | null = null;
let miniflare: Miniflare | undefined;
let pendingTasks: Promise<void>[] = [];

async function drainPendingTasks(): Promise<void> {
  const tasks = pendingTasks;
  pendingTasks = [];
  await Promise.all(tasks);
}

function authRequest(path: string, body: Record<string, unknown>, ipAddress = "127.0.0.1"): Request {
  return new Request(`${origin}/api/auth${path}`, {
    body: JSON.stringify(body),
    headers: { "CF-Connecting-IP": ipAddress, "Content-Type": "application/json", Origin: origin },
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
  const schema = await readFile(fileURLToPath(new URL("../../schema/d1.sql", import.meta.url)), "utf8");
  const statements = schema
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await database.batch(statements.map((statement) => database.prepare(statement)));
  auth = createOwnerAuth({
    appName: "Owner auth integration test",
    applicationOrigin: origin,
    authServerURL: origin,
    cookiePrefix: "integration-owner",
    database,
    ownerEmail,
    secret: "integration-test-secret-that-is-at-least-32-characters",
    sendVerificationOTP: (email) => {
      deliveredCode = email;
      return Promise.resolve();
    },
    waitUntil: (task) => {
      pendingTasks.push(task);
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
    await drainPendingTasks();
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

  void it("does not deliver an OTP or create a user for another email", async () => {
    deliveredCode = null;
    const response = await app.request(
      authRequest("/email-otp/send-verification-otp", {
        email: "not-the-owner@example.com",
        type: "sign-in",
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(pendingTasks.length, 1);
    await drainPendingTasks();
    assert.equal(deliveredCode, null);
    const verification = await database
      .prepare("SELECT value FROM verification WHERE identifier = ?")
      .bind("sign-in-otp-not-the-owner@example.com")
      .first<{ value: string }>();
    assert.ok(verification);
    assert.notEqual(verification.value, "123456");
    const user = await database
      .prepare("SELECT id FROM user WHERE email = ?")
      .bind("not-the-owner@example.com")
      .first();
    assert.equal(user, null);
  });

  void it("keeps invalid and rate-limited OTP send responses indistinguishable", async () => {
    const inputs: Record<string, unknown>[] = [
      { email: ownerEmail, type: "invalid" },
      { email: "not-the-owner@example.com", type: "invalid" },
      ...Array.from({ length: 5 }, () => ({ email: ownerEmail, type: "sign-in" })),
      ...Array.from({ length: 5 }, () => ({ email: "not-the-owner@example.com", type: "sign-in" })),
    ];

    for (const input of inputs) {
      const response = await app.request(authRequest("/email-otp/send-verification-otp", input));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true });
      await drainPendingTasks();
    }
  });

  void it("keeps a synchronously throwing delivery adapter outside the response path", async () => {
    const backgroundError: { current: Error | null } = { current: null };
    const throwingOwnerEmail = "throwing-owner@example.com";
    const throwingAuth = createOwnerAuth({
      appName: "Throwing delivery integration test",
      applicationOrigin: origin,
      authServerURL: origin,
      cookiePrefix: "throwing-owner",
      database,
      ownerEmail: throwingOwnerEmail,
      secret: "throwing-test-secret-that-is-at-least-32-characters",
      sendVerificationOTP: () => {
        throw new Error("delivery_failed");
      },
      waitUntil: (task) => {
        pendingTasks.push(
          task.catch((error: unknown) => {
            backgroundError.current = error instanceof Error ? error : new Error("unknown_delivery_error");
          }),
        );
      },
    });

    const response = await throwingAuth.handler(
      authRequest("/email-otp/send-verification-otp", { email: throwingOwnerEmail, type: "sign-in" }, "127.0.0.2"),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    await drainPendingTasks();
    assert.equal(backgroundError.current?.message, "delivery_failed");
  });

  void it("signs in multiple approved identities and applies revocation to existing sessions", async () => {
    const approvedEmails = new Set(["first@example.com", "second@example.com"]);
    const deliveredCodes = new Map<string, string>();
    const multiUserAuth = createMultiUserAuth({
      appName: "Multi-user auth integration test",
      applicationOrigin: origin,
      authServerURL: origin,
      authorizeEmail: (email) => approvedEmails.has(email),
      cookiePrefix: "integration-members",
      database,
      secret: "multi-user-test-secret-that-is-at-least-32-characters",
      sendVerificationOTP: ({ email, otp }) => {
        deliveredCodes.set(email, otp);
        return Promise.resolve();
      },
      waitUntil: (task) => {
        pendingTasks.push(task);
      },
    });
    const multiUserApp = new Hono();
    multiUserApp.all("/api/auth/*", (context) => multiUserAuth.handler(context.req.raw));

    const rejectedEmail = "rejected@example.com";
    for (const [email, ipAddress] of [
      ["first@example.com", "127.0.0.20"],
      [rejectedEmail, "127.0.0.21"],
    ] as const) {
      const response = await multiUserApp.request(
        authRequest("/email-otp/send-verification-otp", { email, type: "sign-in" }, ipAddress),
      );
      assert.equal(response.status, 200);
    }
    await drainPendingTasks();
    const approvedInvalidOtp = await multiUserApp.request(
      authRequest("/sign-in/email-otp", { email: "first@example.com", otp: "000000" }, "127.0.0.20"),
    );
    const rejectedInvalidOtp = await multiUserApp.request(
      authRequest("/sign-in/email-otp", { email: rejectedEmail, otp: "000000" }, "127.0.0.21"),
    );
    assert.equal(rejectedInvalidOtp.status, approvedInvalidOtp.status);
    assert.deepEqual(await rejectedInvalidOtp.json(), await approvedInvalidOtp.json());

    async function signIn(email: string, ipAddress: string): Promise<string> {
      const sendResponse = await multiUserApp.request(
        authRequest("/email-otp/send-verification-otp", { email, type: "sign-in" }, ipAddress),
      );
      assert.equal(sendResponse.status, 200);
      assert.deepEqual(await sendResponse.json(), { success: true });
      await drainPendingTasks();
      const otp = deliveredCodes.get(email);
      assert.ok(otp);

      const signInResponse = await multiUserApp.request(authRequest("/sign-in/email-otp", { email, otp }, ipAddress));
      assert.equal(signInResponse.status, 200, await signInResponse.clone().text());
      const setCookie = signInResponse.headers.get("Set-Cookie");
      assert.ok(setCookie);
      const cookie = setCookie.split(";", 1)[0];
      assert.ok(cookie);
      return cookie;
    }

    const firstCookie = await signIn("first@example.com", "127.0.0.10");
    const secondCookie = await signIn("second@example.com", "127.0.0.11");
    assert.equal(
      (await multiUserAuth.resolveSession(new Headers({ Cookie: firstCookie })))?.email,
      "first@example.com",
    );
    assert.equal(
      (await multiUserAuth.resolveSession(new Headers({ Cookie: secondCookie })))?.email,
      "second@example.com",
    );

    const users = await database
      .prepare("SELECT COUNT(*) AS total FROM user WHERE email IN (?, ?)")
      .bind("first@example.com", "second@example.com")
      .first<{ total: number }>();
    assert.deepEqual(users, { total: 2 });

    const pendingCodeResponse = await multiUserApp.request(
      authRequest("/email-otp/send-verification-otp", { email: "first@example.com", type: "sign-in" }, "127.0.0.13"),
    );
    assert.equal(pendingCodeResponse.status, 200);
    await drainPendingTasks();
    const pendingCode = deliveredCodes.get("first@example.com");
    assert.ok(pendingCode);

    approvedEmails.delete("first@example.com");
    const firstUser = await database
      .prepare("SELECT id FROM user WHERE email = ?")
      .bind("first@example.com")
      .first<{ id: string }>();
    assert.ok(firstUser);
    const refreshEligibleExpiry = Date.now() + 60 * 60 * 1000;
    await database
      .prepare("UPDATE session SET expiresAt = ?, updatedAt = 0 WHERE userId = ?")
      .bind(refreshEligibleExpiry, firstUser.id)
      .run();
    const revokedSessionBeforeChecks = await database
      .prepare("SELECT id, expiresAt, updatedAt FROM session WHERE userId = ? ORDER BY createdAt DESC LIMIT 1")
      .bind(firstUser.id)
      .first<{ expiresAt: number; id: string; updatedAt: number }>();
    assert.ok(revokedSessionBeforeChecks);

    assert.equal(await multiUserAuth.resolveSession(new Headers({ Cookie: firstCookie })), null);
    assert.equal(
      (await multiUserAuth.resolveSession(new Headers({ Cookie: secondCookie })))?.email,
      "second@example.com",
    );

    const passkeyManagementResponse = await multiUserApp.request(
      new Request(`${origin}/api/auth/passkey/generate-register-options`, {
        headers: { Cookie: firstCookie, Origin: origin },
      }),
    );
    assert.equal(passkeyManagementResponse.status, 401);
    assert.deepEqual(await passkeyManagementResponse.json(), {
      code: "invalid_credentials",
      message: "invalid_credentials",
    });
    const revokedSessionAfterChecks = await database
      .prepare("SELECT id, expiresAt, updatedAt FROM session WHERE userId = ? ORDER BY createdAt DESC LIMIT 1")
      .bind(firstUser.id)
      .first<{ expiresAt: number; id: string; updatedAt: number }>();
    assert.deepEqual(revokedSessionAfterChecks, revokedSessionBeforeChecks);

    const sessionsBeforeRevokedSignIn = await database
      .prepare("SELECT COUNT(*) AS total FROM session WHERE userId = (SELECT id FROM user WHERE email = ?)")
      .bind("first@example.com")
      .first<{ total: number }>();
    const revokedSignInResponse = await multiUserApp.request(
      authRequest("/sign-in/email-otp", { email: "first@example.com", otp: pendingCode }, "127.0.0.13"),
    );
    assert.notEqual(revokedSignInResponse.status, 200);
    assert.equal(revokedSignInResponse.headers.get("Set-Cookie"), null);
    const sessionsAfterRevokedSignIn = await database
      .prepare("SELECT COUNT(*) AS total FROM session WHERE userId = (SELECT id FROM user WHERE email = ?)")
      .bind("first@example.com")
      .first<{ total: number }>();
    assert.deepEqual(sessionsAfterRevokedSignIn, sessionsBeforeRevokedSignIn);

    const rejectedResponse = await multiUserApp.request(
      authRequest("/email-otp/send-verification-otp", { email: rejectedEmail, type: "sign-in" }, "127.0.0.12"),
    );
    assert.equal(rejectedResponse.status, 200);
    assert.deepEqual(await rejectedResponse.json(), { success: true });
    await drainPendingTasks();
    assert.equal(deliveredCodes.has(rejectedEmail), false);
    const rejectedUser = await database.prepare("SELECT id FROM user WHERE email = ?").bind(rejectedEmail).first();
    assert.equal(rejectedUser, null);
  });
});
