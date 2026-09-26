# @santi020k/auth-machine

## 0.4.0

### Minor Changes

- Add scoped, hashed bearer credentials for non-interactive MCP, scheduled-job, and server-to-server clients. Tokens
  are shown once, persisted only as SHA-256 digests, support explicit scopes and lifecycle timestamps, and expose
  redacted authentication events for consumer-owned audit storage.
