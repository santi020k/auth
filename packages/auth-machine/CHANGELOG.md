# @santi020k/auth-machine

## 0.5.0

### Minor Changes

- Make machine credentials production-ready with bounded asynchronous resolution, explicit rotation and revocation
  helpers, scope-enforcing Hono middleware, reusable security contract fixtures, and a localhost-only playground example.

## 0.4.0

### Minor Changes

- Add scoped, hashed bearer credentials for non-interactive MCP, scheduled-job, and server-to-server clients. Tokens
  are shown once, persisted only as SHA-256 digests, support explicit scopes and lifecycle timestamps, and expose
  redacted authentication events for consumer-owned audit storage.
