# Package releases

`@santi020k/auth-cloudflare` already has a public npm contract, including its compatibility subpaths. The newer
`@santi020k/auth-client`, `@santi020k/auth-email-resend`, `@santi020k/auth-hono`, `@santi020k/auth-machine`,
`@santi020k/auth-migrations`, `@santi020k/auth-recovery`, and `@santi020k/auth-testing` packages are prepared for their
initial public publication in v0.4.0. Their first registry publication requires the one-time bootstrap below; later
versions use trusted publishing.

## Fixed release group

The eight packages above version together as a single Changesets `fixed` group in `.changeset/config.json`: every release
bumps all of them to the same version, even if a given release only changed one package. `pnpm run check:release`
(part of `pnpm verify`) enforces that the group stays coherent — every publishable package under `packages/*` is listed
in the fixed group, nothing stale remains in the group, every package's version matches the others, and no package
depends on a workspace package that has drifted outside the group. `apps/playground` and `apps/website` are excluded
from the group through `.changeset/config.json`'s `ignore` list; they are never published. The release workflow owns
immutable tags only after publication succeeds.

## Dependency order

Publication order is topological with a stable alphabetical tie-break: a package publishes only after every other
fixed-group package it depends on at runtime through a `workspace:*` dependency, peer dependency, or optional
dependency has already published successfully. Independent packages may publish before `auth-migrations`, while
`auth-testing` publishes after `auth-migrations` because it has a runtime workspace dependency on it. `auth-cloudflare`
is independent and currently precedes `auth-migrations` under the alphabetical tie-break. Development-only dependencies
do not affect registry order.
`scripts/release/lib/packages.mjs` computes this from the package manifests, so adding an internal runtime dependency
automatically changes publish order without editing the workflow.

## Version preparation

Package changes require a Changeset. Prepare a release only from an up-to-date `main` branch:

```sh
git switch main
git pull --ff-only
git switch -c release/v<semver>
pnpm release:version
pnpm verify
pnpm release:pack
```

`pnpm release:version` bumps every package in the fixed group to the same `<semver>`. Commit the generated version and
changelog changes, obtain the required independent pre-push review, then open a pull request from `release/v<semver>`
to `main`. The release pull request must include compatibility and migration notes plus a rollback or forward-recovery
plan.

## Initial npm publication

npm requires a package to exist before a trusted publisher can be attached to it, so the first publication of each of
the seven unpublished split packages is a manual, one-time exception. Perform it once per new package, in dependency
order, from the verified merged release commit and with explicit action-time authorization. Do not repeat initial
publication for `@santi020k/auth-cloudflare`:

```sh
git switch main
git pull --ff-only
pnpm --dir packages/auth-migrations publish --access public
pnpm --dir packages/auth-client publish --access public
pnpm --dir packages/auth-email-resend publish --access public
pnpm --dir packages/auth-hono publish --access public
pnpm --dir packages/auth-machine publish --access public
pnpm --dir packages/auth-recovery publish --access public
pnpm --dir packages/auth-testing publish --access public
```

Use 2FA for each manual publish. That manual exception is for the initial publication of each package only; every
later release of that package flows through the automated workflow below. Immediately after the seven new initial
publications, configure npm trusted publishing for each new package with:

- GitHub owner: `santi020k`
- Repository: `auth`
- Workflow: `release-package.yml`
- Environment: `production`
- Allowed action: direct publish

The repository is private, so npm cannot generate a public provenance attestation yet. Every package's
`publishConfig.provenance` therefore remains `false`; enable it only if the repository becomes public and the npm
provenance prerequisites are satisfied for that package.

## Optional pre-publication bundle

`pnpm pilot:pack -- <empty-output-directory>` can create a reviewable consumer bundle from a clean committed revision
before registry publication. It packs all eight fixed-group packages, rejects unresolved workspace-local dependency
protocols, and writes `pilot-bundle.json` plus `SHA256SUMS`. Consumers may vendor that complete, versioned output and
install the packages they need through checked-in `file:` dependencies as described in the
[consumer integration checklist](consumer-integration.md). This optional path creates no npm version, tag, GitHub
Release, or public artifact.

## Automated releases

After the trusted publishers exist, merging an exact `release/v<semver>` pull request runs `Release package`. The
workflow re-runs the complete repository gate (`pnpm verify`, which includes `check:release`'s metadata, Changesets
coherence, and pack validation for all eight packages), then runs `node scripts/release/publish.mjs`, which:

1. Re-validates every package's metadata and refuses to continue if any package is still private or the fixed group
   has drifted.
2. Builds the full publish plan for every package — pack it, compute its tarball integrity, and compare against the
   npm registry — **before publishing anything**. If any package hasn't had its manual initial publication yet, an
   already-published version's integrity doesn't match the commit being released, or registry state cannot be read
   reliably, the whole run fails before a single package is published.
3. Publishes each pre-validated tarball through npm OIDC, strictly in dependency order, and verifies the registry
   version after each publish. npm does not provide an atomic multi-package transaction: a registry or network failure
   can still interrupt the run after an earlier package publishes. The workflow is deliberately resumable; rerun the
   same merged commit so matching packages are skipped and the remaining packages continue.
4. Creates immutable tags: one shared `v<semver>` repository tag, plus one `<package>@<semver>` tag per package.
   Tagging is idempotent (safe to rerun) but refuses to move a tag that already points at a different commit.
5. Creates the GitHub Release from the merged `main` commit once all tags exist.

A manual `workflow_dispatch` on `main` is reserved for idempotent recovery: rerunning it after a partial failure only
publishes, verifies, or tags whatever didn't already complete.

Never move or replace a published tag. Recover a failed publication with the same workflow when it is safe and
idempotent, or prepare a new version when registry state already changed.

## Local dry run

Rehearse the full plan — pack every package, compare integrity against the public npm registry, and print what would
publish — without publishing, tagging, or touching git or GitHub:

```sh
pnpm run release:publish -- --dry-run
```

This requires every package in the fixed group to be publishable, exactly like the real workflow.
