# Package releases

`@santi020k/auth-cloudflare` already has a public npm contract, including its compatibility subpaths. The newer
`@santi020k/auth-client`, `@santi020k/auth-email-resend`, `@santi020k/auth-hono`, `@santi020k/auth-migrations`,
`@santi020k/auth-recovery`, and `@santi020k/auth-testing` packages are not currently published. Their `private: true`
manifest flags are an intentional release gate, not a registry or GitHub Actions failure. Publication remains blocked
until two independent consumers complete the production evidence in [production readiness](production-readiness.md).

## Fixed release group

The seven packages above version together as a single Changesets `fixed` group in `.changeset/config.json`: every release
bumps all of them to the same version, even if a given release only changed one package. `pnpm run check:release`
(part of `pnpm verify`) enforces that the group stays coherent — every publishable package under `packages/*` is listed
in the fixed group, nothing stale remains in the group, every package's version matches the others, and no package
depends on a workspace package that has drifted outside the group. `apps/playground` and `apps/website` are excluded
from the group through `.changeset/config.json`'s `ignore` list; they are never published. Changesets is configured to
version the packages while they remain private, but not to tag them; the release workflow owns immutable tags only
after publication succeeds.

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
to `main`. The release pull request must include consumer evidence, migration notes, and a rollback or
forward-recovery plan.

## Initial npm publication

npm requires a package to exist before a trusted publisher can be attached to it, so the first publication of each of
the six unpublished split packages is a manual, one-time exception. Perform it once per new package, in dependency
order, after the two-consumer gate passes and `private: true` has been removed in the release pull request. Do not
repeat initial publication for `@santi020k/auth-cloudflare`:

```sh
git switch main
git pull --ff-only
pnpm --dir packages/auth-migrations publish --access public
pnpm --dir packages/auth-client publish --access public
pnpm --dir packages/auth-email-resend publish --access public
pnpm --dir packages/auth-hono publish --access public
pnpm --dir packages/auth-recovery publish --access public
pnpm --dir packages/auth-testing publish --access public
```

Use 2FA for each manual publish. That manual exception is for the initial publication of each package only; every
later release of that package flows through the automated workflow below. Immediately after the six new initial
publications, configure npm trusted publishing for each new package with:

- GitHub owner: `santi020k`
- Repository: `auth`
- Workflow: `release-package.yml`
- Environment: `production`
- Allowed action: direct publish

The repository is private, so npm cannot generate a public provenance attestation yet. Every package's
`publishConfig.provenance` therefore remains `false`; enable it only if the repository becomes public and the npm
provenance prerequisites are satisfied for that package.

## Automated releases

After the trusted publishers exist, merging an exact `release/v<semver>` pull request runs `Release package`. The
workflow re-runs the complete repository gate (`pnpm verify`, which includes `check:release`'s metadata, Changesets
coherence, and pack validation for all seven packages), then runs `node scripts/release/publish.mjs`, which:

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

This still fails closed while any package in the fixed group is private, exactly like the real workflow.
