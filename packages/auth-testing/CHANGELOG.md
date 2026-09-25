# @santi020k/auth-testing

## 0.4.0

### Minor Changes

- e374e96: Split the Cloudflare authentication platform into typed client, Hono, migration, email, recovery, and testing packages;
  preserve the existing Cloudflare compatibility exports; add optional OAuth, Turnstile, recent-authentication guards,
  session lifecycle controls, isolated migration namespaces, localized delivery, and Web Crypto recovery primitives.
  Rate-limit contract fixtures expect the enumeration-resistant generic HTTP 200 response and direct consumers to
  verify throttling through isolated internal evidence.

### Patch Changes

- Updated dependencies [e374e96]
  - @santi020k/auth-migrations@0.4.0
