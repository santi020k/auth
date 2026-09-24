# santi020k auth

Reusable authentication policy for Santiago-owned applications. The first adapter is
`@santi020k/auth-cloudflare`, an owner-only email-code and passkey implementation for Hono applications on Cloudflare
Workers and D1. A local playground demonstrates the complete browser flow, and a static documentation website explains
the security boundary and integration contract.

This repository owns authentication protocol policy and reusable integration code. Each application still owns its
identity data, D1 migrations, secret, cookies, passkeys, relying-party ID, email copy, recovery process, and deployment.
Sharing this package never creates a shared account system.

## Workspace

- `packages/auth-cloudflare`: reusable Better Auth policy and Cloudflare/D1 adapter.
- `apps/playground`: local-only Hono/D1 app for email-code and platform-passkey verification.
- `apps/website`: Astro and Lumen documentation site prepared for `auth.santi020k.com`.

The package remains private while the playground and the first two consumers validate migrations, compatibility, and
passkeys on their real origins. No consumer should replace an existing login system solely because the package builds.

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

Before integrating a real application, copy and review the schema migration, configure a unique `AUTH_SECRET`,
`OWNER_EMAIL`, cookie prefix, and origin, then connect a real transactional email provider. Never deploy the playground's
development mailbox.

Use the [consumer integration checklist](docs/consumer-integration.md) for the separate PostLens Planner and Observatory
cutovers. Those examples intentionally show different databases, cookie prefixes, and origins.

## Repository verification

Install the pinned Quality hooks once per checkout and run the complete local gate before handoff:

```sh
pnpm hooks:install
pnpm verify
```

`pnpm verify` checks formatting, Santiago-owned ESLint policy, spelling, unused code, builds, strict types, unit and D1
integration tests, desktop and mobile website E2E/accessibility behavior, package exports, and production dependency
advisories. CI runs the same Quality task. CodeQL and dependency review are ready to activate when the repository is
public or its GitHub plan supports Advanced Security for private repositories.

See [production readiness](docs/production-readiness.md) for the exact evidence required before deploying the website or
making the package public. A green local gate is necessary but does not prove a Cloudflare deployment, real email
delivery, or passkeys on a consumer's production origin.

## Security boundary

- Unsafe authentication requests require an exact same-origin `Origin` header.
- Only the configured owner email may create or update a user.
- Email codes are hashed in Better Auth storage, expire after ten minutes, and allow five attempts.
- Passkeys require discoverable credentials and user verification.
- Rate limits persist in D1 rather than isolate memory.
- Production origins require HTTPS and secure cookies.
- Every consumer uses a separate secret, database, cookie prefix, hostname, passkeys, and recovery policy.

Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.

Copyright 2026 [Santiago Molina](https://santi020k.com). Licensed under MIT.
