# `@santi020k/auth-recovery`

Web Crypto-compatible, consumer-owned one-time recovery-code primitives. Codes use an unambiguous uppercase alphabet,
carry approximately 99 bits of entropy, and are displayed as four groups of five characters. Storage receives only a
versioned HMAC-SHA-256 digest scoped to a stable subject ID and an application-specific secret pepper.

```ts
const codes = await issueRecoveryCodes({
  pepper: env.AUTH_RECOVERY_PEPPER,
  store: recoveryStore,
  subject: user.id,
});

// Render or download `codes` once over an already authenticated, protected flow.
// The package and store provide no plaintext retrieval API.

const consumed = await consumeRecoveryCode({
  code: submittedCode,
  pepper: env.AUTH_RECOVERY_PEPPER,
  store: recoveryStore,
  subject: user.id,
});
```

The consumer implements `RecoveryCodeStore`. `consumeRecoveryCodeAtomically` must match an unused digest and delete or
mark it used in the same database transaction; a read followed by a later write is not sufficient. The consumer also
owns the transaction and policy for `replaceRecoveryCodes`, including whether issuing a new set invalidates every old
code.

Never persist, log, email, or return plaintext codes after the one issuance response. Keep the pepper in the consumer's
secret manager, use at least 32 bytes, and isolate it from authentication secrets used by other products. Pepper
rotation requires an explicit forward-recovery plan because existing digests will no longer match.

This package does not decide who may recover an account. Identity proof, owner/admin authority, rate limits, alerts,
audit records, session revocation, UI, and support procedures remain consumer-owned. A valid code should normally be
followed by revoking existing sessions and completing the application's documented recovery ceremony.
