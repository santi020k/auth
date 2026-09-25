# `@santi020k/auth-cloudflare`

Single-owner and multi-user email-code and passkey authentication policy for Hono applications running on Cloudflare
Workers and D1.
Better Auth owns the authentication protocol and persistence implementation; this package owns the shared Santiago
policy.

The package intentionally does not share sessions, cookies, passkeys, databases, secrets, or relying-party IDs between
applications. Every consumer supplies a unique browser origin, auth server URL, cookie prefix, secret, D1 binding, and
email delivery callback.

## Status

This is a public experimental `0.x` package. Pin the version, review release notes before updating, and keep an
application's existing authentication and recovery path during a bounded rollout. Real-world adoption validates a later
promotion to supported/stable status; it is not a prerequisite for installing the package.

## Install

```sh
pnpm add @santi020k/auth-cloudflare hono
```

The package exports:

- `@santi020k/auth-cloudflare`: server policy with `createOwnerAuth` and `createMultiUserAuth`;
- `@santi020k/auth-cloudflare/client`: credentialed owner and application browser clients with email OTP and passkeys;
- `@santi020k/auth-cloudflare/hono`: typed owner and application session middleware for protected Hono routes;
- `@santi020k/auth-cloudflare/schema`: owner and generic D1 schema diagnostics.

The published tarball also includes `schema/d1.sql`, the canonical SQL to copy into an app-owned additive migration.

## Policy

- Email OTPs are six digits, expire after ten minutes, allow five verification attempts, and are stored hashed.
- Email OTP rate limits default to three requests per ten minutes and persist in D1 rather than isolate memory.
- Only the configured owner or an email approved by the consumer's authorization callback may create or update an
  identity.
- Unauthorized email-code requests receive the same success-shaped response without sending mail.
- Multi-user session creation, session resolution, and authenticated passkey operations recheck the callback, so
  removing membership takes effect immediately even when a stored session has not expired.
- Requests accept only the exact configured browser origin. Unsafe requests without it are rejected, and credentialed
  CORS responses never use a wildcard origin.
- Passkeys require discoverable credentials and user verification.
- The WebAuthn relying-party ID is the application hostname, including when the auth Worker uses its supported same-site
  subdomain.
- Production cookies are secure and scoped to the auth server hostname.

## Server

`applicationOrigin` is where the browser application runs. `authServerURL` is where the auth handler runs. Use the same
origin for a simple deployment or the supported same-site subdomain shape for a separate Worker.

```ts
import { createOwnerAuth } from "@santi020k/auth-cloudflare";

app.all("/api/auth/*", (context) => {
  const ownerAuth = createOwnerAuth({
    appName: "Example owner workspace",
    applicationOrigin: "https://workspace.example.com",
    authServerURL: "https://auth.workspace.example.com",
    cookiePrefix: "example-owner",
    database: context.env.DB,
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

For secret rotation, replace `secret` with versioned secrets:

```ts
const ownerAuth = createOwnerAuth({
  // Other options omitted.
  secrets: [
    { value: env.AUTH_SECRET_V2, version: 2 },
    { value: env.AUTH_SECRET_V1, version: 1 },
  ],
  legacySecret: env.AUTH_SECRET_LEGACY,
});
```

Each value must contain at least 32 characters. Keep the active version first and retain previous versions only for the
documented compatibility window.

### Multiple accounts

Use `createMultiUserAuth` when the application owns a set of approved accounts. The package normalizes the email before
calling `authorizeEmail`; the callback may query an application-owned membership table or another authoritative local
source. Keep invitations, roles, teams, and product permissions outside the auth package.

```ts
import { createMultiUserAuth } from "@santi020k/auth-cloudflare";

const auth = createMultiUserAuth({
  appName: "Example team workspace",
  applicationOrigin: "https://workspace.example.com",
  authServerURL: "https://auth.workspace.example.com",
  cookiePrefix: "example-team",
  database: context.env.DB,
  secret: context.env.AUTH_SECRET,
  authorizeEmail: (email) => isActiveMember(context.env.DB, email),
  sendVerificationOTP: ({ email, otp }) => sendLoginCode(context.env, email, otp),
  waitUntil: (task) => {
    context.executionCtx.waitUntil(task);
  },
});
```

Approved and rejected code requests intentionally receive the same success-shaped response. Rejected addresses do not
receive mail and cannot create a user, though Better Auth may persist a hashed, expiring verification record as part of
the uniform flow. Session creation, `resolveSession`, and authenticated passkey operations recheck current membership.
Removing a member therefore prevents a new sign-in, passkey mutation, or subsequent session resolution; deleting stored
session records is an optional application-owned cleanup.

## Browser and protected routes

```ts
import { createOwnerAuthClient } from "@santi020k/auth-cloudflare/client";

export const authClient = createOwnerAuthClient({
  authServerURL: "https://auth.workspace.example.com",
});
```

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

For multi-user applications, use `createApplicationAuthClient` and `createAuthMiddleware`. The resolved identity is
available as `context.var.authSession` and contains only `email` and `userId`; load roles from application-owned data.

```ts
import { createApplicationAuthClient } from "@santi020k/auth-cloudflare/client";
import { createAuthMiddleware, type AuthEnv } from "@santi020k/auth-cloudflare/hono";

export const authClient = createApplicationAuthClient({
  authServerURL: "https://auth.workspace.example.com",
});

interface AppEnv extends AuthEnv {
  Bindings: Bindings;
}

app.use(
  "/account/*",
  createAuthMiddleware<AppEnv>((context) => createAuthForContext(context)),
);
```

## D1 ownership

Cloudflare Workers must enable `nodejs_compat` (or the narrower `nodejs_als` flag when no other Node compatibility is
needed). Copy `schema/d1.sql` into the consumer's migration directory, review it there, and apply it through that
application's deployment process. This package never silently creates or mutates production tables.

Use `checkAuthSchema` (or the retained `checkOwnerAuthSchema` alias) from `@santi020k/auth-cloudflare/schema` to report
missing required tables, columns, primary and unique key constraints, and indexes before serving authentication traffic.
Application-owned extra schema is allowed. Moving from the owner factory to multi-user auth does not require an auth
schema migration; the canonical tables already support multiple identities.

See the complete [consumer integration checklist](https://github.com/santi020k/auth/blob/main/docs/consumer-integration.md)
and [security policy](https://github.com/santi020k/auth/blob/main/SECURITY.md).
