# @santi020k/auth-cloudflare

## 0.4.0

### Minor Changes

- e374e96: Split the Cloudflare authentication platform into typed client, Hono, migration, email, recovery, and testing packages;
  preserve the existing Cloudflare compatibility exports; add optional OAuth, Turnstile, recent-authentication guards,
  session lifecycle controls, isolated migration namespaces, localized delivery, and Web Crypto recovery primitives.
  The public package retains the v0.3 origin aliases, versioned-secret rotation, configurable email OTP limits, exact
  credentialed CORS, and source-compatible session identity shape. The pre-1.0 policy and instance interfaces now
  require resolved origin/table metadata, session-management methods, and lifecycle fields from `resolveSession`;
  manually-authored policy literals and test doubles must migrate as documented in the package README. Passkey
  registration and authentication now fail closed unless the server-observed WebAuthn result confirms user verification,
  and email-code request responses remain generic even when internal rate limiting rejects a request.

### Patch Changes

- Bound requests rejected before Better Auth through an atomic D1 counter, expose explicit scheduled rate-limit
  retention, and return actionable `Retry-After` metadata without weakening generic email-discovery responses.

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
