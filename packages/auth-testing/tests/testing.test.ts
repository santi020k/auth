import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAuthContractFixtures,
  createAuthD1TestHarness,
  createAuthJsonRequest,
  createAuthTestClock,
  createConsumerIsolationFixtures,
  createWebAuthnBoundaryFixtures,
  readResponseCookie,
} from "../src/index.js";

void describe("auth testing utilities", () => {
  void it("creates an isolated prefixed D1 schema", async () => {
    const harness = await createAuthD1TestHarness({ tablePrefix: "fixture" });
    try {
      const rows = await harness.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'fixture_%' ORDER BY name")
        .all<{ name: string }>();
      assert.deepEqual(
        rows.results.map((row) => row.name),
        [
          "fixture_account",
          "fixture_passkey",
          "fixture_rateLimit",
          "fixture_session",
          "fixture_user",
          "fixture_verification",
        ],
      );
    } finally {
      await harness.dispose();
    }
  });

  void it("builds JSON auth requests without leaking unrelated headers", async () => {
    const request = createAuthJsonRequest({
      body: { email: "owner@example.com" },
      origin: "https://example.com",
      path: "/email-otp/send-verification-otp",
    });
    assert.equal(request.url, "https://example.com/api/auth/email-otp/send-verification-otp");
    assert.equal(request.headers.get("Origin"), "https://example.com");
    assert.equal(request.headers.get("Authorization"), null);
    assert.deepEqual(await request.json(), { email: "owner@example.com" });
  });

  void it("extracts a request cookie from a successful response", () => {
    assert.equal(
      readResponseCookie(new Response(null, { headers: { "Set-Cookie": "session=value; HttpOnly" } })),
      "session=value",
    );
    assert.throws(() => readResponseCookie(new Response()), /auth_test_cookie_missing/u);
  });

  void it("builds independent expiry, revocation, rate-limit, and origin contract vectors", () => {
    const fixtures = createAuthContractFixtures({
      allowedOrigin: "https://app.example.com",
      rateLimitAttempts: 4,
      sessionCookie: "example_session=fixture",
    });
    assert.equal(fixtures.expiredSession.request.headers.get("Cookie"), "example_session=fixture");
    assert.equal(fixtures.expiredSession.request.url, "https://app.example.com/private");
    assert.equal(fixtures.revokedSession.kind, "revoked-session");
    assert.equal(fixtures.rateLimit.requests.length, 4);
    assert.equal(fixtures.rateLimit.expectedFinalStatus, 200);
    assert.match(fixtures.rateLimit.prerequisite, /public response stays generic HTTP 200/u);
    assert.equal(fixtures.originAllowed.request.headers.get("Origin"), "https://app.example.com");
    assert.equal(fixtures.originRejected.request.headers.get("Origin"), "https://not-allowed.invalid");
    assert.notEqual(fixtures.rateLimit.requests[0], fixtures.rateLimit.requests[1]);
    assert.throws(
      () => createAuthContractFixtures({ allowedOrigin: "https://app.example.com", rateLimitAttempts: 1 }),
      /auth_test_rate_limit_attempts_invalid/u,
    );
  });

  void it("provides deterministic isolated consumer namespaces", () => {
    const [first, second] = createConsumerIsolationFixtures("consumer-test");
    assert.deepEqual(first, { cookiePrefix: "consumer-test-a", tablePrefix: "consumer_test_a" });
    assert.deepEqual(second, { cookiePrefix: "consumer-test-b", tablePrefix: "consumer_test_b" });
    assert.notEqual(first.cookiePrefix, second.cookiePrefix);
    assert.notEqual(first.tablePrefix, second.tablePrefix);
  });

  void it("provides a deterministic clock for expiry contracts", () => {
    const clock = createAuthTestClock(new Date("2026-01-01T00:00:00.000Z"));
    clock.advance(60_000);
    assert.equal(clock.now().toISOString(), "2026-01-01T00:01:00.000Z");
    assert.throws(() => {
      clock.advance(-1);
    }, /auth_test_clock_advance_invalid/u);
  });

  void it("builds WebAuthn client-data boundary vectors without pretending to sign assertions", () => {
    const fixtures = createWebAuthnBoundaryFixtures("https://app.example.com", "challenge-123");
    assert.equal(fixtures.validAuthentication.type, "webauthn.get");
    assert.equal(fixtures.validRegistration.type, "webauthn.create");
    assert.equal(fixtures.wrongChallenge.challenge, "wrong-challenge");
    assert.equal(fixtures.wrongOrigin.origin, "https://wrong-origin.invalid");
    assert.equal(fixtures.crossOrigin.crossOrigin, true);

    const encoded = fixtures.validAuthentication.clientDataJSON.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded: unknown = JSON.parse(new TextDecoder().decode(bytes));
    assert.deepEqual(decoded, {
      challenge: "challenge-123",
      crossOrigin: false,
      origin: "https://app.example.com",
      type: "webauthn.get",
    });
    assert.throws(() => createWebAuthnBoundaryFixtures("http://app.example.com"), /auth_test_webauthn_origin_invalid/u);
  });
});
