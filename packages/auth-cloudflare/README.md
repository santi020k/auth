# `@santi020k/auth-cloudflare`

Owner-only email-code and passkey authentication policy for Hono applications running on Cloudflare Workers and D1.
Better Auth owns the authentication protocol and persistence implementation; this package owns the shared Santiago
policy.

The package intentionally does not share sessions, cookies, passkeys, databases, secrets, or relying-party IDs between
applications. Every consumer supplies a unique origin, cookie prefix, secret, D1 binding, and email delivery callback.

## Current status

This package is private while the playground and initial consumers validate the integration. Do not publish it or
replace an application's current authentication until its D1 migration, compatibility route, session cutover, and
browser passkey flow have passed. The npm package page will remain unavailable until that evidence is complete; see the
repository's [release process](https://github.com/santi020k/auth/blob/main/docs/releasing.md) for the exact gate.

## Policy

- Email OTPs are six digits, expire after ten minutes, allow five verification attempts, and are stored hashed.
- Rate limits are enabled in every environment and use D1 rather than per-isolate memory.
- Only the configured owner email may create or update an identity.
- Unauthorized email-code requests receive the same success-shaped response without sending mail.
- Unsafe requests require an exact same-origin `Origin` header.
- Passkeys require discoverable credentials and user verification.
- The WebAuthn relying-party ID is always the exact application hostname.
- Production cookies are secure and remain scoped to the application hostname.

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

Cloudflare Workers must enable `nodejs_compat` (or the narrower `nodejs_als` flag when no other Node compatibility is
needed). Each application must generate and review its own Better Auth core and passkey migration; the package does not
silently create or mutate production tables.
