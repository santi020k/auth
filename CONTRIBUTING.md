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

Changes that affect the public package need a Changeset. Use `pnpm release:pack` to inspect the exact npm tarball before
proposing a release. Release preparation and publication follow `docs/releasing.md`; never publish from a workstation
or create package tags manually. The current public `0.x` line is experimental, so externally visible changes need
clear migration notes even when backward compatibility is not promised.
