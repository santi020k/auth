# `@santi020k/auth-cloudflare`

Email-code and passkey authentication policy for Hono applications running on Cloudflare Workers and D1. Choose a
single configured owner or let the consuming application approve multiple identities. Better Auth owns the
authentication protocol and persistence implementation; this package owns the shared Santiago policy.

The package intentionally does not share sessions, cookies, passkeys, databases, secrets, or relying-party IDs between
applications. Every consumer supplies a unique origin, cookie prefix, secret, D1 binding, and email delivery callback.

When the authentication Worker is hosted separately from the browser application, `baseURL` is the public Worker URL
and `browserOrigin` is the single exact browser origin allowed to make unsafe requests and register passkeys. Omitting
`browserOrigin` keeps the same-origin default.

## Current status

This package is already public. Version 0.4 preserves its v0.3 policy options and compatibility subpaths, but the six
new split packages in this repository remain private while initial consumers validate the integration. Do not replace
an application's current authentication until its D1 migration, compatibility route, session cutover, and browser
passkey flow have passed; see the repository's
[release process](https://github.com/santi020k/auth/blob/main/docs/releasing.md) for the exact gate.

## v0.3 compatibility

Existing consumers may continue using `applicationOrigin` and `authServerURL`; they are compatibility aliases for
`browserOrigin` and `baseURL`. Versioned `secrets` with an optional `legacySecret`, configurable `emailOtpRateLimit`,
and the original two-field `AuthSessionIdentity` assignment contract also remain supported. Newly resolved sessions
include optional typed lifecycle fields (`authenticatedAt`, `expiresAt`, and `sessionId`). New code should use
`browserOrigin` and `baseURL`; providing a legacy and replacement origin option with different values fails closed.

## Policy

- Email OTPs are six digits, expire after ten minutes, allow five verification attempts, and are stored hashed.
- Rate limits are enabled in every environment and use D1 rather than per-isolate memory.
- Only the configured owner or identities approved by the consumer may create or update an identity.
- Unauthorized email-code requests receive the same success-shaped response without sending mail.
- Unsafe requests require the exact configured browser `Origin` header.
- Passkeys require discoverable credentials and user verification.
- Optional social providers use the same consumer email-admission policy; provider credentials remain consumer-owned.
- Optional Cloudflare Turnstile protection defaults to the email-code request endpoint.
- The WebAuthn relying-party ID is always the exact application hostname.
- Production cookies are secure and remain scoped to the authentication API hostname.

## Example

```ts
const ownerAuth = createOwnerAuth({
  appName: "Example owner workspace",
  baseURL: "https://planner.example.com",
  cookiePrefix: "example-owner",
  database: env.DB,
  ownerEmail: env.OWNER_EMAIL,
  secret: env.AUTH_SECRET,
  sendVerificationOTP: ({ email, otp }) => sendLoginCode(env, email, otp),
  waitUntil: (task) => context.waitUntil(task),
});

app.all("/api/auth/*", (context) => ownerAuth.handler(context.req.raw));
```

For multiple accounts, keep membership and roles in the consuming application and provide a current access decision:

```ts
const auth = createMultiUserAuth({
  appName: "Example team workspace",
  authorizeEmail: async (email) => Boolean(await findActiveMember(env.DB, email)),
  baseURL: "https://workspace.example.com",
  cookiePrefix: "example-members",
  database: env.DB,
  secret: env.AUTH_SECRET,
  sendVerificationOTP: ({ email, otp }) => sendLoginCode(env, email, otp),
});
```

For a split web/API deployment, keep the two security boundaries explicit:

```ts
const ownerAuth = createOwnerAuth({
  appName: "Example control room",
  baseURL: "https://api.example.com",
  browserOrigin: "https://control.example.com",
  cookiePrefix: "example-control-owner",
  database: env.DB,
  ownerEmail: env.OWNER_EMAIL,
  secret: env.AUTH_SECRET,
  sendVerificationOTP: ({ email, otp }) => sendLoginCode(env, email, otp),
});
```

The API must still return credentialed CORS headers for that exact browser origin. `browserOrigin` does not accept an
origin list and does not create a shared cookie domain.

Set `tablePrefix` when the consumer database already contains generic tables such as `user` or `session`. Generate its
app-owned migration with the same prefix through `@santi020k/auth-migrations`; a prefix is part of the persistent storage
contract and must not be changed after deployment.

`authorizeEmail` receives a normalized email address and is checked during code requests, identity writes, code
delivery, and session resolution. A member rejected after signing in no longer resolves as authenticated. The package
does not own roles, invitations, organizations, or cross-application identity state.

Consumers may pass Better Auth `socialProviders` for approved OAuth providers. The package checks the fresh provider
email before provisioning, linking, or OAuth sign-in, so OAuth cannot bypass `ownerEmail` or `authorizeEmail`.
Account-linking UX, scopes, callback routes, and provider credentials remain consumer-owned.

Public code-request surfaces can enable Turnstile through the same server policy:

```ts
const auth = createMultiUserAuth({
  // ...application-owned configuration
  turnstile: {
    allowedHostnames: ["workspace.example.com"],
    expectedAction: "request-login-code",
    secretKey: env.TURNSTILE_SECRET_KEY,
  },
});
```

The browser supplies Better Auth's `x-captcha-response` header. Site and secret keys must not be shared across products.

Cloudflare Workers must enable `nodejs_compat` (or the narrower `nodejs_als` flag when no other Node compatibility is
needed). Each application must generate and review its own Better Auth core and passkey migration; the package does not
silently create or mutate production tables.

## Session operations and security events

The configured instance provides server-side `listSessions(userId)`, `revokeSession(userId, sessionId)`,
`revokeAllSessions(userId)`, and `emergencyLockout(userId)` operations. Inventory entries contain ISO timestamps and
device metadata but never session tokens, and expired sessions are omitted. The explicit `userId` scope prevents a
session ID from revoking another account's session. Consumers must authenticate and authorize their own management
routes before calling these methods; this package deliberately does not define roles, recovery, or administrative
policy.

Supply `onSecurityEvent` to forward authentication events into the consumer's established audit or alerting system:

```ts
const auth = createMultiUserAuth({
  // ...application-owned configuration
  onSecurityEvent: (event) => auditSecurityEvent(event),
});
```

Events cover blocked origins or credentials, suppressed and failed email-code delivery, code requests, session
creation, scoped revocation, revoke-all, and explicit emergency lockout. Listener failures are isolated from the auth
flow. Event payloads intentionally omit codes, cookies, session tokens, secrets, and request bodies.

Resolved identities include `authenticatedAt` and `expiresAt` ISO timestamps. Use `isRecentAuthentication` or the Hono
recent-authentication middleware for sensitive actions. The application still chooses the step-up method and owns the
authorization decision.
