import { passkey } from "@better-auth/passkey";
import type { D1Database } from "@cloudflare/workers-types";
import { type AuthTableNames, resolveAuthTableNames } from "@santi020k/auth-migrations";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { captcha, emailOTP } from "better-auth/plugins";

const DEFAULT_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface AuthEmail {
  email: string;
  otp: string;
}

/**
 * Observability hook for security-relevant occurrences. Consumers own
 * storage and alerting; this package only reports what happened. A listener
 * that throws never breaks the authentication flow — the failure is
 * swallowed after the listener runs.
 */
export type AuthSecurityEvent =
  | { email: string; path: string; type: "credentials_rejected" }
  | { email: string; type: "email_otp_delivery_failed" }
  | { email: string; type: "email_otp_delivery_suppressed" }
  | { email: string; type: "email_otp_requested" }
  | { revokedSessions: number; type: "emergency_lockout"; userId: string }
  | { origin: string | null; path: string; type: "request_origin_rejected" }
  | { sessionId: string; type: "session_created"; userId: string }
  | { sessionId: string; type: "session_revoked"; userId: string }
  | { revokedSessions: number; type: "sessions_revoked_all"; userId: string };

export type AuthSecurityEventListener = (event: AuthSecurityEvent) => Promise<void> | void;

interface BaseAuthPolicyOptions {
  appName: string;
  basePath?: `/${string}`;
  baseURL: string;
  browserOrigin?: string;
  cookiePrefix: string;
  secret: string;
  /** Optional Better Auth social providers. Credentials remain consumer-owned secrets. */
  socialProviders?: BetterAuthOptions["socialProviders"];
  tablePrefix?: string;
  /** Optional Cloudflare Turnstile protection for authentication endpoints. */
  turnstile?: AuthTurnstileOptions;
}

export interface AuthTurnstileOptions {
  allowedHostnames?: readonly string[];
  endpoints?: readonly string[];
  expectedAction?: string;
  secretKey: string;
}

interface AuthRuntimeOptions {
  database: D1Database;
  onSecurityEvent?: AuthSecurityEventListener;
  sendVerificationOTP(email: AuthEmail): Promise<void>;
  sessionExpiresIn?: number;
  sessionUpdateAge?: number;
  waitUntil?(task: Promise<void>): void;
}

export interface AuthPolicy {
  basePath: string;
  baseURL: string;
  cookiePrefix: string;
  origin: string;
  relyingPartyId: string;
  secureCookies: boolean;
  tableNames: AuthTableNames;
}

export interface AuthSessionIdentity {
  authenticatedAt: string;
  email: string;
  expiresAt: string;
  sessionId: string;
  userId: string;
}

/** One stored session row, safe to render in a "your devices" UI. Never includes the session token. */
export interface AuthSessionSummary {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  updatedAt: string;
  userAgent: string | null;
}

interface StoredAuthSessionSummary {
  createdAt: number;
  expiresAt: number;
  id: string;
  ipAddress: string | null;
  updatedAt: number;
  userAgent: string | null;
}

interface AuthInstance<TPolicy extends AuthPolicy> {
  /** Revokes every session for `userId` immediately and reports an `emergency_lockout` event. Returns the count revoked. */
  emergencyLockout(userId: string): Promise<number>;
  handler(request: Request): Promise<Response>;
  /** Lists `userId`'s active sessions, newest first. */
  listSessions(userId: string): Promise<AuthSessionSummary[]>;
  policy: TPolicy;
  resolveSession(headers: Headers): Promise<AuthSessionIdentity | null>;
  /** Revokes every session for `userId`. Returns the count revoked. */
  revokeAllSessions(userId: string): Promise<number>;
  /** Revokes one session owned by `userId`. Returns `false` if no matching session existed. */
  revokeSession(userId: string, sessionId: string): Promise<boolean>;
}

export interface MultiUserAuthOptions extends BaseAuthPolicyOptions, AuthRuntimeOptions {
  authorizeEmail(email: string): boolean | Promise<boolean>;
}

export type MultiUserAuthInstance = AuthInstance<AuthPolicy>;

export interface OwnerAuthPolicyOptions extends BaseAuthPolicyOptions {
  ownerEmail: string;
}

export interface OwnerAuthOptions extends OwnerAuthPolicyOptions, AuthRuntimeOptions {}

export interface OwnerAuthPolicy extends AuthPolicy {
  ownerEmail: string;
}

export type OwnerAuthEmail = AuthEmail;
export type OwnerAuthInstance = AuthInstance<OwnerAuthPolicy>;
export type OwnerAuthSessionIdentity = AuthSessionIdentity;

function errorResponse(status: 401 | 403, code: string): Response {
  return Response.json(
    { code, message: code },
    {
      headers: { "Cache-Control": "no-store" },
      status,
    },
  );
}

function genericEmailResponse(): Response {
  return Response.json(
    { success: true },
    {
      headers: { "Cache-Control": "no-store" },
      status: 200,
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBasePath(value: `/${string}` | undefined): string {
  const basePath = value ?? "/api/auth";
  if (!/^\/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$/u.test(basePath) || basePath.includes("//")) {
    throw new Error("owner_auth_base_path_invalid");
  }
  return basePath;
}

function normalizeCookiePrefix(value: string): string {
  const cookiePrefix = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/u.test(cookiePrefix)) {
    throw new Error("owner_auth_cookie_prefix_invalid");
  }
  return cookiePrefix;
}

export function normalizeAuthEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("owner_auth_email_invalid");
  return email;
}

export function normalizeOwnerEmail(value: string): string {
  return normalizeAuthEmail(value);
}

function positiveInteger(value: number | undefined, fallback: number, code: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(code);
  return result;
}

function requireDate(value: Date | number | string, code: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(code);
  return date.toISOString();
}

/** Returns whether a session is recent enough for a consumer-defined step-up boundary. */
export function isRecentAuthentication(
  identity: Pick<AuthSessionIdentity, "authenticatedAt">,
  maxAgeSeconds: number,
  now: number = Date.now(),
): boolean {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error("auth_step_up_max_age_invalid");
  }
  if (!Number.isFinite(now)) throw new Error("auth_step_up_now_invalid");
  const authenticatedAt = new Date(identity.authenticatedAt).getTime();
  return Number.isFinite(authenticatedAt) && authenticatedAt <= now && now - authenticatedAt <= maxAgeSeconds * 1000;
}

function resolveTurnstileOptions(options: AuthTurnstileOptions, policy: AuthPolicy) {
  const secretKey = options.secretKey.trim();
  if (secretKey.length < 20) throw new Error("auth_turnstile_secret_invalid");
  const endpoints = [...(options.endpoints ?? ["/email-otp/send-verification-otp"])];
  if (endpoints.length === 0 || endpoints.some((endpoint) => !/^\/[A-Za-z0-9/*_-]+$/u.test(endpoint))) {
    throw new Error("auth_turnstile_endpoint_invalid");
  }
  const allowedHostnames = [...(options.allowedHostnames ?? [new URL(policy.origin).hostname])];
  if (allowedHostnames.length === 0 || allowedHostnames.some((hostname) => hostname !== hostname.toLowerCase())) {
    throw new Error("auth_turnstile_hostname_invalid");
  }
  return {
    allowedHostnames,
    endpoints,
    ...(options.expectedAction ? { expectedAction: options.expectedAction } : {}),
    provider: "cloudflare-turnstile" as const,
    secretKey,
  };
}

function resolveOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("owner_auth_origin_invalid");
  }

  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const allowedProtocol = url.protocol === "https:" || (localHost && url.protocol === "http:");
  if (!allowedProtocol || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("owner_auth_origin_invalid");
  }
  return url;
}

function resolveAuthPolicy(options: BaseAuthPolicyOptions): AuthPolicy {
  if (!options.appName.trim()) throw new Error("owner_auth_app_name_invalid");
  if (options.secret.trim().length < 32) throw new Error("owner_auth_secret_invalid");
  const baseURL = resolveOrigin(options.baseURL);
  const browserOrigin = resolveOrigin(options.browserOrigin ?? options.baseURL);

  return {
    basePath: normalizeBasePath(options.basePath),
    baseURL: baseURL.origin,
    cookiePrefix: normalizeCookiePrefix(options.cookiePrefix),
    origin: browserOrigin.origin,
    relyingPartyId: browserOrigin.hostname,
    secureCookies: baseURL.protocol === "https:",
    tableNames: resolveAuthTableNames(options.tablePrefix),
  };
}

export function resolveOwnerAuthPolicy(options: OwnerAuthPolicyOptions): OwnerAuthPolicy {
  return {
    ...resolveAuthPolicy(options),
    ownerEmail: normalizeAuthEmail(options.ownerEmail),
  };
}

async function requestEmail(request: Request): Promise<string | null> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  if (!isRecord(body) || typeof body.email !== "string") return null;
  try {
    return normalizeAuthEmail(body.email);
  } catch {
    return "";
  }
}

async function emitSecurityEvent(
  listener: AuthSecurityEventListener | undefined,
  event: AuthSecurityEvent,
): Promise<void> {
  if (!listener) return;
  try {
    await listener(event);
  } catch {
    // Consumer observability hooks must never break the authentication flow.
  }
}

async function rejectInvalidOrigin(
  policy: AuthPolicy,
  request: Request,
  path: string,
  emit: AuthSecurityEventListener | undefined,
): Promise<Response | null> {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method) || request.headers.get("Origin") === policy.origin) return null;
  await emitSecurityEvent(emit, {
    origin: request.headers.get("Origin"),
    path,
    type: "request_origin_rejected",
  });
  return errorResponse(403, "request_origin_not_allowed");
}

async function rejectUnauthorizedEmail(
  policy: AuthPolicy,
  path: string,
  email: string,
  invalidCredentialsCode: string,
  emit: AuthSecurityEventListener | undefined,
): Promise<Response> {
  if (path === `${policy.basePath}/email-otp/send-verification-otp`) {
    if (email) await emitSecurityEvent(emit, { email, type: "email_otp_delivery_suppressed" });
    return genericEmailResponse();
  }
  if (email) await emitSecurityEvent(emit, { email, path, type: "credentials_rejected" });
  return errorResponse(401, invalidCredentialsCode);
}

async function enforceAuthRequest(
  policy: AuthPolicy,
  authorizeEmail: (email: string) => boolean | Promise<boolean>,
  invalidCredentialsCode: string,
  request: Request,
  emit?: AuthSecurityEventListener,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${policy.basePath}/`) && url.pathname !== policy.basePath) return null;

  const originRejection = await rejectInvalidOrigin(policy, request, url.pathname, emit);
  if (originRejection) return originRejection;

  if (request.method.toUpperCase() !== "POST") return null;
  const email = await requestEmail(request);
  if (email === null || (email !== "" && (await authorizeEmail(email)))) return null;
  return rejectUnauthorizedEmail(policy, url.pathname, email, invalidCredentialsCode, emit);
}

export function enforceOwnerAuthRequest(policy: OwnerAuthPolicy, request: Request): Promise<Response | null> {
  return enforceAuthRequest(policy, (email) => email === policy.ownerEmail, "invalid_owner_credentials", request);
}

async function listAuthSessionsForUser(
  database: D1Database,
  sessionTable: string,
  userId: string,
): Promise<AuthSessionSummary[]> {
  const result = await database
    .prepare(
      `SELECT "id", "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent" FROM "${sessionTable}" WHERE "userId" = ? AND "expiresAt" > ? ORDER BY "createdAt" DESC`,
    )
    .bind(userId, Date.now())
    .all<StoredAuthSessionSummary>();
  return result.results.map((session) => ({
    createdAt: new Date(session.createdAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
    id: session.id,
    ipAddress: session.ipAddress,
    updatedAt: new Date(session.updatedAt).toISOString(),
    userAgent: session.userAgent,
  }));
}

async function revokeAuthSessionForUser(
  database: D1Database,
  sessionTable: string,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const result = await database
    .prepare(`DELETE FROM "${sessionTable}" WHERE "userId" = ? AND "id" = ?`)
    .bind(userId, sessionId)
    .run();
  return result.meta.changes > 0;
}

async function revokeAllAuthSessionsForUser(
  database: D1Database,
  sessionTable: string,
  userId: string,
): Promise<number> {
  const result = await database.prepare(`DELETE FROM "${sessionTable}" WHERE "userId" = ?`).bind(userId).run();
  return result.meta.changes;
}

function createConfiguredAuth<TPolicy extends AuthPolicy>(
  options: BaseAuthPolicyOptions & AuthRuntimeOptions,
  policy: TPolicy,
  authorizeEmail: (email: string) => boolean | Promise<boolean>,
  invalidCredentialsCode: string,
): AuthInstance<TPolicy> {
  const sessionExpiresIn = positiveInteger(
    options.sessionExpiresIn,
    DEFAULT_SESSION_LIFETIME_SECONDS,
    "owner_auth_session_lifetime_invalid",
  );
  const sessionUpdateAge = positiveInteger(
    options.sessionUpdateAge,
    DEFAULT_SESSION_UPDATE_AGE_SECONDS,
    "owner_auth_session_update_age_invalid",
  );

  const turnstile = options.turnstile ? resolveTurnstileOptions(options.turnstile, policy) : null;

  const auth = betterAuth({
    advanced: {
      cookiePrefix: policy.cookiePrefix,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: policy.secureCookies,
    },
    appName: options.appName.trim(),
    basePath: policy.basePath,
    baseURL: policy.baseURL,
    database: options.database,
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await emitSecurityEvent(options.onSecurityEvent, {
              sessionId: session.id,
              type: "session_created",
              userId: session.userId,
            });
          },
        },
      },
      user: {
        create: {
          before: async (user) => authorizeEmail(normalizeAuthEmail(user.email)),
        },
        update: {
          before: async (user) => typeof user.email !== "string" || authorizeEmail(normalizeAuthEmail(user.email)),
        },
      },
    },
    account: { modelName: policy.tableNames.account },
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        allowedAttempts: 5,
        disableSignUp: false,
        expiresIn: 10 * 60,
        otpLength: 6,
        rateLimit: { max: 3, window: 60 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          const normalizedEmail = normalizeAuthEmail(email);
          if (type !== "sign-in" || !(await authorizeEmail(normalizedEmail))) return;
          await emitSecurityEvent(options.onSecurityEvent, { email: normalizedEmail, type: "email_otp_requested" });
          const task = options.sendVerificationOTP({ email: normalizedEmail, otp }).catch(async (error: unknown) => {
            await emitSecurityEvent(options.onSecurityEvent, {
              email: normalizedEmail,
              type: "email_otp_delivery_failed",
            });
            throw error;
          });
          if (options.waitUntil) {
            options.waitUntil(task);
            return;
          }
          await task;
        },
        storeOTP: "hashed",
      }),
      passkey({
        advanced: { webAuthnChallengeCookie: `${policy.cookiePrefix}-passkey` },
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        origin: policy.origin,
        rpID: policy.relyingPartyId,
        rpName: options.appName.trim(),
        schema: { passkey: { modelName: policy.tableNames.passkey } },
      }),
      ...(turnstile ? [captcha(turnstile)] : []),
    ],
    rateLimit: {
      enabled: true,
      max: 100,
      modelName: policy.tableNames.rateLimit,
      storage: "database",
      window: 60,
    },
    secret: options.secret,
    ...(options.socialProviders ? { socialProviders: options.socialProviders } : {}),
    session: {
      expiresIn: sessionExpiresIn,
      modelName: policy.tableNames.session,
      updateAge: sessionUpdateAge,
    },
    trustedOrigins: [policy.origin],
    user: {
      modelName: policy.tableNames.user,
      validateUserInfo: async ({ source, user }) => {
        if (typeof user.email !== "string") return { error: invalidCredentialsCode };
        const email = normalizeAuthEmail(user.email);
        if (await authorizeEmail(email)) return;
        await emitSecurityEvent(options.onSecurityEvent, {
          email,
          path: source.method,
          type: "credentials_rejected",
        });
        return { error: invalidCredentialsCode };
      },
    },
    verification: { modelName: policy.tableNames.verification },
  });

  return {
    emergencyLockout: async (userId: string): Promise<number> => {
      const revokedSessions = await revokeAllAuthSessionsForUser(options.database, policy.tableNames.session, userId);
      await emitSecurityEvent(options.onSecurityEvent, { revokedSessions, type: "emergency_lockout", userId });
      return revokedSessions;
    },
    handler: async (request: Request): Promise<Response> => {
      const rejection = await enforceAuthRequest(
        policy,
        authorizeEmail,
        invalidCredentialsCode,
        request,
        options.onSecurityEvent,
      );
      return rejection ?? auth.handler(request);
    },
    listSessions: (userId: string): Promise<AuthSessionSummary[]> =>
      listAuthSessionsForUser(options.database, policy.tableNames.session, userId),
    policy,
    resolveSession: async (headers: Headers): Promise<AuthSessionIdentity | null> => {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;
      const email = normalizeAuthEmail(session.user.email);
      if (!(await authorizeEmail(email))) return null;
      return {
        authenticatedAt: requireDate(session.session.createdAt, "auth_session_created_at_invalid"),
        email,
        expiresAt: requireDate(session.session.expiresAt, "auth_session_expires_at_invalid"),
        sessionId: session.session.id,
        userId: session.user.id,
      };
    },
    revokeAllSessions: async (userId: string): Promise<number> => {
      const revokedSessions = await revokeAllAuthSessionsForUser(options.database, policy.tableNames.session, userId);
      if (revokedSessions > 0) {
        await emitSecurityEvent(options.onSecurityEvent, { revokedSessions, type: "sessions_revoked_all", userId });
      }
      return revokedSessions;
    },
    revokeSession: async (userId: string, sessionId: string): Promise<boolean> => {
      const revoked = await revokeAuthSessionForUser(options.database, policy.tableNames.session, userId, sessionId);
      if (revoked) {
        await emitSecurityEvent(options.onSecurityEvent, { sessionId, type: "session_revoked", userId });
      }
      return revoked;
    },
  };
}

export function createMultiUserAuth(options: MultiUserAuthOptions): MultiUserAuthInstance {
  const policy = resolveAuthPolicy(options);
  return createConfiguredAuth(options, policy, (email) => options.authorizeEmail(email), "invalid_credentials");
}

export function createOwnerAuth(options: OwnerAuthOptions): OwnerAuthInstance {
  const policy = resolveOwnerAuthPolicy(options);
  return createConfiguredAuth(options, policy, (email) => email === policy.ownerEmail, "invalid_owner_credentials");
}
