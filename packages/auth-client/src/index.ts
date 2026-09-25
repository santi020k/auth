import { passkeyClient } from "@better-auth/passkey/client";
import { type AuthClient, createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

export interface AuthClientOptions {
  basePath?: `/${string}`;
  baseURL: string;
}

export interface AuthClientFailure {
  code: string;
  message: string;
  status: number | null;
}

export type AuthClientResult<T> =
  { data: T; error: null; ok: true } | { data: null; error: AuthClientFailure; ok: false };

export interface AuthClientSessionIdentity {
  authenticatedAt: string;
  email: string;
  expiresAt: string;
  sessionId: string;
  userId: string;
}

export interface AuthClientSessionSummary {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  updatedAt: string;
  userAgent: string | null;
}

export interface AuthClientPasskeySummary {
  backedUp: boolean;
  createdAt: string | null;
  deviceType: string;
  id: string;
  name: string | null;
}

export interface AddPasskeyOptions {
  authenticatorAttachment?: "cross-platform" | "platform";
  name?: string;
}

export interface SignInWithPasskeyOptions {
  autoFill?: boolean;
}

export interface RequestEmailOtpOptions {
  captchaResponse?: string;
}

export interface AuthSocialFlowOptions {
  callbackURL?: string;
  disableRedirect?: boolean;
  errorCallbackURL?: string;
  loginHint?: string;
  scopes?: readonly string[];
}

export interface AuthSocialFlowResult {
  redirect: boolean;
  url: string | null;
}

export interface SantiAuthHelpers {
  addPasskey(options?: AddPasskeyOptions): Promise<AuthClientResult<void>>;
  deletePasskey(passkeyId: string): Promise<AuthClientResult<void>>;
  getSession(): Promise<AuthClientResult<AuthClientSessionIdentity | null>>;
  listPasskeys(): Promise<AuthClientResult<readonly AuthClientPasskeySummary[]>>;
  listSessions(): Promise<AuthClientResult<readonly AuthClientSessionSummary[]>>;
  linkSocialAccount(provider: string, options?: AuthSocialFlowOptions): Promise<AuthClientResult<AuthSocialFlowResult>>;
  raw: SantiAuthClient;
  requestEmailOtp(email: string, options?: RequestEmailOtpOptions): Promise<AuthClientResult<void>>;
  revokeAllSessions(): Promise<AuthClientResult<void>>;
  revokeOtherSessions(): Promise<AuthClientResult<void>>;
  revokeSession(sessionId: string): Promise<AuthClientResult<void>>;
  renamePasskey(passkeyId: string, name: string): Promise<AuthClientResult<void>>;
  signInWithEmailOtp(email: string, otp: string): Promise<AuthClientResult<void>>;
  signInWithPasskey(options?: SignInWithPasskeyOptions): Promise<AuthClientResult<void>>;
  signInWithSocial(provider: string, options?: AuthSocialFlowOptions): Promise<AuthClientResult<AuthSocialFlowResult>>;
  signOut(): Promise<AuthClientResult<void>>;
}

interface SantiAuthClientConfiguration {
  basePath: string;
  baseURL: string;
  fetchOptions: { credentials: "include" };
  plugins: [ReturnType<typeof emailOTPClient>, ReturnType<typeof passkeyClient>];
}

export type SantiAuthClient = AuthClient<SantiAuthClientConfiguration>;

function normalizeBasePath(value: string | undefined): `/${string}` {
  const path = value ?? "/api/auth";
  if (!path.startsWith("/") || path.endsWith("/") || path.includes("//")) {
    throw new Error("auth_client_base_path_invalid");
  }
  return path as `/${string}`;
}

function normalizeBaseURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("auth_client_base_url_invalid");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("auth_client_base_url_invalid");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("auth_client_base_url_invalid");
  }
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedErrorCode(value: string): string {
  const code = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return code || "auth_request_failed";
}

const DEFAULT_FAILURE_MESSAGE = "Authentication request failed";

function nestedError(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.error ?? value;
}

function recordErrorCode(value: Record<string, unknown>): string {
  if (typeof value.code === "string") return value.code;
  if (typeof value.statusText === "string") return value.statusText;
  return "auth_request_failed";
}

/** Converts thrown values and Better Fetch error payloads into one UI-safe error contract. */
export function normalizeAuthClientError(value: unknown): AuthClientFailure {
  const source = nestedError(value);
  if (isRecord(source)) {
    const status = typeof source.status === "number" && Number.isFinite(source.status) ? source.status : null;
    const message =
      typeof source.message === "string" && source.message.trim() ? source.message : DEFAULT_FAILURE_MESSAGE;
    return { code: normalizedErrorCode(recordErrorCode(source)), message, status };
  }
  if (source instanceof Error) {
    return {
      code: source.name === "AbortError" ? "request_cancelled" : "auth_request_failed",
      message: source.message || DEFAULT_FAILURE_MESSAGE,
      status: null,
    };
  }
  return { code: "auth_request_failed", message: DEFAULT_FAILURE_MESSAGE, status: null };
}

type LocatedError = { found: false } | { found: true; value: unknown };

function responseError(value: unknown): LocatedError {
  if (!isRecord(value) || value.error === null || value.error === undefined) return { found: false };
  return { found: true, value: value.error };
}

async function runVoidOperation(operation: () => Promise<unknown>): Promise<AuthClientResult<void>> {
  try {
    const response = await operation();
    const error = responseError(response);
    if (error.found) return { data: null, error: normalizeAuthClientError(error.value), ok: false };
    return { data: undefined, error: null, ok: true };
  } catch (error: unknown) {
    return { data: null, error: normalizeAuthClientError(error), ok: false };
  }
}

function normalizeSocialProvider(provider: string): string {
  const normalizedProvider = provider.trim();
  if (!normalizedProvider || !/^[a-z0-9][a-z0-9_-]{1,63}$/u.test(normalizedProvider)) {
    throw new Error("auth_social_provider_invalid");
  }
  return normalizedProvider;
}

function socialFlowBody(provider: string, options: AuthSocialFlowOptions | undefined) {
  return {
    callbackURL: options?.callbackURL,
    disableRedirect: options?.disableRedirect,
    errorCallbackURL: options?.errorCallbackURL,
    loginHint: options?.loginHint,
    provider: normalizeSocialProvider(provider),
    scopes: options?.scopes ? [...options.scopes] : undefined,
  };
}

async function runSocialFlow(operation: () => Promise<unknown>): Promise<AuthClientResult<AuthSocialFlowResult>> {
  try {
    const response = await operation();
    const error = responseError(response);
    if (error.found) return { data: null, error: normalizeAuthClientError(error.value), ok: false };
    if (!isRecord(response) || !isRecord(response.data) || typeof response.data.redirect !== "boolean") {
      return { data: null, error: normalizeAuthClientError(null), ok: false };
    }
    const url = response.data.url;
    if (url !== undefined && url !== null && typeof url !== "string") {
      return { data: null, error: normalizeAuthClientError(null), ok: false };
    }
    return { data: { redirect: response.data.redirect, url: url ?? null }, error: null, ok: true };
  } catch (error: unknown) {
    return { data: null, error: normalizeAuthClientError(error), ok: false };
  }
}

function requiredString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function isoDate(value: unknown): string | null {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "number" || typeof value === "string") date = new Date(value);
  else return null;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseSessionIdentity(value: unknown): AuthClientSessionIdentity | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.user)) return undefined;
  const email = requiredString(value.user, "email");
  const sessionId = requiredString(value.session, "id");
  const userId = requiredString(value.user, "id");
  const authenticatedAt = isoDate(value.session.createdAt);
  const expiresAt = isoDate(value.session.expiresAt);
  if (!email || !sessionId || !userId || !authenticatedAt || !expiresAt) return undefined;
  return { authenticatedAt, email, expiresAt, sessionId, userId };
}

async function runPasskeySignIn(
  raw: SantiAuthClient,
  options: SignInWithPasskeyOptions | undefined,
  clientOptions: Required<AuthClientOptions>,
): Promise<AuthClientResult<void>> {
  const operation = await runVoidOperation(() => raw.signIn.passkey(options));
  if (!operation.ok) return operation;
  try {
    const response = await fetch(
      `${clientOptions.baseURL}${clientOptions.basePath}/get-session?disableCookieCache=true`,
      {
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        data: null,
        error: normalizeAuthClientError(
          isRecord(payload) ? { ...payload, status: response.status } : { status: response.status },
        ),
        ok: false,
      };
    }
    const identity = parseSessionIdentity(payload);
    if (identity !== null && identity !== undefined) return operation;
  } catch (error: unknown) {
    return { data: null, error: normalizeAuthClientError(error), ok: false };
  }
  return {
    data: null,
    error: {
      code: "auth_session_not_created",
      message: "Passkey verification did not create a session",
      status: 401,
    },
    ok: false,
  };
}

interface ParsedSessionSummary {
  summary: AuthClientSessionSummary;
  token: string;
}

function parseSessionSummary(value: unknown): ParsedSessionSummary | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, "id");
  const token = requiredString(value, "token");
  const createdAt = isoDate(value.createdAt);
  const updatedAt = isoDate(value.updatedAt);
  const expiresAt = isoDate(value.expiresAt);
  if (!id || !token || !createdAt || !updatedAt || !expiresAt) return null;
  return {
    summary: {
      createdAt,
      expiresAt,
      id,
      ipAddress: nullableString(value, "ipAddress"),
      updatedAt,
      userAgent: nullableString(value, "userAgent"),
    },
    token,
  };
}

async function getSession(raw: SantiAuthClient): Promise<AuthClientResult<AuthClientSessionIdentity | null>> {
  try {
    const response: unknown = await raw.getSession();
    const error = responseError(response);
    if (error.found) return { data: null, error: normalizeAuthClientError(error.value), ok: false };
    if (!isRecord(response)) return { data: null, error: normalizeAuthClientError(null), ok: false };
    const identity = parseSessionIdentity(response.data);
    if (identity === undefined) return { data: null, error: normalizeAuthClientError(null), ok: false };
    return { data: identity, error: null, ok: true };
  } catch (error: unknown) {
    return { data: null, error: normalizeAuthClientError(error), ok: false };
  }
}

async function listSessions(
  raw: SantiAuthClient,
  sessionTokens: Map<string, string>,
): Promise<AuthClientResult<readonly AuthClientSessionSummary[]>> {
  try {
    const response: unknown = await raw.listSessions();
    const error = responseError(response);
    if (error.found) return { data: null, error: normalizeAuthClientError(error.value), ok: false };
    if (!isRecord(response) || !Array.isArray(response.data)) {
      return { data: null, error: normalizeAuthClientError(null), ok: false };
    }
    const parsed = response.data.map(parseSessionSummary);
    if (parsed.some((value) => value === null)) {
      return { data: null, error: normalizeAuthClientError(null), ok: false };
    }
    sessionTokens.clear();
    const summaries: AuthClientSessionSummary[] = [];
    for (const value of parsed) {
      if (!value) continue;
      sessionTokens.set(value.summary.id, value.token);
      summaries.push(value.summary);
    }
    return { data: summaries, error: null, ok: true };
  } catch (error: unknown) {
    return { data: null, error: normalizeAuthClientError(error), ok: false };
  }
}

function parsePasskeySummary(value: unknown): AuthClientPasskeySummary | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, "id");
  const deviceType = requiredString(value, "deviceType");
  if (!id || !deviceType || typeof value.backedUp !== "boolean") return null;
  const createdAt = value.createdAt === null || value.createdAt === undefined ? null : isoDate(value.createdAt);
  if (value.createdAt !== null && value.createdAt !== undefined && !createdAt) return null;
  return {
    backedUp: value.backedUp,
    createdAt,
    deviceType,
    id,
    name: nullableString(value, "name"),
  };
}

async function listPasskeys(raw: SantiAuthClient): Promise<AuthClientResult<readonly AuthClientPasskeySummary[]>> {
  try {
    const response: unknown = await raw.passkey.listUserPasskeys();
    const error = responseError(response);
    if (error.found) return { data: null, error: normalizeAuthClientError(error.value), ok: false };
    if (!isRecord(response) || !Array.isArray(response.data)) {
      return { data: null, error: normalizeAuthClientError(null), ok: false };
    }
    const passkeys = response.data.map(parsePasskeySummary);
    if (passkeys.some((value) => value === null)) {
      return { data: null, error: normalizeAuthClientError(null), ok: false };
    }
    return { data: passkeys.filter((value) => value !== null), error: null, ok: true };
  } catch (error: unknown) {
    return { data: null, error: normalizeAuthClientError(error), ok: false };
  }
}

export function resolveAuthClientOptions(options: AuthClientOptions): Required<AuthClientOptions> {
  return {
    basePath: normalizeBasePath(options.basePath),
    baseURL: normalizeBaseURL(options.baseURL),
  };
}

export function createSantiAuthClient(options: AuthClientOptions): SantiAuthClient {
  const resolved = resolveAuthClientOptions(options);
  return createAuthClient({
    basePath: resolved.basePath,
    baseURL: resolved.baseURL,
    fetchOptions: { credentials: "include" },
    plugins: [emailOTPClient(), passkeyClient()],
  });
}

/**
 * Stable, result-based helpers for application UIs. Session tokens stay inside
 * this closure: callers revoke a session by its safe database ID after loading
 * the inventory, while Better Auth still receives its opaque token.
 */
export function createSantiAuthHelpers(options: AuthClientOptions): SantiAuthHelpers {
  const resolved = resolveAuthClientOptions(options);
  const raw = createSantiAuthClient(options);
  const sessionTokens = new Map<string, string>();

  return {
    addPasskey: (passkeyOptions) => runVoidOperation(() => raw.passkey.addPasskey(passkeyOptions)),
    deletePasskey: (passkeyId) => runVoidOperation(() => raw.passkey.deletePasskey({ id: passkeyId })),
    getSession: () => getSession(raw),
    listPasskeys: () => listPasskeys(raw),
    listSessions: () => listSessions(raw, sessionTokens),
    linkSocialAccount: (provider, socialOptions) =>
      runSocialFlow(() => raw.linkSocial(socialFlowBody(provider, socialOptions))),
    raw,
    requestEmailOtp: (email, requestOptions) => {
      const fetchOptions = requestOptions?.captchaResponse
        ? { headers: { "x-captcha-response": requestOptions.captchaResponse } }
        : undefined;
      return runVoidOperation(() => raw.emailOtp.sendVerificationOtp({ email, type: "sign-in" }, fetchOptions));
    },
    revokeAllSessions: async () => {
      const result = await runVoidOperation(() => raw.revokeSessions());
      if (result.ok) sessionTokens.clear();
      return result;
    },
    revokeOtherSessions: async () => {
      const result = await runVoidOperation(() => raw.revokeOtherSessions());
      if (result.ok) sessionTokens.clear();
      return result;
    },
    revokeSession: (sessionId) => {
      const token = sessionTokens.get(sessionId);
      if (!token) {
        return Promise.resolve({
          data: null,
          error: {
            code: "auth_session_not_loaded",
            message: "Load the session inventory before revoking a session",
            status: null,
          },
          ok: false,
        });
      }
      return runVoidOperation(() => raw.revokeSession({ token })).then((result) => {
        if (result.ok) sessionTokens.delete(sessionId);
        return result;
      });
    },
    renamePasskey: (passkeyId, name) => runVoidOperation(() => raw.passkey.updatePasskey({ id: passkeyId, name })),
    signInWithEmailOtp: (email, otp) => runVoidOperation(() => raw.signIn.emailOtp({ email, otp })),
    signInWithPasskey: (passkeyOptions) => runPasskeySignIn(raw, passkeyOptions, resolved),
    signInWithSocial: (provider, socialOptions) =>
      runSocialFlow(() => raw.signIn.social(socialFlowBody(provider, socialOptions))),
    signOut: () => runVoidOperation(() => raw.signOut()),
  };
}
