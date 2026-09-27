# @santi020k/auth-hono

## 0.5.0

### Minor Changes

- Make machine credentials production-ready with bounded asynchronous resolution, explicit rotation and revocation
  helpers, scope-enforcing Hono middleware, reusable security contract fixtures, and a localhost-only playground example.

### Patch Changes

- Updated dependencies
  - @santi020k/auth-machine@0.5.0

## 0.4.0

### Minor Changes

- e374e96: Split the Cloudflare authentication platform into typed client, Hono, migration, email, recovery, and testing packages;
  preserve the existing Cloudflare compatibility exports; add optional OAuth, Turnstile, recent-authentication guards,
  session lifecycle controls, isolated migration namespaces, localized delivery, and Web Crypto recovery primitives.

### Patch Changes

- Preserve downstream `Vary` values while composing exact credentialed CORS headers and reject widened preflight requests.
