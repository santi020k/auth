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

Keep every not-yet-published package in the fixed release group (`@santi020k/auth-client`,
`@santi020k/auth-email-resend`, `@santi020k/auth-hono`, `@santi020k/auth-migrations`,
`@santi020k/auth-recovery`, `@santi020k/auth-testing`) private until at least two separate applications have completed
every item below. `@santi020k/auth-cloudflare` already has a public compatibility contract; retain its existing exports
and do not treat it as an initial publication:

1. The application owns and successfully applies its additive D1 migration.
2. Existing login and recovery paths remain available during a bounded compatibility window.
3. Real transactional email delivery is verified without logging, displaying, or returning the code.
4. Approved and rejected email behavior, expiry, attempts, rate limiting, sign-out, revocation, and cross-origin
   rejection are verified.
5. Passkey registration and sign-in succeed in a real browser on the application's final HTTPS origin.
6. Recovery is documented and tested for that application.
   If recovery codes are enabled, only digests are persisted, replacement is app-owned, and concurrent consumption
   proves that exactly one attempt succeeds.
7. Cookies, secrets, databases, passkeys, relying-party IDs, and recovery policy remain isolated from every other
   consumer.

After two consumers satisfy the gate, remove `private: true` from each unpublished package deliberately, add a
Changeset, verify package ownership, and follow [package releases](releasing.md). Each new package's initial npm
publication is the only manual publication, performed once per package in dependency order, because npm requires a
package to exist before trusted publishing can be configured for it. Every subsequent release must use a
`release/v<semver>` pull request and GitHub Actions, which publishes, verifies, and tags all seven packages together in
dependency order; do not publish later releases manually from a workstation.

## Rollback and recovery

- A consumer rollout must preserve its previous authentication path until email-code and passkey evidence is complete.
- A failed website deployment should be recovered by redeploying the last verified revision through the workflow.
- An exposed secret must be rotated or revoked in the owning application; deleting visible plaintext is not a recovery.
- Schema changes must be additive and forward-recoverable. Never reset or destructively rewrite consumer identity data.
