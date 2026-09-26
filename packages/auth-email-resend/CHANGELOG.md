# @santi020k/auth-email-resend

## 0.4.0

### Minor Changes

- e374e96: Split the Cloudflare authentication platform into typed client, Hono, migration, email, recovery, and testing packages;
  preserve the existing Cloudflare compatibility exports; add optional OAuth, Turnstile, recent-authentication guards,
  session lifecycle controls, isolated migration namespaces, localized delivery, and Web Crypto recovery primitives.

### Patch Changes

- Bound Resend requests with a configurable timeout and expose redacted delivery events that cannot break delivery.
