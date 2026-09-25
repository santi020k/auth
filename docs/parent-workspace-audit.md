# Parent workspace adoption audit

Audit date: 2026-09-25. This inventory covers the Git repositories directly under
`/Users/santi020k/Projects/santi020k`. It distinguishes an additive pilot from a production cutover: no pilot may
remove its existing login or recovery path until email delivery, browser passkeys, revocation, and recovery have been
verified on the real origin.

## Implemented additive pilots

| Project                    | Fit                                                                                    | Current integration                                                                                                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostLens Marketing Planner | Strong: owner-only Hono Worker, D1, and same-origin browser app                        | Vendored `@santi020k/auth-cloudflare@0.1.0`, additive Better Auth tables, `/api/auth/v2/*`, and dual legacy/new session resolution. Existing login remains the default.                                                                                                                           |
| Observatory                | Strong after split-origin support: owner-only Hono/D1 API with a separate Astro origin | Vendored `@santi020k/auth-cloudflare@0.1.0`, additive Better Auth tables, `/auth/v2/*`, exact `SITE_URL` browser/WebAuthn origin, API-host cookie, and dual legacy/new session resolution. Existing recovery remains intact.                                                                      |
| Fenix Cartera              | Strong: Hono, D1, a same-origin React app, and an authoritative member directory       | Disabled-by-default `/api/auth-v2/*` pilot, prefix-isolated `cartera_auth_v2` migration in Cartera's own D1, active-member authorization, and a separate `cartera-auth-v2` cookie. Legacy login, recovery, and passkeys remain authoritative.                                                     |
| Aaronmgz admin             | Strong: Hono/D1 API with an authoritative administrator directory                      | Disabled-by-default `/api/auth-v2/*` pilot, prefix-isolated `aaron_admin_auth_v2` migration in Aaron's own D1, active-admin authorization, and a separate `aaron-admin-auth-v2` cookie. Guest identity and legacy administrator auth remain separate.                                             |
| The Cult dashboard         | Strong after adding an app-owned Worker/D1 boundary                                    | New optional auth Worker, prefix-isolated `cult_auth` migration, exact-origin CORS, Resend delivery, Turnstile-ready email codes, server sessions, and recent-authentication protection for emergency lockout. The existing local prototype remains available when no auth API URL is configured. |

PostLens and Observatory use vendored artifacts as an interim distribution mechanism. The newer local pilots use
workspace links while the split packages remain private; release consumers must replace those development links with
published versions after the publication gate passes.

These are local, additive integrations. None is production evidence: no migration was applied remotely and no real
origin, transactional email, or passkey ceremony was exercised.

`memudo.ai` was not assessed further because the owner explicitly excluded it from this rollout.

## Technically possible but not recommended now

| Project         | Reason                                                                                                                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RoadScore admin | It already uses Cloudflare Access as the production identity perimeter. Replacing that centrally managed control with app-owned email/passkey auth adds operational responsibility without a demonstrated product benefit. The package is reasonable only if RoadScore deliberately leaves Access. |

RoadScore now has an implementation decision document. If product requirements later justify application auth, it
must use a dedicated RoadScore auth D1 binding; its deck database and Observatory's auth database are not suitable
identity stores.

## No matching human web-authentication surface

- ContracTrack uses app/device entitlement and partner-room tokens; those are not browser user sessions.
- Coolstead and Workspace Organizer are local macOS products. They would need a native token/OAuth adapter, not the
  Cloudflare browser-cookie package.
- The main Website and the public sites in package/tool repositories do not have a private application surface.
- Astro Doctor, Commitprompt, Dep Beacon, Difftale, ESLint Config Basic, Extensions, Homebrew Tap, Lumen, Quality,
  `santi020k-og`, `santi020k-theme`, and `santi020k-way` are tooling, libraries, extensions, or documentation surfaces;
  adding authentication would create scope without a consumer requirement.

## Implemented library capabilities

- Single-owner and consumer-authorized multi-user policies.
- Hashed six-digit email OTPs, expiry, bounded attempts, and D1-backed rate limiting.
- Discoverable, user-verified passkeys.
- D1-backed sessions with configurable lifetime and update age.
- Exact unsafe-request origin enforcement, including separate API and browser origins.
- Per-consumer secrets, cookies, databases, relying-party IDs, membership decisions, and recovery ownership.
- Session-time membership revalidation for multi-user consumers.
- Optional OAuth provider sign-in and account-linking helpers with fresh provider-email policy validation.
- Optional Turnstile verification for public email-code requests.
- Authentication timestamps and reusable recent-authentication guards for sensitive actions.
- High-entropy, subject-scoped, one-time recovery-code primitives with atomic consumer-owned storage contracts.

## Missing or intentionally consumer-owned capabilities

- Roles, permissions, invitations, organizations, and impersonation audit policy.
- Product-specific administrator recovery authority, recovery UI, and recovery-event delivery.
- Product-specific OAuth provider credentials, consent UX, and provider-specific claim policy.
- Native mobile/desktop token exchange, PKCE, and device-bound session support.
- Production evidence from two real origins: email receipt, passkey registration/sign-in, expiry, rate limiting, sign-out,
  revocation, recovery, and rollback.

The library now includes safe session inventory and revocation, explicit emergency lockout, typed security-event hooks,
versioned additive migration planning, localized Resend delivery, and a localhost-only development mailbox. Consumers
still own their migration journal, durable audit-event destination, delivery configuration, recovery policy, and UI.

## Implemented package boundaries

`@santi020k/auth-cloudflare` remains focused on server policy. The supporting packages now provide:

- `@santi020k/auth-client` for typed email, session, sign-out, and passkey browser flows.
- `@santi020k/auth-hono` for route mounting, session resolution, and opt-in protection middleware.
- `@santi020k/auth-migrations` for reviewed default and prefix-isolated schema generation.
- `@santi020k/auth-email-resend` for redacted provider delivery and localized templates.
- `@santi020k/auth-recovery` for high-entropy, subject-scoped one-time recovery-code primitives.
- `@santi020k/auth-testing` for Miniflare fixtures and reusable request/database contract tests.

Recovery authority, replacement policy, storage transactions, and authorization remain consumer-owned because the
current products do not share the same requirements.
