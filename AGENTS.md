# Auth repository instructions

- Keep this repository independent from every consuming product. Consumers may share code, never secrets, sessions,
  cookies, databases, passkeys, relying-party IDs, or recovery policy.
- The package is public. Consumer migrations and real-origin passkey verification remain recommended validation, but are
  not release gates.
- The playground may expose login codes only on localhost and only when its explicit development flag is enabled.
- Never add a production fallback that displays, logs, or returns authentication codes.
- Use additive, app-owned D1 migrations. This library must not mutate production schemas implicitly.
- Run `pnpm check` before handoff.
