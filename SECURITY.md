# Security policy

## Supported status

`@santi020k/auth-cloudflare` is private and has no supported public release yet. The `main` branch is the only maintained
development line until the first release.

## Reporting a vulnerability

Do not open a public issue containing vulnerability details, credentials, email codes, cookies, passkey material,
database contents, or production account data. Send Santiago Molina a private report through an established private
contact channel. Include:

- the affected revision and component;
- a minimal reproduction with sensitive values removed;
- the expected and observed security boundary;
- likely impact and any known exploitation conditions.

Do not test against a production consumer, access data that is not yours, or retain authentication material. A report
will be acknowledged privately before remediation or disclosure timing is discussed.

## Secret exposure

If an authentication secret, Cloudflare credential, email-provider credential, session cookie, or passkey private
material is exposed, stop using it and rotate or revoke it in the owning application. Removing plaintext from source or
logs is not sufficient remediation.
