# @santi020k/auth-cloudflare

## 0.4.0

### Minor Changes

- e374e96: Split the Cloudflare authentication platform into typed client, Hono, migration, email, recovery, and testing packages;
  preserve the existing Cloudflare compatibility exports; add optional OAuth, Turnstile, recent-authentication guards,
  session lifecycle controls, isolated migration namespaces, localized delivery, and Web Crypto recovery primitives.

### Patch Changes

- Updated dependencies [e374e96]
  - @santi020k/auth-migrations@0.4.0

## 0.3.0

### Minor Changes

- Add application-owned multi-user authorization with generic browser client, Hono middleware, schema diagnostics,
  membership revocation checks, and an integration guide while retaining the single-owner APIs.

## 0.2.1

### Patch Changes

- Publish an installable npm artifact with workspace catalog dependencies rewritten to concrete versions.

## 0.2.0

### Minor Changes

- Publish the first experimental public release with explicit application and auth-server origins, exact credentialed CORS, versioned secret rotation, reusable browser and Hono helpers, and a canonical app-owned D1 schema with a read-only compatibility check.
