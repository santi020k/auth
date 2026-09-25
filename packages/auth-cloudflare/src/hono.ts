import type { Context, MiddlewareHandler } from "hono";

import type { OwnerAuthInstance, OwnerAuthSessionIdentity } from "./index.js";

export const OWNER_AUTH_SESSION_VARIABLE = "ownerAuthSession";

export interface OwnerAuthVariables {
  ownerAuthSession: OwnerAuthSessionIdentity;
}

export interface OwnerAuthEnv {
  Variables: OwnerAuthVariables;
}

export type OwnerAuthResolver<Environment extends OwnerAuthEnv> =
  OwnerAuthInstance | ((context: Context<Environment>) => OwnerAuthInstance);

function unauthorizedResponse(): Response {
  return Response.json(
    {
      code: "owner_auth_session_required",
      message: "owner_auth_session_required",
    },
    {
      headers: { "Cache-Control": "no-store" },
      status: 401,
    },
  );
}

/** Resolves an owner session once and exposes it to downstream Hono handlers. */
export function createOwnerAuthMiddleware<Environment extends OwnerAuthEnv = OwnerAuthEnv>(
  resolver: OwnerAuthResolver<Environment>,
): MiddlewareHandler<Environment> {
  return async (context, next) => {
    const auth = typeof resolver === "function" ? resolver(context) : resolver;
    const session = await auth.resolveSession(context.req.raw.headers);
    if (!session) return unauthorizedResponse();

    context.set(OWNER_AUTH_SESSION_VARIABLE, session);
    await next();
  };
}
