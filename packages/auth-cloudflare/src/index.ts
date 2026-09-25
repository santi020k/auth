import { passkey } from "@better-auth/passkey";
import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { emailOTP } from "better-auth/plugins";

const DEFAULT_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CORS_METHODS = new Set(["GET", "HEAD", "POST"]);
const CORS_HEADERS = new Set(["content-type"]);

export interface OwnerAuthEmail {
  email: string;
  otp: string;
}

export interface OwnerAuthEmailOtpRateLimit {
  max: number;
  window: number;
}

export type OwnerAuthVersionedSecret = NonNullable<BetterAuthOptions["secrets"]>[number];

interface OwnerAuthSimpleSecretOptions {
  legacySecret?: never;
  secret: string;
  secrets?: never;
}

interface OwnerAuthVersionedSecretOptions {
  legacySecret?: string;
  secret?: never;
  secrets: OwnerAuthVersionedSecret[];
}

type OwnerAuthSecretOptions = OwnerAuthSimpleSecretOptions | OwnerAuthVersionedSecretOptions;

interface OwnerAuthPolicyConfiguration {
  appName: string;
  applicationOrigin: string;
  authServerURL: string;
  basePath?: `/${string}`;
  cookiePrefix: string;
  emailOtpRateLimit?: OwnerAuthEmailOtpRateLimit;
  ownerEmail: string;
}

export type OwnerAuthPolicyOptions = OwnerAuthPolicyConfiguration & OwnerAuthSecretOptions;

export type OwnerAuthOptions = OwnerAuthPolicyOptions & {
  database: D1Database;
  sendVerificationOTP(email: OwnerAuthEmail): Promise<void>;
  sessionExpiresIn?: number;
  sessionUpdateAge?: number;
  waitUntil(task: Promise<void>): void;
};

export interface OwnerAuthPolicy {
  applicationOrigin: string;
  authServerOrigin: string;
  basePath: string;
  cookiePrefix: string;
  emailOtpRateLimit: OwnerAuthEmailOtpRateLimit;
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

function deferLifecycleTask(task: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  }).then(task);
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

function resolveEmailOtpRateLimit(value: OwnerAuthEmailOtpRateLimit | undefined): OwnerAuthEmailOtpRateLimit {
  return {
    max: positiveInteger(value?.max, 3, "owner_auth_email_otp_rate_limit_invalid"),
    window: positiveInteger(value?.window, 10 * 60, "owner_auth_email_otp_rate_limit_invalid"),
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

function assertSameSite(applicationOrigin: URL, authServerOrigin: URL): void {
  const sameProtocol = applicationOrigin.protocol === authServerOrigin.protocol;
  const sameHost = applicationOrigin.hostname === authServerOrigin.hostname;
  const authServerIsApplicationSubdomain = authServerOrigin.hostname.endsWith(`.${applicationOrigin.hostname}`);
  if (!sameProtocol || (!sameHost && !authServerIsApplicationSubdomain)) {
    throw new Error("owner_auth_origins_not_same_site");
  }
}

function validateSecret(value: string | undefined): void {
  if (value === undefined || value.trim().length < 32) throw new Error("owner_auth_secret_invalid");
}

function validateSecrets(options: {
  legacySecret?: string;
  secret?: string;
  secrets?: OwnerAuthVersionedSecret[];
}): void {
  if (options.secrets === undefined) {
    validateSecret(options.secret);
    return;
  }

  if (options.secret !== undefined || options.secrets.length === 0) throw new Error("owner_auth_secrets_invalid");
  const versions = new Set<number>();
  for (const secret of options.secrets) {
    if (!Number.isSafeInteger(secret.version) || secret.version < 0 || versions.has(secret.version)) {
      throw new Error("owner_auth_secrets_invalid");
    }
    validateSecret(secret.value);
    versions.add(secret.version);
  }
  if (options.legacySecret !== undefined) validateSecret(options.legacySecret);
}

export function resolveOwnerAuthPolicy(options: OwnerAuthPolicyOptions): OwnerAuthPolicy {
  if (!options.appName.trim()) throw new Error("owner_auth_app_name_invalid");
  validateSecrets(options);
  const applicationOrigin = resolveOrigin(options.applicationOrigin);
  const authServerOrigin = resolveOrigin(options.authServerURL);
  assertSameSite(applicationOrigin, authServerOrigin);

  return {
    applicationOrigin: applicationOrigin.origin,
    authServerOrigin: authServerOrigin.origin,
    basePath: normalizeBasePath(options.basePath),
    cookiePrefix: normalizeCookiePrefix(options.cookiePrefix),
    emailOtpRateLimit: resolveEmailOtpRateLimit(options.emailOtpRateLimit),
    ownerEmail: normalizeOwnerEmail(options.ownerEmail),
    relyingPartyId: applicationOrigin.hostname,
    secureCookies: authServerOrigin.protocol === "https:",
  };
}

function corsHeaders(policy: OwnerAuthPolicy): Headers {
  return new Headers({
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": policy.applicationOrigin,
    Vary: "Origin",
  });
}

function withCors(policy: OwnerAuthPolicy, request: Request, response: Response): Response {
  if (request.headers.get("Origin") !== policy.applicationOrigin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Origin", policy.applicationOrigin);
  const vary = headers.get("Vary");
  if (vary === null) headers.set("Vary", "Origin");
  else if (
    !vary
      .toLowerCase()
      .split(",")
      .some((value) => value.trim() === "origin")
  ) {
    headers.set("Vary", `${vary}, Origin`);
  }
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
}

function preflightResponse(policy: OwnerAuthPolicy, request: Request): Response {
  const requestedMethod = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    !requestedMethod ||
    !CORS_METHODS.has(requestedMethod) ||
    requestedHeaders.some((name) => !CORS_HEADERS.has(name))
  ) {
    return errorResponse(403, "request_origin_not_allowed");
  }
  const headers = corsHeaders(policy);
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST");
  headers.set("Access-Control-Max-Age", "600");
  return new Response(null, { headers, status: 204 });
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

function enforceRequestBoundary(
  policy: OwnerAuthPolicy,
  request: Request,
  url: URL,
  method: string,
): Response | undefined {
  const origin = request.headers.get("Origin");
  if (url.origin !== policy.authServerOrigin || (origin !== null && origin !== policy.applicationOrigin)) {
    return errorResponse(403, "request_origin_not_allowed");
  }
  if (method === "OPTIONS") {
    if (origin !== policy.applicationOrigin) return errorResponse(403, "request_origin_not_allowed");
    return preflightResponse(policy, request);
  }
  if (!SAFE_METHODS.has(method) && origin !== policy.applicationOrigin) {
    return errorResponse(403, "request_origin_not_allowed");
  }
  return undefined;
}

export async function enforceOwnerAuthRequest(policy: OwnerAuthPolicy, request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${policy.basePath}/`) && url.pathname !== policy.basePath) return null;

  const method = request.method.toUpperCase();
  const boundaryResponse = enforceRequestBoundary(policy, request, url, method);
  if (boundaryResponse) return boundaryResponse;

  if (method !== "POST") return null;
  if (url.pathname === `${policy.basePath}/email-otp/send-verification-otp`) {
    return null;
  }
  const email = await requestEmail(request);
  if (email === null || email === policy.ownerEmail) return null;
  return errorResponse(401, "invalid_owner_credentials");
}

function isEmailOtpSendRequest(policy: OwnerAuthPolicy, request: Request): boolean {
  const url = new URL(request.url);
  return (
    request.method.toUpperCase() === "POST" && url.pathname === `${policy.basePath}/email-otp/send-verification-otp`
  );
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
    baseURL: policy.authServerOrigin,
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
        rateLimit: policy.emailOtpRateLimit,
        sendVerificationOTP: ({ email, otp, type }) => {
          const shouldDeliver = type === "sign-in" && normalizeOwnerEmail(email) === policy.ownerEmail;
          const deliver = shouldDeliver
            ? () => options.sendVerificationOTP({ email: policy.ownerEmail, otp })
            : () => Promise.resolve();
          const deliveryTask = deferLifecycleTask(deliver);
          options.waitUntil(deliveryTask);
          return Promise.resolve();
        },
        storeOTP: "hashed",
      }),
      passkey({
        advanced: { webAuthnChallengeCookie: `${policy.cookiePrefix}-passkey` },
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        origin: policy.applicationOrigin,
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
    secret: options.secrets === undefined ? options.secret : options.legacySecret,
    secrets: options.secrets,
    session: {
      expiresIn: sessionExpiresIn,
      updateAge: sessionUpdateAge,
    },
    trustedOrigins: [policy.applicationOrigin],
  });

  return {
    handler: async (request: Request): Promise<Response> => {
      const rejection = await enforceOwnerAuthRequest(policy, request);
      if (rejection) return withCors(policy, request, rejection);
      const response = await auth.handler(request);
      return withCors(policy, request, isEmailOtpSendRequest(policy, request) ? genericEmailResponse() : response);
    },
    policy,
    resolveSession: async (headers: Headers): Promise<OwnerAuthSessionIdentity | null> => {
      const session = await auth.api.getSession({ headers });
      if (!session || normalizeOwnerEmail(session.user.email) !== policy.ownerEmail) return null;
      return { email: policy.ownerEmail, userId: session.user.id };
    },
  };
}
