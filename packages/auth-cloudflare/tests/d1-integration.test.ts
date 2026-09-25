import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { Miniflare } from "miniflare";

import { createOwnerAuth, type OwnerAuthInstance } from "../src/index.js";

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
});
