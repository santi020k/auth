# `@santi020k/auth-testing`

Reusable Miniflare/D1 fixtures and HTTP helpers for consumer contract tests. Each harness owns an isolated database and
must be disposed by the test. No production credentials or remote databases are involved.

```ts
const harness = await createAuthD1TestHarness({ tablePrefix: "planner_v2" });
try {
  // create the consumer auth instance with harness.database
} finally {
  await harness.dispose();
}
```

`createAuthContractFixtures()` supplies transport-level vectors for session expiry, session revocation, rate limiting,
and exact-origin enforcement. Each vector includes its setup prerequisite so consumers remain responsible for arranging
state through their public API and isolated database. `createConsumerIsolationFixtures()` supplies distinct table and
cookie namespaces for a two-consumer isolation test, while `createAuthTestClock()` makes expiry boundaries deterministic.
The rate-limit vector expects the enumeration-resistant public HTTP 200 response. Prove that throttling occurred through
an isolated provider delivery count, a security event, or database state rather than exposing a public HTTP 429 oracle.

`createWebAuthnBoundaryFixtures()` creates encoded `clientDataJSON` vectors for valid registration/authentication,
wrong-origin, wrong-challenge, and cross-origin cases. They deliberately stop at the browser boundary: they do not claim
to be cryptographically valid authenticator responses. Real passkey verification still requires a rendered browser on
each consumer's actual HTTPS origin.
