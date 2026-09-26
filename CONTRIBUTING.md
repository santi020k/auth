# Contributing

This repository is developed as a pnpm workspace on Node.js 22.22.3 or newer. Read `AGENTS.md` before changing code.

## Local setup

```sh
pnpm install --frozen-lockfile
pnpm hooks:install
pnpm --filter @santi020k/auth-playground run db:apply
pnpm dev:playground
```

Use a unique local D1 database and development-only secret. The playground may reveal an email code only on localhost
when `ALLOW_LOCAL_CODE` is explicitly enabled. Never copy that behavior into a deployed application.

## Before opening a pull request

```sh
pnpm verify
```

Use `pnpm commit` for the repository's Commitprompt workflow. Keep migrations additive and owned by the consuming
application. Do not introduce shared databases, secrets, cookies, sessions, passkeys, relying-party IDs, or recovery
policy between consumers.

Changes that affect a publishable package need a Changeset. Use the release gates in
`docs/production-readiness.md` before publication. Run `pnpm run check:release` to validate metadata, Changesets coherence,
and pack contents across all eight packages, and `pnpm release:pack` to inspect the exact npm tarballs before proposing
a release. Release preparation and publication follow `docs/releasing.md`; do not create package tags manually.
