# Consumer integration checklist

Integrate one application at a time. Reusing `@santi020k/auth-cloudflare` standardizes protocol policy; it does not
create shared identity state. The public package is experimental `0.x`, so pin its version and preserve the current
login and recovery path until the new path is verified on the application's real origin.

## Install and migrate

```sh
pnpm add @santi020k/auth-cloudflare hono
```

1. Copy the package's `schema/d1.sql` into an application-owned, additive migration. Do not run package migrations
   implicitly or point two applications at the same authentication tables.
2. Apply the migration through the application's normal development, staging, and production process.
3. Run `checkOwnerAuthSchema(database)` from `@santi020k/auth-cloudflare/schema` in a preflight or diagnostic path. It
   reports missing required tables, columns, primary and unique key constraints, and indexes while allowing
   application-owned additions.
4. Configure a unique cookie prefix, owner email, delivery provider, and secret through the application's secret
   manager. Never reuse secrets, cookies, sessions, passkeys, or databases between consumers.

## Configure the server

`applicationOrigin` is the exact browser origin. `authServerURL` is the exact Worker origin that mounts the handler.
They may be identical or use the supported same-site subdomain shape, such as
`https://observatory.santi020k.com` and `https://api.observatory.santi020k.com`. Production origins require HTTPS;
localhost and `127.0.0.1` may use HTTP for development.

```ts
import { createOwnerAuth } from "@santi020k/auth-cloudflare";

app.all("/api/auth/*", (context) => {
  const ownerAuth = createOwnerAuth({
    appName: "Example owner workspace",
    applicationOrigin: context.env.APPLICATION_ORIGIN,
    authServerURL: context.env.AUTH_SERVER_URL,
    cookiePrefix: "example-owner",
    database: context.env.AUTH_DB,
    ownerEmail: context.env.OWNER_EMAIL,
    secret: context.env.AUTH_SECRET,
    sendVerificationOTP: ({ email, otp }) => sendLoginCode(context.env, email, otp),
    waitUntil: (task) => {
      context.executionCtx.waitUntil(task);
    },
  });
  return ownerAuth.handler(context.req.raw);
});
```

The handler accepts credentialed browser requests only from the exact `applicationOrigin`. Unsafe requests without that
origin are rejected, and successful cross-origin responses expose credentials only to that configured origin.

For Hono routes, resolve the session once with the packaged middleware:

```ts
import { createOwnerAuthMiddleware, type OwnerAuthEnv } from "@santi020k/auth-cloudflare/hono";
import { Hono } from "hono";

interface AppEnv extends OwnerAuthEnv {
  Bindings: Bindings;
}

const protectedRoutes = new Hono<AppEnv>();
protectedRoutes.use(
  "*",
  createOwnerAuthMiddleware<AppEnv>((context) => createOwnerAuthForContext(context)),
);
protectedRoutes.get("/account", (context) => context.json(context.var.ownerAuthSession));
```

`createOwnerAuthForContext` is an application-owned resolver that returns a `createOwnerAuth(...)` instance using the
current request context and bindings, as in the server example above.

## Configure the browser

The packaged client includes the email OTP and passkey plugins and always sends credentials:

```ts
import { createOwnerAuthClient } from "@santi020k/auth-cloudflare/client";

export const authClient = createOwnerAuthClient({
  authServerURL: "https://api.observatory.santi020k.com",
});
```

If the server uses a non-default path, pass the same `basePath` to both server and client.

## Rotate secrets

New integrations may use one `secret`. For rotation, move to a versioned `secrets` array; keep the active secret first
and retain required previous versions during the compatibility window. `legacySecret` lets Better Auth continue reading
data created before versioned secrets were enabled.

```ts
const ownerAuth = createOwnerAuth({
  // Other per-application options omitted.
  secrets: [
    { value: env.AUTH_SECRET_V2, version: 2 },
    { value: env.AUTH_SECRET_V1, version: 1 },
  ],
  legacySecret: env.AUTH_SECRET_LEGACY,
});
```

Every secret must contain at least 32 characters. Store values only in the consumer's secret manager, rotate them with a
documented rollback plan, and remove old material only after its sessions or encrypted data are no longer needed.

## Verify the cutover

1. Keep the old session path available during a bounded compatibility period. Do not reinterpret old cookies as Better
   Auth sessions.
2. Verify email request privacy, sign-in, sign-out, expiry, attempt limits, rate limiting, exact-origin rejection, and
   credentialed CORS behavior.
3. Verify passkey registration and sign-in in a real browser on the final application origin. WebAuthn credentials are
   relying-party specific and cannot be copied from the playground or another application.
4. Define and rehearse application-owned recovery before removing the previous login path.
5. Record the exact package version, deployed revision, schema revision, and rendered browser evidence.

## Planned consumers

PostLens Planner is the first same-origin migration candidate. Observatory is the split-origin candidate, with its UI
at `observatory.santi020k.com` and auth Worker at `api.observatory.santi020k.com`. Each repository must own its migration,
delivery implementation, recovery policy, and rollout decision. Successful adoption validates promotion of this package
toward supported/stable status; it is not permission to reuse another product's identity state.
