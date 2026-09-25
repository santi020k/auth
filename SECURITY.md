# Security policy

## Supported status

`@santi020k/auth-cloudflare` is public as an experimental `0.x` package. Only the latest published `0.x` release and the
`main` branch receive security fixes. Experimental status means public APIs may change between minor releases; it does
not weaken the security or disclosure process.

## Reporting a vulnerability

Do not open a public issue containing vulnerability details, credentials, email codes, cookies, passkey material,
database contents, or production account data. Use the repository's
[private vulnerability reporting form](https://github.com/santi020k/auth/security/advisories/new). Include:

- the affected revision and component;
- a minimal reproduction with sensitive values removed;
- the expected and observed security boundary;
- likely impact and any known exploitation conditions.

Do not test against a production consumer, access data that is not yours, or retain authentication material. A report
will be acknowledged privately before remediation or disclosure timing is discussed. If GitHub private reporting is
unavailable, use an established private contact channel for Santiago Molina without posting sensitive details publicly.

## Secret exposure

If an authentication secret, Cloudflare credential, email-provider credential, session cookie, or passkey private
material is exposed, stop using it and rotate or revoke it in the owning application. Removing plaintext from source or
logs is not sufficient remediation.
