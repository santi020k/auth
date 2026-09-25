# santi020k auth

Public, reusable authentication policy for owner-only applications. The first adapter,
[`@santi020k/auth-cloudflare`](https://www.npmjs.com/package/@santi020k/auth-cloudflare), provides email-code and
passkey authentication for Hono applications on Cloudflare Workers and D1. A local playground demonstrates the browser
flow, and a static documentation website explains the security boundary and integration contract.

This repository owns authentication protocol policy and reusable integration code. Each application still owns its
identity data, D1 migrations, secret, cookies, passkeys, relying-party ID, email copy, recovery process, and deployment.
Sharing this package never creates a shared account system.

## Workspace

- `packages/auth-cloudflare`: reusable Better Auth policy and Cloudflare/D1 adapter.
- `apps/playground`: local-only Hono/D1 app for email-code and platform-passkey verification.
- `apps/website`: Astro and Lumen documentation site prepared for `auth.santi020k.com`.

The package is an **experimental `0.x` public release**. Its public contract can still change between minor releases;
pin the version, review the changelog, and preserve an existing login and recovery path during adoption. Successful
migrations in multiple real consumers are evidence for promoting the package to supported/stable status, not a gate to
public availability.

- Website: [auth.santi020k.com](https://auth.santi020k.com)
- Source: [github.com/santi020k/auth](https://github.com/santi020k/auth)
- npm: [`@santi020k/auth-cloudflare`](https://www.npmjs.com/package/@santi020k/auth-cloudflare)

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

Before integrating a real application, copy and review the canonical
[`schema/d1.sql`](packages/auth-cloudflare/schema/d1.sql) into an application-owned additive migration. Configure a
unique secret, owner email, cookie prefix, browser `applicationOrigin`, and `authServerURL`, then connect a real
transactional email provider. Never deploy the playground's development mailbox.

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
advisories. CI runs the same Quality task. The public repository also runs CodeQL and dependency review.

See [production readiness](docs/production-readiness.md) for the evidence required before calling an integration
production-ready or promoting the package beyond experimental status. A green local gate is necessary but does not
prove a Cloudflare deployment, real email delivery, or passkeys on a consumer's production origin.

See [package releases](docs/releasing.md) for Changesets, `release/v<semver>` pull requests, npm trusted publishing,
immutable version tags, and initial-release requirements.

## Security boundary

- Authentication requests accept only the configured browser origin and send credentialed CORS headers for that exact
  origin; unsafe requests without it are rejected.
- Only the configured owner email may create or update a user.
- Email codes are hashed in Better Auth storage, expire after ten minutes, and allow five attempts.
- Passkeys require discoverable credentials and user verification.
- Rate limits persist in D1 rather than isolate memory.
- Production origins require HTTPS and secure cookies.
- Every consumer uses a separate secret, database, cookie prefix, hostname, passkeys, and recovery policy.

Report vulnerabilities privately through GitHub as described in [SECURITY.md](SECURITY.md), not in a public issue.

Copyright 2026 [Santiago Molina](https://santi020k.com). Licensed under MIT.
