# Package releases

`@santi020k/auth-cloudflare` is a public experimental `0.x` package. Every publication is produced from merged `main`
by `.github/workflows/release-package.yml`; never publish from a developer workstation.

## Version preparation

Package changes require a Changeset. Prepare a release from an up-to-date `main` branch:

```sh
git switch main
git pull --ff-only
git switch -c release/v<semver>
pnpm release:version
pnpm verify
pnpm release:pack
```

Commit the generated version and changelog changes, obtain the required independent pre-push review, then open a pull
request from `release/v<semver>` to `main`. Include migration notes and a rollback or forward-recovery plan. Merge only
after required checks and review findings are resolved.

## Initial GitHub Actions publication

npm requires the package to exist before a trusted publisher can be attached. Bootstrap the first release without a
manual publish:

1. Create a short-lived, granular npm access token scoped only to publishing `@santi020k/auth-cloudflare`, with the
   minimum lifetime and permissions required for this one release. Enable bypass 2FA because GitHub Actions cannot
   complete an interactive second-factor prompt; revoke the token immediately after the bootstrap publish.
2. Store it as the `NPM_TOKEN` secret in the GitHub `production` environment. Never place it in repository files, shell
   history, workflow logs, or pull-request text.
3. Merge the reviewed `release/v0.2.0` pull request. The release workflow verifies the exact merged revision, uses
   `NPM_TOKEN` only when the registry confirms this is the initial publication, verifies npm, and only then deploys and
   smoke-tests the documentation site.
4. Verify the published version, provenance metadata, immutable tags, GitHub Release, and deployed documentation.
5. In npm package settings, configure a GitHub Actions trusted publisher with:
   - GitHub owner: `santi020k`
   - Repository: `auth`
   - Workflow: `release-package.yml`
   - Environment: `production`
   - Allowed action: direct `npm publish` (not only staged publishing)
6. Delete the `NPM_TOKEN` GitHub environment secret and revoke the bootstrap token immediately.

The repository is public and `publishConfig.provenance` is enabled, so eligible GitHub Actions publications include npm
provenance. Do not keep a long-lived registry token as a fallback.

## Subsequent OIDC releases

After the trusted publisher is configured, merging an exact `release/v<semver>` pull request runs `Release package`.
The workflow re-runs the repository gate, inspects the package tarball, publishes through npm OIDC, verifies the
registry version, deploys and smoke-tests the website, then creates immutable `v<semver>` and package-version tags plus
a GitHub Release from the merged `main` commit. A manual dispatch on `main` is reserved for idempotent recovery.

Before declaring the release complete, verify that the tags point to the merged commit, the GitHub Release exists, npm
serves the intended version, and the documentation site is live. Then delete the release branch and fast-forward local
`main`.

Never move or replace a published tag or npm version. Recover an interrupted workflow only when its steps are
idempotent; otherwise prepare a new patch release.
