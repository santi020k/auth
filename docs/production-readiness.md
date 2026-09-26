# Production readiness

This document separates repository readiness from evidence that can exist only after configuring real infrastructure
and integrating real consumers.

## Repository gate

The repository is ready to propose for production integration when all of the following pass on the exact revision:

```sh
pnpm install --frozen-lockfile
pnpm verify
quality doctor --format pretty
quality hooks status
```

The gate covers formatting, linting, spelling, unused code, builds, strict types, policy and D1 integration tests,
desktop and mobile documentation E2E tests, automated accessibility checks, package export validation, and production
dependency advisories. GitHub workflows add CodeQL and dependency review when GitHub Advanced Security supports the
repository's visibility.

## Website deployment gate

The documentation site may be deployed only after all of these are true:

1. The `santi020k.com` zone is available in the intended Cloudflare account and `auth.santi020k.com` has no conflicting
   DNS record or Worker route.
2. The GitHub `production` environment exists and protects the deploy job as intended.
3. The repository is connected to the Auth Infisical project through its least-privileged GitHub OIDC identity.
4. `CLOUDFLARE_ACCOUNT_ID` and a least-privileged `CLOUDFLARE_API_TOKEN` exist in the Infisical `prod`
   environment at `/github/deploy-website`; their values are never copied into GitHub secrets.
5. CI succeeds on the exact revision being deployed.
6. The manual `Deploy website` workflow succeeds and the production smoke request returns the expected page over HTTPS.

The website contains documentation only. It does not host identities, sessions, passkeys, email codes, or consumer
application secrets.

## Package publication gate

Package publication depends on repository and release integrity, not a required number of consumer deployments. Before
publishing the fixed release group:

1. Run the repository gate above on the exact release revision.
2. Confirm all eight package manifests are public, versioned together, and pass `pnpm run check:release` plus
   `pnpm release:pack`.
3. Preserve the released `@santi020k/auth-cloudflare` compatibility exports and include migration notes for intentional
   experimental `0.x` changes.
4. Verify npm ownership, the one-time initial-publication order, and trusted-publisher configuration described in
   [package releases](releasing.md).
5. Obtain explicit authorization immediately before the initial npm publications or release workflow changes registry,
   tag, or GitHub Release state.

Consumer readiness remains application-owned. Each product must validate its additive migration, compatibility path,
real delivery, browser passkeys, recovery, rollback, and identity-state isolation before replacing its existing login;
those product checks do not block publication of the reusable packages.

## Rollback and recovery

- A consumer rollout must preserve its previous authentication path until email-code and passkey evidence is complete.
- A failed website deployment should be recovered by redeploying the last verified revision through the workflow.
- An exposed secret must be rotated or revoked in the owning application; deleting visible plaintext is not a recovery.
- Schema changes must be additive and forward-recoverable. Never reset or destructively rewrite consumer identity data.
