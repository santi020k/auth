import type { Context, MiddlewareHandler } from "hono";

import type {
  AuthSessionIdentity,
  MultiUserAuthInstance,
  OwnerAuthInstance,
  OwnerAuthSessionIdentity,
} from "./index.js";

export const AUTH_SESSION_VARIABLE = "authSession";

export interface AuthVariables {
  authSession: AuthSessionIdentity;
}

export interface AuthEnv {
  Variables: AuthVariables;
}

export type AuthResolver<Environment extends AuthEnv> =
  MultiUserAuthInstance | ((context: Context<Environment>) => MultiUserAuthInstance);

export const OWNER_AUTH_SESSION_VARIABLE = "ownerAuthSession";

export interface OwnerAuthVariables {
  ownerAuthSession: OwnerAuthSessionIdentity;
}

export interface OwnerAuthEnv {
  Variables: OwnerAuthVariables;
}

export type OwnerAuthResolver<Environment extends OwnerAuthEnv> =
  OwnerAuthInstance | ((context: Context<Environment>) => OwnerAuthInstance);

function unauthorizedResponse(code: "auth_session_required" | "owner_auth_session_required"): Response {
  return Response.json(
    {
      code,
      message: code,
    },
    {
      headers: { "Cache-Control": "no-store" },
      status: 401,
    },
  );
}

/** Resolves a consumer-approved session once and exposes it to downstream Hono handlers. */
export function createAuthMiddleware<Environment extends AuthEnv = AuthEnv>(
  resolver: AuthResolver<Environment>,
): MiddlewareHandler<Environment> {
  return async (context, next) => {
    const auth = typeof resolver === "function" ? resolver(context) : resolver;
    const session = await auth.resolveSession(context.req.raw.headers);
    if (!session) return unauthorizedResponse("auth_session_required");

    context.set(AUTH_SESSION_VARIABLE, session);
    await next();
  };
}

/** Resolves an owner session once and exposes it to downstream Hono handlers. */
export function createOwnerAuthMiddleware<Environment extends OwnerAuthEnv = OwnerAuthEnv>(
  resolver: OwnerAuthResolver<Environment>,
): MiddlewareHandler<Environment> {
  return async (context, next) => {
    const auth = typeof resolver === "function" ? resolver(context) : resolver;
    const session = await auth.resolveSession(context.req.raw.headers);
    if (!session) return unauthorizedResponse("owner_auth_session_required");

    context.set(OWNER_AUTH_SESSION_VARIABLE, session);
    await next();
  };
}
