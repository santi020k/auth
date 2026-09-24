import { passkey } from "@better-auth/passkey";
import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";

const DEFAULT_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface OwnerAuthEmail {
  email: string;
  otp: string;
}

export interface OwnerAuthPolicyOptions {
  appName: string;
  basePath?: `/${string}`;
  baseURL: string;
  cookiePrefix: string;
  ownerEmail: string;
  secret: string;
}

export interface OwnerAuthOptions extends OwnerAuthPolicyOptions {
  database: D1Database;
  sendVerificationOTP(email: OwnerAuthEmail): Promise<void>;
  sessionExpiresIn?: number;
  sessionUpdateAge?: number;
  waitUntil?(task: Promise<void>): void;
}

export interface OwnerAuthPolicy {
  basePath: string;
  cookiePrefix: string;
  origin: string;
  ownerEmail: string;
  relyingPartyId: string;
  secureCookies: boolean;
}

export interface OwnerAuthSessionIdentity {
  email: string;
  userId: string;
}

export interface OwnerAuthInstance {
  handler(request: Request): Promise<Response>;
  policy: OwnerAuthPolicy;
  resolveSession(headers: Headers): Promise<OwnerAuthSessionIdentity | null>;
}

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

export function normalizeOwnerEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("owner_auth_email_invalid");
  return email;
}

function positiveInteger(value: number | undefined, fallback: number, code: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(code);
  return result;
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

export function resolveOwnerAuthPolicy(options: OwnerAuthPolicyOptions): OwnerAuthPolicy {
  if (!options.appName.trim()) throw new Error("owner_auth_app_name_invalid");
  if (options.secret.trim().length < 32) throw new Error("owner_auth_secret_invalid");
  const url = resolveOrigin(options.baseURL);

  return {
    basePath: normalizeBasePath(options.basePath),
    cookiePrefix: normalizeCookiePrefix(options.cookiePrefix),
    origin: url.origin,
    ownerEmail: normalizeOwnerEmail(options.ownerEmail),
    relyingPartyId: url.hostname,
    secureCookies: url.protocol === "https:",
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
    return normalizeOwnerEmail(body.email);
  } catch {
    return "";
  }
}

export async function enforceOwnerAuthRequest(policy: OwnerAuthPolicy, request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${policy.basePath}/`) && url.pathname !== policy.basePath) return null;

  if (!SAFE_METHODS.has(request.method.toUpperCase()) && request.headers.get("Origin") !== policy.origin) {
    return errorResponse(403, "request_origin_not_allowed");
  }

  if (request.method.toUpperCase() !== "POST") return null;
  const email = await requestEmail(request);
  if (email === null || email === policy.ownerEmail) return null;

  if (url.pathname === `${policy.basePath}/email-otp/send-verification-otp`) {
    return genericEmailResponse();
  }
  return errorResponse(401, "invalid_owner_credentials");
}

export function createOwnerAuth(options: OwnerAuthOptions): OwnerAuthInstance {
  const policy = resolveOwnerAuthPolicy(options);
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

  const auth = betterAuth({
    advanced: {
      cookiePrefix: policy.cookiePrefix,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: policy.secureCookies,
    },
    appName: options.appName.trim(),
    basePath: policy.basePath,
    baseURL: policy.origin,
    database: options.database,
    databaseHooks: {
      user: {
        create: {
          before: (user) => Promise.resolve(normalizeOwnerEmail(user.email) === policy.ownerEmail),
        },
        update: {
          before: (user) =>
            Promise.resolve(typeof user.email !== "string" || normalizeOwnerEmail(user.email) === policy.ownerEmail),
        },
      },
    },
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        allowedAttempts: 5,
        disableSignUp: false,
        expiresIn: 10 * 60,
        otpLength: 6,
        rateLimit: { max: 3, window: 60 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in" || normalizeOwnerEmail(email) !== policy.ownerEmail) return;
          const task = options.sendVerificationOTP({ email: policy.ownerEmail, otp });
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
      }),
    ],
    rateLimit: {
      enabled: true,
      max: 100,
      modelName: "rateLimit",
      storage: "database",
      window: 60,
    },
    secret: options.secret,
    session: {
      expiresIn: sessionExpiresIn,
      updateAge: sessionUpdateAge,
    },
    trustedOrigins: [policy.origin],
  });

  return {
    handler: async (request: Request): Promise<Response> => {
      const rejection = await enforceOwnerAuthRequest(policy, request);
      return rejection ?? auth.handler(request);
    },
    policy,
    resolveSession: async (headers: Headers): Promise<OwnerAuthSessionIdentity | null> => {
      const session = await auth.api.getSession({ headers });
      if (!session || normalizeOwnerEmail(session.user.email) !== policy.ownerEmail) return null;
      return { email: policy.ownerEmail, userId: session.user.id };
    },
  };
}
