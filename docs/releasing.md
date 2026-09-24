# Package releases

`@santi020k/auth-cloudflare` is not currently published to npm. Its `private: true` manifest flag is an intentional
release gate, not a registry or GitHub Actions failure. Publication remains blocked until two independent consumers
complete the production evidence in [production readiness](production-readiness.md).

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

Commit the generated version and changelog changes, obtain the required independent pre-push review, then open a pull
request from `release/v<semver>` to `main`. The release pull request must include consumer evidence, migration notes,
and a rollback or forward-recovery plan.

## Initial npm publication

npm requires a package to exist before a trusted publisher can be attached. After the two-consumer gate passes, remove
`private: true` in the release pull request and perform the initial scoped public publication manually with 2FA:

```sh
git switch main
git pull --ff-only
pnpm --dir packages/auth-cloudflare publish --access public
```

That manual exception is for the initial publication only. Immediately afterward, configure npm trusted publishing for:

- GitHub owner: `santi020k`
- Repository: `auth`
- Workflow: `release-package.yml`
- Environment: `production`
- Allowed action: direct publish

The repository is private, so npm cannot generate a public provenance attestation yet. `publishConfig.provenance`
therefore remains `false`; enable it only if the repository becomes public and the npm provenance prerequisites are
satisfied.

## Automated releases

After the trusted publisher exists, merging an exact `release/v<semver>` pull request runs `Release package`. The
workflow re-runs the complete repository gate, inspects the package tarball, publishes through npm OIDC, verifies the
registry version, then creates immutable `v<semver>` and package-version tags plus a GitHub Release from the merged
`main` commit. A manual dispatch on `main` is reserved for idempotent recovery.

Never move or replace a published tag. Recover a failed publication with the same workflow when it is safe and
idempotent, or prepare a new version when registry state already changed.
