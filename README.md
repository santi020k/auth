# santi020k auth

Reusable authentication policy for Santiago-owned applications. The first adapter is
`@santi020k/auth-cloudflare`, an email-code and passkey implementation for Hono applications on Cloudflare Workers and
D1. It supports either one configured owner or multiple identities approved by the consuming application. A local
playground demonstrates the complete browser flow, and a static documentation website explains the security boundary
and integration contract.

This repository owns authentication protocol policy and reusable integration code. Each application still owns its
identity data, reviewed D1 migration, secret, cookies, passkeys, relying-party ID, email provider and sender configuration,
recovery process, and deployment.

## Packages

- `@santi020k/auth-cloudflare`: Better Auth server policy for Cloudflare Workers and D1.
- `@santi020k/auth-client`: typed email OTP and passkey browser client.
- `@santi020k/auth-hono`: Hono route, session-resolution, and authentication middleware adapters.
- `@santi020k/auth-machine`: scoped, hashed bearer credentials for non-interactive MCP and API clients.
- `@santi020k/auth-migrations`: reviewed default and prefix-isolated D1 migration generation.
- `@santi020k/auth-email-resend`: redacted Resend delivery with English and Spanish code templates.
- `@santi020k/auth-recovery`: subject-scoped, peppered one-time recovery-code issuance and consumption primitives.
- `@santi020k/auth-testing`: isolated Miniflare D1 fixtures and auth request helpers.

The new split packages, including `@santi020k/auth-recovery`, remain private until two pilot consumers complete
verification on their real origins. The existing public `@santi020k/auth-cloudflare` contract and its compatibility
subpaths remain supported. Sharing a package never creates a shared account system.

## Workspace

- `packages/auth-cloudflare`, `packages/auth-client`, `packages/auth-hono`, `packages/auth-machine`, `packages/auth-migrations`,
  `packages/auth-email-resend`, `packages/auth-recovery`, `packages/auth-testing`: the fixed-version release group
  described above.
- `apps/playground`: local-only Hono/D1 app for email-code and platform-passkey verification.
- `apps/website`: Astro and Lumen documentation site prepared for `auth.santi020k.com`.

Every not-yet-published split package remains private while the playground and the first two consumers validate
migrations, compatibility, recovery, and passkeys on their real origins. No consumer should replace an existing login
system solely because the packages build.

- Website: [auth.santi020k.com](https://auth.santi020k.com)
- Source: [github.com/santi020k/auth](https://github.com/santi020k/auth)
- Existing npm package: [`@santi020k/auth-cloudflare`](https://www.npmjs.com/package/@santi020k/auth-cloudflare)
- Split-package status: private and unpublished until the production-readiness gate passes.

## Develop

Requirements: Node.js 22.22.3 or newer and pnpm 12.6.0.

```sh
pnpm install
pnpm --filter @santi020k/auth-playground run db:apply
pnpm dev:playground
```

Open `http://127.0.0.1:8793`. The playground stores codes in its local D1 mailbox and reveals the latest code only on
localhost while `ALLOW_LOCAL_CODE` is explicitly enabled. That route returns 404 in every other configuration.

Run the documentation website separately:

```sh
pnpm dev:website
```

Open `http://127.0.0.1:4393`.

Before integrating a real application, copy and review the schema migration, configure a unique `AUTH_SECRET`, cookie
prefix, origin, and either `OWNER_EMAIL` or an application-owned member lookup, then connect a real transactional email
provider. Never deploy the playground's development mailbox.

Use the [consumer integration checklist](docs/consumer-integration.md) for the separate PostLens Planner and Observatory
cutovers. Those examples intentionally show different databases, cookie prefixes, and origins.

The [parent workspace adoption audit](docs/parent-workspace-audit.md) records the two additive pilots, viable next
consumers, incompatible surfaces, and the features still missing before broader adoption.

## Repository verification

Install the pinned Quality hooks once per checkout and run the complete local gate before handoff:

```sh
pnpm hooks:install
pnpm verify
```

`pnpm verify` checks formatting, Santiago-owned ESLint policy, spelling, unused code, builds, strict types, unit and D1
integration tests, desktop and mobile website E2E/accessibility behavior, package exports, and production dependency
advisories. The website build also generates its deterministic social card with `@santi020k/og`; verification checks
that image for freshness and audits the built canonical, robots, Open Graph, X, structured-data, sitemap, and asset
contracts. CI runs the same Quality task. CodeQL and dependency review are ready to activate when the repository is
public or its GitHub plan supports Advanced Security for private repositories.

See [production readiness](docs/production-readiness.md) for the exact evidence required before deploying the website or
making the packages public. A green local gate is necessary but does not prove a Cloudflare deployment, real email
delivery, or passkeys on a consumer's production origin.

See [package releases](docs/releasing.md) for Changesets, `release/v<semver>` pull requests, npm trusted publishing,
immutable version tags, and initial-release requirements.

## Security boundary

- Unsafe authentication requests require the exact configured browser `Origin` header.
- Only the configured owner or identities approved by the consumer may create or update a user.
- Email codes are hashed in Better Auth storage, expire after ten minutes, and allow five attempts.
- Passkeys require discoverable credentials and user verification.
- Machine credentials store only high-entropy token digests, carry explicit scopes, and are accepted only on routes a
  consumer deliberately exposes to automation.
- Rate limits persist in D1 rather than isolate memory.
- Production origins require HTTPS and secure cookies.
- Every consumer uses a separate secret, database, cookie prefix, hostname, passkeys, and recovery policy.
- Recovery-code storage receives only subject-scoped HMAC digests; recovery authority and atomic persistence remain
  consumer-owned.

Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.

Copyright 2026 [Santiago Molina](https://santi020k.com). Licensed under MIT.
