import type { Context, Env, Handler, MiddlewareHandler } from "hono";

const DEFAULT_CORS_HEADERS = ["Content-Type"] as const;
const DEFAULT_CORS_METHODS = ["DELETE", "GET", "OPTIONS", "PATCH", "POST"] as const;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface AuthSessionIdentity {
  email: string;
  userId: string;
}

export interface RecentAuthSessionIdentity extends AuthSessionIdentity {
  authenticatedAt: string;
}

export interface HonoAuthInstance<TIdentity extends AuthSessionIdentity = AuthSessionIdentity> {
  handler(request: Request): Promise<Response>;
  resolveSession(headers: Headers): Promise<TIdentity | null>;
}

export type HonoAuthFactory<E extends Env, TIdentity extends AuthSessionIdentity = AuthSessionIdentity> = (
  context: Context<E>,
) => HonoAuthInstance<TIdentity> | Promise<HonoAuthInstance<TIdentity>>;

export function createHonoAuthHandler<E extends Env, TIdentity extends AuthSessionIdentity = AuthSessionIdentity>(
  createAuth: HonoAuthFactory<E, TIdentity>,
): Handler<E> {
  return async (context) => (await createAuth(context)).handler(context.req.raw);
}

export async function resolveHonoAuthSession<
  E extends Env,
  TIdentity extends AuthSessionIdentity = AuthSessionIdentity,
>(context: Context<E>, createAuth: HonoAuthFactory<E, TIdentity>): Promise<TIdentity | null> {
  return (await createAuth(context)).resolveSession(context.req.raw.headers);
}

export interface RequireHonoAuthOptions<E extends Env, TIdentity extends AuthSessionIdentity = AuthSessionIdentity> {
  createAuth: HonoAuthFactory<E, TIdentity>;
  onAuthenticated?(context: Context<E>, identity: TIdentity): void | Promise<void>;
  onUnauthorized?(context: Context<E>): Response | Promise<Response>;
}

export function createRequireHonoAuth<E extends Env, TIdentity extends AuthSessionIdentity = AuthSessionIdentity>(
  options: RequireHonoAuthOptions<E, TIdentity>,
): MiddlewareHandler<E> {
  return async (context, next) => {
    const identity = await resolveHonoAuthSession(context, options.createAuth);
    if (!identity) {
      if (options.onUnauthorized) return options.onUnauthorized(context);
      return context.json({ error: "authentication_required" }, 401);
    }
    await options.onAuthenticated?.(context, identity);
    await next();
  };
}

export interface RequireRecentHonoAuthOptions<
  E extends Env,
  TIdentity extends RecentAuthSessionIdentity = RecentAuthSessionIdentity,
> {
  createAuth: HonoAuthFactory<E, TIdentity>;
  maxAgeSeconds: number;
  now?: () => number;
  onAuthenticated?(context: Context<E>, identity: TIdentity): void | Promise<void>;
  onStepUpRequired?(context: Context<E>, identity: TIdentity): Response | Promise<Response>;
  onUnauthorized?(context: Context<E>): Response | Promise<Response>;
}

/** Checks session freshness without deciding which authentication method a consumer must use for step-up. */
export function isRecentHonoAuthentication(
  identity: Pick<RecentAuthSessionIdentity, "authenticatedAt">,
  maxAgeSeconds: number,
  now: number = Date.now(),
): boolean {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error("auth_hono_step_up_max_age_invalid");
  }
  if (!Number.isFinite(now)) throw new Error("auth_hono_step_up_now_invalid");
  const authenticatedAt = new Date(identity.authenticatedAt).getTime();
  return Number.isFinite(authenticatedAt) && authenticatedAt <= now && now - authenticatedAt <= maxAgeSeconds * 1000;
}

/** Requires both a valid session and consumer-defined recent authentication for sensitive routes. */
export function createRequireRecentHonoAuth<
  E extends Env,
  TIdentity extends RecentAuthSessionIdentity = RecentAuthSessionIdentity,
>(options: RequireRecentHonoAuthOptions<E, TIdentity>): MiddlewareHandler<E> {
  if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
    throw new Error("auth_hono_step_up_max_age_invalid");
  }
  return async (context, next) => {
    const identity = await resolveHonoAuthSession(context, options.createAuth);
    if (!identity) {
      if (options.onUnauthorized) return options.onUnauthorized(context);
      return context.json({ error: "authentication_required" }, 401);
    }
    if (!isRecentHonoAuthentication(identity, options.maxAgeSeconds, options.now?.() ?? Date.now())) {
      if (options.onStepUpRequired) return options.onStepUpRequired(context, identity);
      return context.json({ error: "recent_authentication_required" }, 403);
    }
    await options.onAuthenticated?.(context, identity);
    await next();
  };
}

export function honoWaitUntil<E extends Env>(context: Context<E>): (task: Promise<void>) => void {
  return (task) => {
    context.executionCtx.waitUntil(task);
  };
}

export interface HonoAuthCorsOptions {
  allowHeaders?: readonly string[];
  allowMethods?: readonly string[];
  allowedOrigins: readonly string[];
  exposeHeaders?: readonly string[];
  maxAgeSeconds?: number;
}

function isCredentialedCorsOrigin(url: URL): boolean {
  const secure = url.protocol === "https:" || (LOCAL_HOSTS.has(url.hostname) && url.protocol === "http:");
  return secure && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
}

function normalizeCorsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("auth_hono_cors_origin_invalid");
  }
  if (value === "*") throw new Error("auth_hono_cors_origin_invalid");
  if (!isCredentialedCorsOrigin(url)) throw new Error("auth_hono_cors_origin_invalid");
  return url.origin;
}

function normalizeCorsTokens(values: readonly string[], code: string): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (
    normalized.length !== values.length ||
    normalized.some((value) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(value))
  ) {
    throw new Error(code);
  }
  return normalized;
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("Vary");
  const values = new Set((existing ? existing.split(",") : []).map((item) => item.trim()).filter(Boolean));
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

interface ResolvedCorsOptions {
  allowHeaders: readonly string[];
  allowMethods: readonly string[];
  maxAge: number | undefined;
}

function preflightResponse(request: Request, headers: Headers, options: ResolvedCorsOptions): Response | null {
  const requestedMethod = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
  if (request.method !== "OPTIONS" || !requestedMethod) return null;
  if (!options.allowMethods.includes(requestedMethod)) {
    return Response.json({ error: "cors_method_not_allowed" }, { status: 403 });
  }
  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((header) => header.trim())
    .filter(Boolean);
  const permittedHeaders = new Set(options.allowHeaders.map((header) => header.toLowerCase()));
  if (requestedHeaders.some((header) => !permittedHeaders.has(header.toLowerCase()))) {
    return Response.json({ error: "cors_header_not_allowed" }, { status: 403 });
  }
  headers.set("Access-Control-Allow-Headers", options.allowHeaders.join(", "));
  headers.set("Access-Control-Allow-Methods", options.allowMethods.join(", "));
  if (options.maxAge !== undefined) headers.set("Access-Control-Max-Age", String(options.maxAge));
  appendVary(headers, "Access-Control-Request-Headers");
  appendVary(headers, "Access-Control-Request-Method");
  return new Response(null, { headers, status: 204 });
}

/**
 * Credentialed CORS for an explicit set of browser origins. Wildcards and
 * origin patterns are deliberately unsupported because they are unsafe with
 * cookie-backed authentication.
 */
export function createHonoAuthCors<E extends Env>(options: HonoAuthCorsOptions): MiddlewareHandler<E> {
  if (options.allowedOrigins.length === 0) throw new Error("auth_hono_cors_origins_required");
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeCorsOrigin));
  if (allowedOrigins.size !== options.allowedOrigins.length) throw new Error("auth_hono_cors_origin_duplicate");
  const allowHeaders = normalizeCorsTokens(
    options.allowHeaders ?? DEFAULT_CORS_HEADERS,
    "auth_hono_cors_header_invalid",
  );
  const allowMethods = normalizeCorsTokens(
    options.allowMethods ?? DEFAULT_CORS_METHODS,
    "auth_hono_cors_method_invalid",
  ).map((method) => method.toUpperCase());
  const exposeHeaders = normalizeCorsTokens(options.exposeHeaders ?? [], "auth_hono_cors_header_invalid");
  const maxAge = options.maxAgeSeconds;
  if (maxAge !== undefined && (!Number.isSafeInteger(maxAge) || maxAge < 0)) {
    throw new Error("auth_hono_cors_max_age_invalid");
  }

  return async (context, next) => {
    const origin = context.req.raw.headers.get("Origin");
    if (!origin) {
      await next();
      return;
    }
    if (!allowedOrigins.has(origin)) return context.json({ error: "origin_not_allowed" }, 403);

    const headers = new Headers();
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Origin", origin);
    appendVary(headers, "Origin");

    const preflight = preflightResponse(context.req.raw, headers, { allowHeaders, allowMethods, maxAge });
    if (preflight) return preflight;

    await next();
    // Set directly on the post-`next()` response headers instead of copying the pre-built
    // `headers` object wholesale: the downstream handler may have already set its own `Vary`
    // (or other) headers, and overwriting them would silently discard that signal.
    context.res.headers.set("Access-Control-Allow-Credentials", "true");
    context.res.headers.set("Access-Control-Allow-Origin", origin);
    appendVary(context.res.headers, "Origin");
    if (exposeHeaders.length > 0) context.res.headers.set("Access-Control-Expose-Headers", exposeHeaders.join(", "));
  };
}
