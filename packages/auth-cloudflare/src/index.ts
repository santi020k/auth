import { passkey } from "@better-auth/passkey";
import type { D1Database } from "@cloudflare/workers-types";
import { APIError, betterAuth, type BetterAuthOptions } from "better-auth";
import { emailOTP } from "better-auth/plugins";

const DEFAULT_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
const MAX_EMAIL_LENGTH = 254;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CORS_METHODS = new Set(["GET", "HEAD", "POST"]);
const CORS_HEADERS = new Set(["content-type"]);

export interface AuthEmail {
  email: string;
  otp: string;
}

export interface AuthEmailOtpRateLimit {
  max: number;
  window: number;
}

export type AuthVersionedSecret = NonNullable<BetterAuthOptions["secrets"]>[number];

export type OwnerAuthEmail = AuthEmail;
export type OwnerAuthEmailOtpRateLimit = AuthEmailOtpRateLimit;
export type OwnerAuthVersionedSecret = AuthVersionedSecret;

interface OwnerAuthSimpleSecretOptions {
  legacySecret?: never;
  secret: string;
  secrets?: never;
}

interface AuthVersionedSecretOptions {
  legacySecret?: string;
  secret?: never;
  secrets: AuthVersionedSecret[];
}

type AuthSecretOptions = OwnerAuthSimpleSecretOptions | AuthVersionedSecretOptions;

interface AuthPolicyConfiguration {
  appName: string;
  applicationOrigin: string;
  authServerURL: string;
  basePath?: `/${string}`;
  cookiePrefix: string;
  emailOtpRateLimit?: AuthEmailOtpRateLimit;
}

interface AuthRuntimeConfiguration {
  database: D1Database;
  sendVerificationOTP(email: AuthEmail): Promise<void>;
  sessionExpiresIn?: number;
  sessionUpdateAge?: number;
  waitUntil(task: Promise<void>): void;
}

export type MultiUserAuthPolicyOptions = AuthPolicyConfiguration & AuthSecretOptions;

export type MultiUserAuthOptions = MultiUserAuthPolicyOptions &
  AuthRuntimeConfiguration & {
    authorizeEmail(email: string): boolean | Promise<boolean>;
  };

export type OwnerAuthPolicyOptions = AuthPolicyConfiguration &
  AuthSecretOptions & {
    ownerEmail: string;
  };

export type OwnerAuthOptions = OwnerAuthPolicyOptions & AuthRuntimeConfiguration;

export interface AuthPolicy {
  applicationOrigin: string;
  authServerOrigin: string;
  basePath: string;
  cookiePrefix: string;
  emailOtpRateLimit: AuthEmailOtpRateLimit;
  relyingPartyId: string;
  secureCookies: boolean;
}

export interface OwnerAuthPolicy extends AuthPolicy {
  ownerEmail: string;
}

export interface AuthSessionIdentity {
  email: string;
  userId: string;
}

interface AuthInstance<TPolicy extends AuthPolicy> {
  handler(request: Request): Promise<Response>;
  policy: TPolicy;
  resolveSession(headers: Headers): Promise<AuthSessionIdentity | null>;
}

export type MultiUserAuthInstance = AuthInstance<AuthPolicy>;
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

export function normalizeAuthEmail(value: string): string {
  const email = value.trim().toLowerCase();
  const atIndex = email.indexOf("@");
  const domain = email.slice(atIndex + 1);
  const dotIndex = domain.indexOf(".");
  const isValid =
    email.length <= MAX_EMAIL_LENGTH &&
    atIndex > 0 &&
    atIndex === email.lastIndexOf("@") &&
    dotIndex > 0 &&
    dotIndex < domain.length - 1 &&
    !/\s/u.test(email);
  if (!isValid) throw new Error("owner_auth_email_invalid");
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

function resolveEmailOtpRateLimit(value: AuthEmailOtpRateLimit | undefined): AuthEmailOtpRateLimit {
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

function resolveAuthPolicy(options: MultiUserAuthPolicyOptions): AuthPolicy {
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
    relyingPartyId: applicationOrigin.hostname,
    secureCookies: authServerOrigin.protocol === "https:",
  };
}

export function resolveMultiUserAuthPolicy(options: MultiUserAuthPolicyOptions): AuthPolicy {
  return resolveAuthPolicy(options);
}

export function resolveOwnerAuthPolicy(options: OwnerAuthPolicyOptions): OwnerAuthPolicy {
  return {
    ...resolveAuthPolicy(options),
    ownerEmail: normalizeAuthEmail(options.ownerEmail),
  };
}

function corsHeaders(policy: AuthPolicy): Headers {
  return new Headers({
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": policy.applicationOrigin,
    Vary: "Origin",
  });
}

function withCors(policy: AuthPolicy, request: Request, response: Response): Response {
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

function preflightResponse(policy: AuthPolicy, request: Request): Response {
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
    return normalizeAuthEmail(body.email);
  } catch {
    return "";
  }
}

function enforceRequestBoundary(policy: AuthPolicy, request: Request, url: URL, method: string): Response | undefined {
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

async function enforceAuthRequest(
  policy: AuthPolicy,
  authorizeEmail: (email: string) => boolean | Promise<boolean>,
  invalidCredentialsCode: string | undefined,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${policy.basePath}/`) && url.pathname !== policy.basePath) return null;

  const method = request.method.toUpperCase();
  const boundaryResponse = enforceRequestBoundary(policy, request, url, method);
  if (boundaryResponse) return boundaryResponse;

  if (method !== "POST" || invalidCredentialsCode === undefined) return null;
  if (url.pathname === `${policy.basePath}/email-otp/send-verification-otp`) {
    return null;
  }
  const email = await requestEmail(request);
  if (email === null || (email !== "" && (await authorizeEmail(email)))) return null;
  return errorResponse(401, invalidCredentialsCode);
}

export function enforceOwnerAuthRequest(policy: OwnerAuthPolicy, request: Request): Promise<Response | null> {
  return enforceAuthRequest(policy, (email) => email === policy.ownerEmail, "invalid_owner_credentials", request);
}

function isEmailOtpSendRequest(policy: AuthPolicy, request: Request): boolean {
  const url = new URL(request.url);
  return (
    request.method.toUpperCase() === "POST" && url.pathname === `${policy.basePath}/email-otp/send-verification-otp`
  );
}

function isSessionCleanupRequest(policy: AuthPolicy, request: Request): boolean {
  const path = new URL(request.url).pathname;
  return path === `${policy.basePath}/sign-out`;
}

async function authorizeUserId(
  database: D1Database,
  userId: string,
  authorizeEmail: (email: string) => boolean | Promise<boolean>,
): Promise<boolean> {
  const user = await database.prepare("SELECT email FROM user WHERE id = ?").bind(userId).first<{ email: string }>();
  return user !== null && authorizeEmail(normalizeAuthEmail(user.email));
}

async function authorizePasskeyCredential(
  database: D1Database,
  credentialId: string,
  authorizeEmail: (email: string) => boolean | Promise<boolean>,
): Promise<boolean> {
  const user = await database
    .prepare(
      "SELECT user.email FROM passkey INNER JOIN user ON user.id = passkey.userId WHERE passkey.credentialID = ?",
    )
    .bind(credentialId)
    .first<{ email: string }>();
  return user !== null && authorizeEmail(normalizeAuthEmail(user.email));
}

function createConfiguredAuth<TPolicy extends AuthPolicy>(
  options: MultiUserAuthPolicyOptions & AuthRuntimeConfiguration,
  policy: TPolicy,
  authorizeEmail: (email: string) => boolean | Promise<boolean>,
  invalidCredentialsCode?: string,
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
      session: {
        create: {
          before: async (session) => {
            if (!(await authorizeUserId(options.database, session.userId, authorizeEmail))) {
              throw new APIError("UNAUTHORIZED", { message: invalidCredentialsCode ?? "invalid_credentials" });
            }
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
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        allowedAttempts: 5,
        disableSignUp: false,
        expiresIn: 10 * 60,
        otpLength: 6,
        rateLimit: policy.emailOtpRateLimit,
        sendVerificationOTP: ({ email, otp, type }) => {
          const deliver = async (): Promise<void> => {
            const normalizedEmail = normalizeAuthEmail(email);
            if (type !== "sign-in" || !(await authorizeEmail(normalizedEmail))) return;
            await options.sendVerificationOTP({ email: normalizedEmail, otp });
          };
          const deliveryTask = deferLifecycleTask(deliver);
          options.waitUntil(deliveryTask);
          return Promise.resolve();
        },
        storeOTP: "hashed",
      }),
      passkey({
        advanced: { webAuthnChallengeCookie: `${policy.cookiePrefix}-passkey` },
        authentication: {
          afterVerification: async ({ clientData }) => {
            if (!(await authorizePasskeyCredential(options.database, clientData.id, authorizeEmail))) {
              throw new APIError("UNAUTHORIZED", { message: invalidCredentialsCode ?? "invalid_credentials" });
            }
          },
        },
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
      const rejection = await enforceAuthRequest(policy, authorizeEmail, invalidCredentialsCode, request);
      if (rejection) return withCors(policy, request, rejection);
      const currentSession = await auth.api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (
        currentSession &&
        !(await authorizeEmail(normalizeAuthEmail(currentSession.user.email))) &&
        !isSessionCleanupRequest(policy, request)
      ) {
        return withCors(policy, request, errorResponse(401, invalidCredentialsCode ?? "invalid_credentials"));
      }
      const response = await auth.handler(request);
      return withCors(policy, request, isEmailOtpSendRequest(policy, request) ? genericEmailResponse() : response);
    },
    policy,
    resolveSession: async (headers: Headers): Promise<AuthSessionIdentity | null> => {
      const session = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!session) return null;
      const email = normalizeAuthEmail(session.user.email);
      if (!(await authorizeEmail(email))) return null;
      return { email, userId: session.user.id };
    },
  };
}

export function createMultiUserAuth(options: MultiUserAuthOptions): MultiUserAuthInstance {
  const policy = resolveMultiUserAuthPolicy(options);
  return createConfiguredAuth(options, policy, (email) => options.authorizeEmail(email));
}

export function createOwnerAuth(options: OwnerAuthOptions): OwnerAuthInstance {
  const policy = resolveOwnerAuthPolicy(options);
  return createConfiguredAuth(options, policy, (email) => email === policy.ownerEmail, "invalid_owner_credentials");
}
