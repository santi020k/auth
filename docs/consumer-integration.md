# Consumer integration checklist

Integrate one application at a time. Reusing `@santi020k/auth-cloudflare` standardizes protocol policy; it does not
create shared identity state.

Use the packages by responsibility:

- Configure server policy with `@santi020k/auth-cloudflare` and mount it with `@santi020k/auth-hono`.
- Generate, review, and commit an app-owned D1 migration with `@santi020k/auth-migrations`.
- Use `@santi020k/auth-client` in the browser instead of configuring Better Auth plugins in every application.
- Optionally use `@santi020k/auth-email-resend` for provider delivery; keep API keys and sender configuration in the
  consumer's secret manager.
- Optionally use `@santi020k/auth-recovery` for one-time recovery-code generation and digesting. The consumer must own
  the atomic store, recovery authority, audit trail, session revocation, and replacement policy.
- Use `@santi020k/auth-testing` only in test code for isolated D1 and request fixtures.

## Required per application

1. Create a dedicated D1 database binding and add an application-owned, additive migration based on the playground
   schema. Never point two applications at the same authentication tables.
2. Configure a unique 32-character-or-longer `AUTH_SECRET` through the application's existing secret manager.
3. Configure the exact HTTPS origin, a unique cookie prefix, application-specific email delivery, and either one owner
   email or a consumer-owned membership lookup.
4. Mount the handler at `/api/auth/*` and protect application routes with `resolveSession`.
5. Keep the old session path available during a bounded compatibility period. Do not reinterpret existing cookies as
   Better Auth sessions.
6. Verify email request privacy, sign-in, sign-out, expiry, rate limiting, and cross-origin rejection in development.
7. Verify passkey registration and sign-in in a real browser on the final application origin. WebAuthn credentials are
   relying-party specific and cannot be copied from the playground or another application.
8. Define and test the application's recovery process before removing its previous login path.
   Store only recovery-code digests, use a separate application-specific pepper, and make code consumption atomic.

## PostLens Planner shape

```ts
const ownerAuth = createOwnerAuth({
  appName: "PostLens Planner",
  baseURL: env.AUTH_BASE_URL,
  cookiePrefix: "postlens-planner-owner",
  database: env.PLANNER_DB,
  ownerEmail: env.OWNER_EMAIL,
  secret: env.AUTH_SECRET,
  sendVerificationOTP: ({ email, otp }) => sendPlannerLoginCode(env, email, otp),
  waitUntil: (task) => context.executionCtx.waitUntil(task),
});
```

The Planner migration belongs in the PostLens repository and must preserve its current login sessions during cutover.

## Observatory shape

```ts
const ownerAuth = createOwnerAuth({
  appName: "Observatory",
  baseURL: env.API_URL,
  browserOrigin: env.SITE_URL,
  cookiePrefix: "observatory-owner",
  database: env.OBSERVATORY_DB,
  ownerEmail: env.OWNER_EMAIL,
  secret: env.AUTH_SECRET,
  sendVerificationOTP: ({ email, otp }) => sendObservatoryLoginCode(env, email, otp),
  waitUntil: (task) => context.executionCtx.waitUntil(task),
});
```

Observatory retains its own recovery policy, mail content, database, passkeys, and cookies. A successful PostLens
integration is evidence about the package, not authorization to reuse PostLens state.

Because Observatory serves its API on a separate hostname, its CORS policy must allow credentials only from the exact
`SITE_URL`. The Better Auth cookie remains host-only on the API hostname, while WebAuthn is bound to the browser
hostname from `SITE_URL`.

## Multi-user shape

Use `createMultiUserAuth` only when the consumer has an authoritative member source. The callback receives a normalized
email address and must return the member's current access state; roles and permissions remain a separate consumer
concern.

```ts
const auth = createMultiUserAuth({
  appName: "Example team workspace",
  authorizeEmail: async (email) => {
    const member = await env.DB.prepare("SELECT active FROM app_members WHERE email = ?")
      .bind(email)
      .first<{ active: number }>();
    return member?.active === 1;
  },
  baseURL: env.AUTH_BASE_URL,
  cookiePrefix: "example-members",
  database: env.AUTH_DB,
  secret: env.AUTH_SECRET,
  sendVerificationOTP: ({ email, otp }) => sendLoginCode(env, email, otp),
  waitUntil: (task) => context.executionCtx.waitUntil(task),
});
```

Do not point multiple products at the same membership or authentication tables. Disabling a member makes
`resolveSession` return `null` for that identity; consumers should also expose an administrative session-revocation
workflow when stored sessions must be removed immediately.
