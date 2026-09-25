# Production readiness

This document separates a public experimental package from evidence that can exist only after configuring real
infrastructure and integrating real consumers. Publication makes the `0.x` contract available for evaluation; it does
not make every consumer deployment production-ready or the package stable.

## Repository gate

The exact release revision must pass:

```sh
pnpm install --frozen-lockfile
pnpm verify
quality doctor --format pretty
quality hooks status
pnpm release:pack
```

The gate covers formatting, linting, spelling, unused code, builds, strict types, policy and D1 integration tests,
desktop and mobile documentation E2E tests, automated accessibility checks, package export validation, tarball review,
and production dependency advisories. The public repository also runs CodeQL and dependency review.

## Website deployment gate

The release workflow may deploy the documentation site only after all of these are true:

1. The `santi020k.com` zone is available in the intended Cloudflare account and `auth.santi020k.com` has no conflicting
   DNS record or Worker route.
2. The GitHub `production` environment exists and applies its intended protections.
3. The repository is connected to the Auth Infisical project through its least-privileged GitHub OIDC identity.
4. `CLOUDFLARE_ACCOUNT_ID` and a least-privileged `CLOUDFLARE_API_TOKEN` exist in the Infisical `prod` environment at
   `/github/deploy-website`; their values are never copied into repository files or GitHub secrets.
5. CI succeeds on the exact merged `main` revision.
6. Deployment succeeds and the HTTPS smoke request returns the expected release page.

The website contains documentation only. It does not host identities, sessions, passkeys, email codes, or consumer
application secrets.

## Experimental package publication gate

The public `0.x` release requires repository evidence, package metadata, a reviewed Changeset, and the automated release
path in [package releases](releasing.md). The initial publication uses a narrowly scoped, short-lived npm token only
because npm trusted publishing cannot be configured until the package exists. GitHub Actions—not a workstation—performs
that first publish and every later release.

The package remains experimental until separate applications have completed all of the following:

1. The application owns and successfully applies its additive D1 migration copied from the canonical package schema.
2. Existing login and recovery paths remain available during a bounded compatibility window.
3. Real transactional email delivery is verified without logging, displaying, or returning the code.
4. Owner and non-owner email behavior, expiry, attempts, rate limiting, sign-out, and origin rejection are verified.
5. Credentialed CORS is verified when browser and auth server origins differ.
6. Passkey registration and sign-in succeed in a real browser on the application's final HTTPS origin.
7. Recovery is documented and rehearsed for that application.
8. Cookies, secrets, databases, passkeys, relying-party IDs, and recovery policy remain isolated from every other
   consumer.

Evidence from at least two materially separate consumers supports a later decision to call the package supported or
stable. It is an adoption-maturity gate, not a public npm availability gate.

## Rollback and recovery

- A consumer rollout must preserve its previous authentication path until email-code and passkey evidence is complete.
- A failed website deployment should be recovered by redeploying the last verified revision through GitHub Actions.
- If the initial npm publish fails before registry state changes, correct the configuration and rerun the idempotent
  workflow. If a version exists, never overwrite it; prepare a new version.
- An exposed secret or bootstrap npm token must be revoked. Deleting visible plaintext is not a recovery.
- Schema changes must be additive and forward-recoverable. Never reset or destructively rewrite consumer identity data.
