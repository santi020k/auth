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

/**
 * Extracts the first cookie's name=value pair. Uses `getSetCookie()` rather than
 * `get("Set-Cookie")`, whose single-string return value comma-joins multiple Set-Cookie
 * headers (for example a session cookie alongside a WebAuthn challenge cookie) into one
 * string that a naive `;`-split can parse incorrectly.
 */
export function readResponseCookie(response: Response): string {
  const [setCookie] = response.headers.getSetCookie();
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

export interface MachineAuthContractFixtureOptions {
  activationToken: string;
  digestMismatchToken: string;
  expiredToken: string;
  insufficientScopeToken: string;
  origin: string;
  path?: `/${string}`;
  revokedToken: string;
  unknownCredentialToken: string;
  validToken: string;
}

export interface MachineAuthContractRequestFixture {
  expectedStatus: 200 | 401 | 403;
  kind:
    | "active-at-boundary"
    | "digest-mismatch"
    | "expired-credential"
    | "insufficient-scope"
    | "malformed-token"
    | "missing-token"
    | "not-yet-active"
    | "oversized-token"
    | "revoked-credential"
    | "unknown-credential"
    | "valid-credential";
  prerequisite: string;
  request: Request;
}

export interface MachineAuthContractFixtures {
  activeAtBoundary: MachineAuthContractRequestFixture;
  digestMismatch: MachineAuthContractRequestFixture;
  expiredCredential: MachineAuthContractRequestFixture;
  insufficientScope: MachineAuthContractRequestFixture;
  malformedToken: MachineAuthContractRequestFixture;
  missingToken: MachineAuthContractRequestFixture;
  notYetActive: MachineAuthContractRequestFixture;
  oversizedToken: MachineAuthContractRequestFixture;
  revokedCredential: MachineAuthContractRequestFixture;
  unknownCredential: MachineAuthContractRequestFixture;
  validCredential: MachineAuthContractRequestFixture;
}

/** Canonical request vectors for a consumer route protected exclusively by machine credentials. */
export function createMachineAuthContractFixtures(
  options: MachineAuthContractFixtureOptions,
): MachineAuthContractFixtures {
  const url = new URL(options.path ?? "/machine", options.origin);
  const request = (token?: string) =>
    new Request(url, token === undefined ? undefined : { headers: { Authorization: `Bearer ${token}` } });
  return {
    activeAtBoundary: {
      expectedStatus: 200,
      kind: "active-at-boundary",
      prerequisite: "Store activationToken and set the authentication clock exactly to its notBefore timestamp.",
      request: request(options.activationToken),
    },
    digestMismatch: {
      expectedStatus: 401,
      kind: "digest-mismatch",
      prerequisite: "Store the credential identifier with a valid digest that does not match digestMismatchToken.",
      request: request(options.digestMismatchToken),
    },
    expiredCredential: {
      expectedStatus: 401,
      kind: "expired-credential",
      prerequisite: "Store expiredToken and set the authentication clock exactly to or after its expiresAt timestamp.",
      request: request(options.expiredToken),
    },
    insufficientScope: {
      expectedStatus: 403,
      kind: "insufficient-scope",
      prerequisite: "Store insufficientScopeToken without at least one scope required by the protected route.",
      request: request(options.insufficientScopeToken),
    },
    malformedToken: {
      expectedStatus: 401,
      kind: "malformed-token",
      prerequisite: "No credential state is required.",
      request: request("not-a-machine-token"),
    },
    missingToken: {
      expectedStatus: 401,
      kind: "missing-token",
      prerequisite: "No credential state is required.",
      request: request(),
    },
    notYetActive: {
      expectedStatus: 401,
      kind: "not-yet-active",
      prerequisite: "Store activationToken and set the authentication clock one millisecond before its notBefore.",
      request: request(options.activationToken),
    },
    oversizedToken: {
      expectedStatus: 401,
      kind: "oversized-token",
      prerequisite: "Assert that the consumer resolver and security events never receive the overlong identifier.",
      request: request(`sma_${"a".repeat(81)}_${"A".repeat(43)}`),
    },
    revokedCredential: {
      expectedStatus: 401,
      kind: "revoked-credential",
      prerequisite: "Store revokedToken with revokedAt equal to or earlier than the authentication clock.",
      request: request(options.revokedToken),
    },
    unknownCredential: {
      expectedStatus: 401,
      kind: "unknown-credential",
      prerequisite: "Return null from the consumer resolver for this validated identifier.",
      request: request(options.unknownCredentialToken),
    },
    validCredential: {
      expectedStatus: 200,
      kind: "valid-credential",
      prerequisite: "Store validToken as an active credential with every scope required by the route.",
      request: request(options.validToken),
    },
  };
}

/** Proves that an authentication failure is non-cacheable and does not echo supplied secrets. */
export async function assertMachineAuthFailureIsSafe(
  response: Response,
  sensitiveValues: readonly string[],
): Promise<void> {
  if (response.status !== 401 && response.status !== 403) {
    throw new Error("auth_test_machine_failure_status_invalid");
  }
  if (response.headers.get("Cache-Control") !== "no-store") {
    throw new Error("auth_test_machine_failure_cache_invalid");
  }
  const headerLines: string[] = [];
  response.headers.forEach((value, key) => {
    headerLines.push(`${key}:${value}`);
  });
  const evidence = `${headerLines.join("\n")}\n${await response.clone().text()}`;
  if (sensitiveValues.some((value) => value.length > 0 && evidence.includes(value))) {
    throw new Error("auth_test_machine_failure_secret_leaked");
  }
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
