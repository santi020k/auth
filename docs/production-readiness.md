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

Keep `@santi020k/auth-cloudflare` private until at least two separate applications have completed every item below:

1. The application owns and successfully applies its additive D1 migration.
2. Existing login and recovery paths remain available during a bounded compatibility window.
3. Real transactional email delivery is verified without logging, displaying, or returning the code.
4. Owner and non-owner email behavior, expiry, attempts, rate limiting, sign-out, and cross-origin rejection are verified.
5. Passkey registration and sign-in succeed in a real browser on the application's final HTTPS origin.
6. Recovery is documented and tested for that application.
7. Cookies, secrets, databases, passkeys, relying-party IDs, and recovery policy remain isolated from every other
   consumer.

After two consumers satisfy the gate, remove `private: true` deliberately, add a Changeset, verify package ownership and
provenance, and prepare the initial release through the repository's approved release process. Subsequent releases must
use a `release/v<semver>` pull request and GitHub Actions; do not publish later releases manually from a workstation.

## Rollback and recovery

- A consumer rollout must preserve its previous authentication path until email-code and passkey evidence is complete.
- A failed website deployment should be recovered by redeploying the last verified revision through the workflow.
- An exposed secret must be rotated or revoked in the owning application; deleting visible plaintext is not a recovery.
- Schema changes must be additive and forward-recoverable. Never reset or destructively rewrite consumer identity data.
