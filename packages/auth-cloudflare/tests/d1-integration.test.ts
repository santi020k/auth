import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { type AuthD1TestHarness, createAuthD1TestHarness, readResponseCookie } from "@santi020k/auth-testing";
import { Hono } from "hono";

import { type AuthSecurityEvent, createMultiUserAuth, createOwnerAuth, type OwnerAuthInstance } from "../src/index.js";

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
let harness: AuthD1TestHarness | undefined;
let requestIpSuffix = 1;
const backgroundTasks: Promise<void>[] = [];

function waitUntilForTest(task: Promise<void>): void {
  backgroundTasks.push(task);
}

function authRequest(path: string, body: Record<string, unknown>): Request {
  requestIpSuffix += 1;
  return new Request(`${origin}/api/auth${path}`, {
    body: JSON.stringify(body),
    headers: {
      "CF-Connecting-IP": `127.0.0.${requestIpSuffix}`,
      "Content-Type": "application/json",
      Origin: origin,
    },
    method: "POST",
  });
}

async function drainBackgroundTasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10);
  });
}

async function waitForBackgroundEffect(effectOccurred: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (effectOccurred()) return;
    await drainBackgroundTasks();
  }
  assert.fail("Timed out waiting for the background authentication effect");
}

before(async () => {
  harness = await createAuthD1TestHarness({ databaseName: "auth-integration-test" });
  database = harness.database;
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
    waitUntil: waitUntilForTest,
  });
  app = new Hono();
  app.all("/api/auth/*", (context) => auth.handler(context.req.raw));
});

after(async () => {
  await Promise.all(backgroundTasks);
  await harness?.dispose();
});

void describe("Cloudflare D1 integration", () => {
  void it("uses the same table prefix contract as the migration package", async () => {
    const prefixedHarness = await createAuthD1TestHarness({ tablePrefix: "isolated" });
    try {
      let otp = "";
      const prefixedAuth = createOwnerAuth({
        appName: "Prefixed auth integration test",
        baseURL: origin,
        cookiePrefix: "integration-prefixed",
        database: prefixedHarness.database,
        ownerEmail,
        secret: "integration-test-secret-that-is-at-least-32-characters",
        sendVerificationOTP: (email) => {
          otp = email.otp;
          return Promise.resolve();
        },
        tablePrefix: "isolated",
        waitUntil: waitUntilForTest,
      });
      const send = await prefixedAuth.handler(
        authRequest("/email-otp/send-verification-otp", { email: ownerEmail, type: "sign-in" }),
      );
      assert.equal(send.status, 200);
      await waitForBackgroundEffect(() => otp !== "");
      assert.match(otp, /^\d{6}$/u);
      const signIn = await prefixedAuth.handler(authRequest("/sign-in/email-otp", { email: ownerEmail, otp }));
      assert.equal(signIn.status, 200, await signIn.clone().text());
      const stored = await prefixedHarness.database
        .prepare("SELECT email FROM isolated_user")
        .first<{ email: string }>();
      assert.deepEqual(stored, { email: ownerEmail });
    } finally {
      await prefixedHarness.dispose();
    }
  });

  void it("signs in the owner through a hashed email OTP and resolves the session", async () => {
    const sendResponse = await app.request(
      authRequest("/email-otp/send-verification-otp", {
        email: ownerEmail,
        type: "sign-in",
      }),
    );
    assert.equal(sendResponse.status, 200);
    await waitForBackgroundEffect(() => deliveredCode !== null);
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
    const cookie = readResponseCookie(signInResponse);

    const session = await auth.resolveSession(new Headers({ Cookie: cookie }));
    assert.ok(session);
    assert.equal(session.email, ownerEmail);
    assert.match(session.userId, /^[A-Za-z0-9_-]{20,}$/u);
    assert.equal(Number.isNaN(Date.parse(session.authenticatedAt)), false);
    assert.equal(Number.isNaN(Date.parse(session.expiresAt)), false);
    assert.ok(Date.parse(session.expiresAt) > Date.parse(session.authenticatedAt));

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

  void it("keeps authorized and rejected email requests indistinguishable when delivery fails", async () => {
    const events: AuthSecurityEvent[] = [];
    const tasks: Promise<void>[] = [];
    const failingAuth = createOwnerAuth({
      appName: "Failing delivery integration test",
      baseURL: origin,
      cookiePrefix: "integration-failing-delivery",
      database,
      onSecurityEvent: (event) => {
        events.push(event);
      },
      ownerEmail: "delivery-owner@example.com",
      secret: "integration-test-secret-that-is-at-least-32-characters",
      sendVerificationOTP: () => Promise.reject(new Error("provider unavailable")),
      waitUntil: (task) => {
        tasks.push(task);
      },
    });

    const approved = await failingAuth.handler(
      authRequest("/email-otp/send-verification-otp", {
        email: "delivery-owner@example.com",
        type: "sign-in",
      }),
    );
    const rejected = await failingAuth.handler(
      authRequest("/email-otp/send-verification-otp", {
        email: "rejected-delivery@example.com",
        type: "sign-in",
      }),
    );

    assert.equal(approved.status, 200);
    assert.equal(rejected.status, 200);
    assert.deepEqual(await approved.json(), { success: true });
    assert.deepEqual(await rejected.json(), { success: true });
    await Promise.all(tasks);
    assert.ok(events.some((event) => event.type === "email_otp_delivery_failed"));
    assert.ok(events.some((event) => event.type === "email_otp_delivery_suppressed"));
  });

  void it("keeps approved and rejected code requests indistinguishable when rate limited", async () => {
    const limitedAuth = createOwnerAuth({
      appName: "Rate-limit enumeration integration test",
      baseURL: origin,
      cookiePrefix: "integration-rate-enumeration",
      database,
      emailOtpRateLimit: { max: 1, window: 600 },
      ownerEmail: "rate-owner@example.com",
      secret: "integration-test-secret-that-is-at-least-32-characters",
      sendVerificationOTP: () => Promise.resolve(),
      waitUntil: waitUntilForTest,
    });
    const requestCode = (email: string): Request =>
      new Request(`${origin}/api/auth/email-otp/send-verification-otp`, {
        body: JSON.stringify({ email, type: "sign-in" }),
        headers: {
          "CF-Connecting-IP": "127.0.0.200",
          "Content-Type": "application/json",
          Origin: origin,
        },
        method: "POST",
      });

    const responses = await Promise.all([
      limitedAuth.handler(requestCode("rate-owner@example.com")),
      limitedAuth.handler(requestCode("rate-owner@example.com")),
      limitedAuth.handler(requestCode("rejected-rate@example.com")),
      limitedAuth.handler(requestCode("rejected-rate@example.com")),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true });
    }
  });

  void it("returns exact credentialed CORS headers on split-origin responses", async () => {
    const splitAuth = createOwnerAuth({
      appName: "Split-origin integration test",
      baseURL: origin,
      browserOrigin: "http://localhost:4321",
      cookiePrefix: "integration-split-origin",
      database,
      ownerEmail,
      secret: "integration-test-secret-that-is-at-least-32-characters",
      sendVerificationOTP: () => Promise.resolve(),
      waitUntil: waitUntilForTest,
    });
    const request = new Request(`${origin}/api/auth/get-session`, {
      headers: { Origin: "http://localhost:4321" },
    });
    const response = await splitAuth.handler(request);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:4321");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.equal(response.headers.get("Vary"), "Origin");
  });

  void it("fails closed when Turnstile is enabled and the browser omits its token", async () => {
    let delivered = false;
    const protectedAuth = createOwnerAuth({
      appName: "Turnstile auth integration test",
      baseURL: origin,
      cookiePrefix: "integration-turnstile",
      database,
      ownerEmail,
      secret: "integration-test-secret-that-is-at-least-32-characters",
      sendVerificationOTP: () => {
        delivered = true;
        return Promise.resolve();
      },
      turnstile: { secretKey: "turnstile-test-secret-at-least-20-characters" },
      waitUntil: waitUntilForTest,
    });
    const request = authRequest("/email-otp/send-verification-otp", { email: ownerEmail, type: "sign-in" });
    request.headers.set("CF-Connecting-IP", "127.0.0.99");
    const response = await protectedAuth.handler(request);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(delivered, false);
  });

  void it("signs in multiple application-approved identities and applies revocation to existing sessions", async () => {
    const approvedEmails = new Set(["first@example.com", "second@example.com"]);
    const deliveredCodes = new Map<string, string>();
    const multiUserAuth = createMultiUserAuth({
      appName: "Multi-user auth integration test",
      authorizeEmail: (email) => approvedEmails.has(email),
      baseURL: origin,
      cookiePrefix: "integration-members",
      database,
      secret: "integration-test-secret-that-is-at-least-32-characters",
      sendVerificationOTP: ({ email, otp }) => {
        deliveredCodes.set(email, otp);
        return Promise.resolve();
      },
      waitUntil: waitUntilForTest,
    });
    const multiUserApp = new Hono();
    multiUserApp.all("/api/auth/*", (context) => multiUserAuth.handler(context.req.raw));

    async function signIn(email: string): Promise<string> {
      const sendResponse = await multiUserApp.request(
        authRequest("/email-otp/send-verification-otp", { email, type: "sign-in" }),
      );
      assert.equal(sendResponse.status, 200);
      await waitForBackgroundEffect(() => deliveredCodes.has(email));
      const otp = deliveredCodes.get(email);
      assert.ok(otp);
      const signInResponse = await multiUserApp.request(authRequest("/sign-in/email-otp", { email, otp }));
      assert.equal(signInResponse.status, 200, await signInResponse.clone().text());
      return readResponseCookie(signInResponse);
    }

    const firstCookie = await signIn("first@example.com");
    const secondCookie = await signIn("second@example.com");
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

    approvedEmails.delete("first@example.com");
    assert.equal(await multiUserAuth.resolveSession(new Headers({ Cookie: firstCookie })), null);
    const rawSessionResponse = await multiUserAuth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { Cookie: firstCookie, Origin: origin },
      }),
    );
    assert.equal(rawSessionResponse.status, 401);
    assert.deepEqual(await rawSessionResponse.json(), {
      code: "invalid_credentials",
      message: "invalid_credentials",
    });
    assert.equal(
      (await multiUserAuth.resolveSession(new Headers({ Cookie: secondCookie })))?.email,
      "second@example.com",
    );
  });

  void it("does not deliver or persist a code for an identity rejected by the consumer", async () => {
    let deliveryCount = 0;
    const multiUserAuth = createMultiUserAuth({
      appName: "Multi-user auth integration test",
      authorizeEmail: (email) => email === "approved@example.com",
      baseURL: origin,
      cookiePrefix: "integration-allowlist",
      database,
      secret: "integration-test-secret-that-is-at-least-32-characters",
      sendVerificationOTP: () => {
        deliveryCount += 1;
        return Promise.resolve();
      },
      waitUntil: waitUntilForTest,
    });
    const multiUserApp = new Hono();
    multiUserApp.all("/api/auth/*", (context) => multiUserAuth.handler(context.req.raw));

    const response = await multiUserApp.request(
      authRequest("/email-otp/send-verification-otp", {
        email: "rejected@example.com",
        type: "sign-in",
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(deliveryCount, 0);
    const row = await database
      .prepare("SELECT id FROM verification WHERE identifier = ?")
      .bind("sign-in-otp-rejected@example.com")
      .first();
    assert.equal(row, null);
  });

  void it("bounds unauthorized-email requests even though Better Auth's own rate limiter never sees them", async () => {
    // Better Auth's rate limiter lives inside auth.handler, which this package deliberately
    // never calls for a request rejected over an unauthorized email (so no OTP row is ever
    // created for an address that will never receive one). Without an independent limit for
    // that rejection path, authorizeEmail — a D1 lookup for multi-user consumers — could be
    // invoked without bound.
    const isolatedHarness = await createAuthD1TestHarness({ tablePrefix: "denial" });
    const events: AuthSecurityEvent[] = [];
    try {
      const floodAuth = createOwnerAuth({
        appName: "Flood guard integration test",
        baseURL: origin,
        cookiePrefix: "integration-denial",
        database: isolatedHarness.database,
        onSecurityEvent: (event) => {
          events.push(event);
        },
        ownerEmail,
        secret: "integration-test-secret-that-is-at-least-32-characters",
        sendVerificationOTP: () => Promise.resolve(),
        tablePrefix: "denial",
        waitUntil: waitUntilForTest,
      });

      const attackerRequest = () =>
        new Request(`${origin}/api/auth/email-otp/send-verification-otp`, {
          body: JSON.stringify({ email: "not-the-owner@example.com", type: "sign-in" }),
          headers: { "CF-Connecting-IP": "203.0.113.9", "Content-Type": "application/json", Origin: origin },
          method: "POST",
        });

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 30; attempt += 1) {
        // Sequential on purpose: each request must observe the previous one's counter update.
        statuses.push((await floodAuth.handler(attackerRequest())).status);
      }
      assert.ok(statuses.includes(429), `expected a 429 among ${JSON.stringify(statuses)}`);
      assert.ok(statuses.includes(200), "expected the earliest requests to still succeed");
      assert.ok(events.some((event) => event.type === "request_rate_limited"));

      const otherIpRequest = new Request(`${origin}/api/auth/email-otp/send-verification-otp`, {
        body: JSON.stringify({ email: "not-the-owner@example.com", type: "sign-in" }),
        headers: { "CF-Connecting-IP": "198.51.100.4", "Content-Type": "application/json", Origin: origin },
        method: "POST",
      });
      assert.equal((await floodAuth.handler(otherIpRequest)).status, 200);
    } finally {
      await isolatedHarness.dispose();
    }
  });

  void it("prunes expired rate-limit rows through explicit consumer-owned maintenance", async () => {
    const isolatedHarness = await createAuthD1TestHarness({ tablePrefix: "retention" });
    try {
      const retentionAuth = createOwnerAuth({
        appName: "Rate-limit retention integration test",
        baseURL: origin,
        cookiePrefix: "integration-retention",
        database: isolatedHarness.database,
        ownerEmail,
        secret: "integration-test-secret-that-is-at-least-32-characters",
        sendVerificationOTP: () => Promise.resolve(),
        tablePrefix: "retention",
        waitUntil: waitUntilForTest,
      });
      const now = Date.parse("2026-09-26T00:00:00Z");
      await isolatedHarness.database
        .prepare(
          'INSERT INTO "retention_rateLimit" ("id", "key", "count", "lastRequest") VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
        )
        .bind(
          "stale",
          "pre-auth:stale",
          1,
          now - 2 * 24 * 60 * 60 * 1000,
          "fresh",
          "pre-auth:fresh",
          1,
          now - 60 * 60 * 1000,
        )
        .run();

      assert.equal(await retentionAuth.pruneRateLimits({ now }), 1);
      const remaining = await isolatedHarness.database
        .prepare('SELECT "key" FROM "retention_rateLimit" ORDER BY "key"')
        .all<{ key: string }>();
      assert.deepEqual(remaining.results, [{ key: "pre-auth:fresh" }]);
      await assert.rejects(
        retentionAuth.pruneRateLimits({ now, retentionSeconds: 0 }),
        /auth_rate_limit_retention_invalid/u,
      );
    } finally {
      await isolatedHarness.dispose();
    }
  });

  void it("lists only active safe session summaries and supports scoped revocation and lockout", async () => {
    const isolatedHarness = await createAuthD1TestHarness({ tablePrefix: "managed" });
    const events: AuthSecurityEvent[] = [];
    let otp = "";
    try {
      const managedAuth = createOwnerAuth({
        appName: "Managed sessions integration test",
        baseURL: origin,
        cookiePrefix: "integration-managed",
        database: isolatedHarness.database,
        onSecurityEvent: (event) => {
          events.push(event);
        },
        ownerEmail,
        secret: "integration-test-secret-that-is-at-least-32-characters",
        sendVerificationOTP: (message) => {
          otp = message.otp;
          return Promise.resolve();
        },
        tablePrefix: "managed",
        waitUntil: waitUntilForTest,
      });

      const suppressed = await managedAuth.handler(
        authRequest("/email-otp/send-verification-otp", { email: "unknown@example.com", type: "sign-in" }),
      );
      assert.equal(suppressed.status, 200);
      const blockedOrigin = await managedAuth.handler(
        new Request(`${origin}/api/auth/sign-in/email-otp`, {
          body: JSON.stringify({ email: ownerEmail, otp: "123456" }),
          headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
          method: "POST",
        }),
      );
      assert.equal(blockedOrigin.status, 403);

      async function signIn(): Promise<{ cookie: string; sessionId: string; userId: string }> {
        otp = "";
        const sendResponse = await managedAuth.handler(
          authRequest("/email-otp/send-verification-otp", { email: ownerEmail, type: "sign-in" }),
        );
        assert.equal(sendResponse.status, 200);
        await waitForBackgroundEffect(() => otp !== "");
        const signInResponse = await managedAuth.handler(authRequest("/sign-in/email-otp", { email: ownerEmail, otp }));
        assert.equal(signInResponse.status, 200, await signInResponse.clone().text());
        const cookie = readResponseCookie(signInResponse);
        const identity = await managedAuth.resolveSession(new Headers({ Cookie: cookie }));
        assert.ok(identity);
        return { cookie, sessionId: identity.sessionId, userId: identity.userId };
      }

      const first = await signIn();
      await isolatedHarness.database
        .prepare(
          'INSERT INTO "managed_session" ("id", "userId", "token", "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind("expired-session", first.userId, "expired-token", Date.now() - 1, Date.now() - 2, Date.now() - 2)
        .run();

      const sessions = await managedAuth.listSessions(first.userId);
      assert.equal(sessions.length, 1);
      const listedSession = sessions[0];
      assert.ok(listedSession);
      assert.equal(listedSession.id, first.sessionId);
      assert.match(listedSession.createdAt, /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(Object.hasOwn(listedSession, "token"), false);
      assert.equal(await managedAuth.revokeSession("another-user", first.sessionId), false);
      assert.equal(await managedAuth.revokeSession(first.userId, first.sessionId), true);
      assert.equal(await managedAuth.resolveSession(new Headers({ Cookie: first.cookie })), null);

      const second = await signIn();
      assert.equal(await managedAuth.revokeAllSessions(second.userId), 2);
      assert.equal(await managedAuth.resolveSession(new Headers({ Cookie: second.cookie })), null);

      const third = await signIn();
      assert.equal(await managedAuth.emergencyLockout(third.userId), 1);
      assert.equal(await managedAuth.resolveSession(new Headers({ Cookie: third.cookie })), null);
      assert.ok(events.some((event) => event.type === "session_created"));
      assert.ok(events.some((event) => event.type === "session_revoked"));
      assert.ok(events.some((event) => event.type === "sessions_revoked_all"));
      assert.ok(events.some((event) => event.type === "emergency_lockout"));
      assert.ok(events.some((event) => event.type === "email_otp_delivery_suppressed"));
      assert.ok(events.some((event) => event.type === "request_origin_rejected"));
    } finally {
      await isolatedHarness.dispose();
    }
  });
});
