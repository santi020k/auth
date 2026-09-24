# Consumer integration checklist

Integrate one application at a time. Reusing `@santi020k/auth-cloudflare` standardizes protocol policy; it does not
create shared identity state.

## Required per application

1. Create a dedicated D1 database binding and add an application-owned, additive migration based on the playground
   schema. Never point two applications at the same authentication tables.
2. Configure a unique 32-character-or-longer `AUTH_SECRET` through the application's existing secret manager.
3. Configure the exact HTTPS origin, a unique cookie prefix, the owner email, and application-specific email delivery.
4. Mount the handler at `/api/auth/*` and protect application routes with `resolveSession`.
5. Keep the old session path available during a bounded compatibility period. Do not reinterpret existing cookies as
   Better Auth sessions.
6. Verify email request privacy, sign-in, sign-out, expiry, rate limiting, and cross-origin rejection in development.
7. Verify passkey registration and sign-in in a real browser on the final application origin. WebAuthn credentials are
   relying-party specific and cannot be copied from the playground or another application.
8. Define and test the application's recovery process before removing its previous login path.

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
  baseURL: env.AUTH_BASE_URL,
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
