import type { D1Database } from "@cloudflare/workers-types";
import { type AuthMigrationOptions, createAuthD1Migration } from "@santi020k/auth-migrations";
import { Miniflare } from "miniflare";

export interface AuthD1TestHarness {
  database: D1Database;
  dispose(): Promise<void>;
}

export interface AuthD1TestHarnessOptions extends AuthMigrationOptions {
  compatibilityDate?: string;
  databaseName?: string;
  migration?: string;
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function createAuthD1TestHarness(options: AuthD1TestHarnessOptions = {}): Promise<AuthD1TestHarness> {
  const databaseName = options.databaseName ?? `auth-test-${crypto.randomUUID()}`;
  const miniflare = new Miniflare({
    workers: [
      {
        config: {
          compatibilityDate: options.compatibilityDate ?? "2026-09-24",
          env: { AUTH_DB: { name: databaseName, type: "d1" } },
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                contents: "export default { fetch() { return new Response('unused'); } };",
                type: "esm",
              },
            },
            modulesRoot: process.cwd(),
          },
          name: databaseName,
        },
      },
    ],
  });
  const database = await miniflare.getD1Database("AUTH_DB");
  const migration =
    options.migration ??
    createAuthD1Migration(options.tablePrefix === undefined ? {} : { tablePrefix: options.tablePrefix });
  await database.batch(splitSqlStatements(migration).map((statement) => database.prepare(statement)));
  return {
    database,
    dispose: () => miniflare.dispose(),
  };
}

export interface AuthJsonRequestOptions {
  basePath?: `/${string}`;
  body?: Record<string, unknown>;
  cookie?: string;
  method?: "DELETE" | "GET" | "PATCH" | "POST";
  origin: string;
  path: `/${string}`;
}

export function createAuthJsonRequest(options: AuthJsonRequestOptions): Request {
  const headers = new Headers({ Accept: "application/json", Origin: options.origin });
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body) headers.set("Content-Type", "application/json");
  return new Request(`${options.origin}${options.basePath ?? "/api/auth"}${options.path}`, {
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    headers,
    method: options.method ?? (options.body ? "POST" : "GET"),
  });
}

export function readResponseCookie(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("auth_test_cookie_missing");
  const cookie = setCookie.split(";", 1)[0];
  if (!cookie) throw new Error("auth_test_cookie_missing");
  return cookie;
}

export interface AuthContractFixtureOptions {
  allowedOrigin: string;
  basePath?: `/${string}`;
  disallowedOrigin?: string;
  protectedPath?: `/${string}`;
  rateLimitAttempts?: number;
  sessionCookie?: string;
}

export interface AuthContractRequestFixture {
  expectedStatus: number;
  kind: "expired-session" | "origin-allowed" | "origin-rejected" | "revoked-session";
  prerequisite: string;
  request: Request;
}

export interface AuthRateLimitContractFixture {
  expectedFinalStatus: number;
  kind: "rate-limit";
  prerequisite: string;
  requests: readonly Request[];
}

export interface AuthContractFixtures {
  expiredSession: AuthContractRequestFixture;
  originAllowed: AuthContractRequestFixture;
  originRejected: AuthContractRequestFixture;
  rateLimit: AuthRateLimitContractFixture;
  revokedSession: AuthContractRequestFixture;
}

function positiveAttempts(value: number | undefined): number {
  const attempts = value ?? 6;
  if (!Number.isSafeInteger(attempts) || attempts < 2) throw new Error("auth_test_rate_limit_attempts_invalid");
  return attempts;
}

/**
 * Canonical HTTP vectors for consumer contract suites. Prerequisites describe
 * the state a consumer must arrange in its own isolated harness before dispatch.
 */
export function createAuthContractFixtures(options: AuthContractFixtureOptions): AuthContractFixtures {
  const basePath = options.basePath ?? "/api/auth";
  const cookie = options.sessionCookie ?? "auth_fixture_session=fixture-token";
  const disallowedOrigin = options.disallowedOrigin ?? "https://not-allowed.invalid";
  const protectedPath = options.protectedPath ?? "/private";
  const sessionRequest = (origin: string) =>
    new Request(new URL(protectedPath, origin), { headers: { Cookie: cookie, Origin: origin } });
  const rateLimitRequest = () =>
    createAuthJsonRequest({
      basePath,
      body: { email: "fixture@example.com", type: "sign-in" },
      origin: options.allowedOrigin,
      path: "/email-otp/send-verification-otp",
    });
  return {
    expiredSession: {
      expectedStatus: 401,
      kind: "expired-session",
      prerequisite:
        "Insert an expired session, then dispatch this request to a consumer route protected by auth middleware.",
      request: sessionRequest(options.allowedOrigin),
    },
    originAllowed: {
      expectedStatus: 200,
      kind: "origin-allowed",
      prerequisite: "Configure allowedOrigin as the consumer browser origin.",
      request: createAuthJsonRequest({
        basePath,
        body: { email: "fixture@example.com", type: "sign-in" },
        origin: options.allowedOrigin,
        path: "/email-otp/send-verification-otp",
      }),
    },
    originRejected: {
      expectedStatus: 403,
      kind: "origin-rejected",
      prerequisite: "Do not add disallowedOrigin to the consumer origin allowlist.",
      request: createAuthJsonRequest({
        basePath,
        body: { email: "fixture@example.com", type: "sign-in" },
        origin: disallowedOrigin,
        path: "/email-otp/send-verification-otp",
      }),
    },
    rateLimit: {
      expectedFinalStatus: 200,
      kind: "rate-limit",
      prerequisite:
        "Enable the consumer's production-equivalent rate-limit policy in an isolated database. Confirm throttling through delivery counts, security events, or isolated database state; the public response stays generic HTTP 200 to prevent identity enumeration.",
      requests: Array.from({ length: positiveAttempts(options.rateLimitAttempts) }, rateLimitRequest),
    },
    revokedSession: {
      expectedStatus: 401,
      kind: "revoked-session",
      prerequisite:
        "Create and revoke this session, then dispatch this request to a consumer route protected by auth middleware.",
      request: sessionRequest(options.allowedOrigin),
    },
  };
}

export interface ConsumerIsolationFixture {
  cookiePrefix: string;
  tablePrefix: string;
}

/** Distinct deterministic namespaces for proving that two consumers do not share auth state. */
export function createConsumerIsolationFixtures(
  seed = "fixture",
): readonly [ConsumerIsolationFixture, ConsumerIsolationFixture] {
  const normalized = seed.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,19}$/u.test(normalized)) throw new Error("auth_test_consumer_seed_invalid");
  return [
    { cookiePrefix: `${normalized}-a`, tablePrefix: `${normalized.replaceAll("-", "_")}_a` },
    { cookiePrefix: `${normalized}-b`, tablePrefix: `${normalized.replaceAll("-", "_")}_b` },
  ];
}

export interface AuthTestClock {
  advance(milliseconds: number): void;
  now(): Date;
}

export function createAuthTestClock(initial: Date | number = 0): AuthTestClock {
  let timestamp = initial instanceof Date ? initial.getTime() : initial;
  if (!Number.isSafeInteger(timestamp)) throw new Error("auth_test_clock_invalid");
  return {
    advance(milliseconds) {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error("auth_test_clock_advance_invalid");
      timestamp += milliseconds;
      if (!Number.isSafeInteger(timestamp)) throw new Error("auth_test_clock_invalid");
    },
    now: () => new Date(timestamp),
  };
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export interface WebAuthnClientDataFixture {
  challenge: string;
  clientDataJSON: string;
  crossOrigin: boolean;
  origin: string;
  type: "webauthn.create" | "webauthn.get";
}

export interface WebAuthnBoundaryFixtures {
  crossOrigin: WebAuthnClientDataFixture;
  validAuthentication: WebAuthnClientDataFixture;
  validRegistration: WebAuthnClientDataFixture;
  wrongChallenge: WebAuthnClientDataFixture;
  wrongOrigin: WebAuthnClientDataFixture;
}

function webAuthnClientData(
  type: WebAuthnClientDataFixture["type"],
  challenge: string,
  origin: string,
  crossOrigin = false,
): WebAuthnClientDataFixture {
  return {
    challenge,
    clientDataJSON: base64UrlEncode(JSON.stringify({ challenge, crossOrigin, origin, type })),
    crossOrigin,
    origin,
    type,
  };
}

/** Browser-boundary clientDataJSON vectors; these are not fake cryptographic assertions. */
export function createWebAuthnBoundaryFixtures(
  origin: string,
  challenge = "fixture-challenge",
): WebAuthnBoundaryFixtures {
  const resolved = new URL(origin);
  if (resolved.origin !== origin || resolved.protocol !== "https:")
    throw new Error("auth_test_webauthn_origin_invalid");
  return {
    crossOrigin: webAuthnClientData("webauthn.get", challenge, origin, true),
    validAuthentication: webAuthnClientData("webauthn.get", challenge, origin),
    validRegistration: webAuthnClientData("webauthn.create", challenge, origin),
    wrongChallenge: webAuthnClientData("webauthn.get", "wrong-challenge", origin),
    wrongOrigin: webAuthnClientData("webauthn.get", challenge, "https://wrong-origin.invalid"),
  };
}
