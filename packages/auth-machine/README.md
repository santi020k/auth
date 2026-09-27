# `@santi020k/auth-machine`

Scoped bearer credentials for non-interactive agents, MCP clients, scheduled jobs, and server-to-server API calls.
This package does not replace browser sessions or OAuth. It gives a consuming application a small resource-server
primitive for private automation clients that can supply a bearer token from a secret store.

```ts
import { parseMachineCredentials, resolveMachineBearer } from "@santi020k/auth-machine";

const credentials = parseMachineCredentials(env.MACHINE_AUTH_CREDENTIALS);
const principal = await resolveMachineBearer(request, credentials);
```

Applications with a database or secret service can resolve exactly one validated identifier asynchronously instead of
loading an entire credential inventory:

```ts
const principal = await resolveMachineBearer(request, async (credentialId) => {
  return credentialStore.findByCredentialId(credentialId);
});
```

The authorization header, token, and 80-character credential identifier are bounded before the resolver or security
event listener runs. Resolver errors and invalid stored records fail closed as `credential_resolution_failed` events;
raw authorization values and provider error details are never forwarded.

Generate a credential once with `createMachineCredential`, including a required expiry and at least one explicit scope.
Store only its returned `record` in the server's secret configuration. Deliver the raw `token` once to the client's
secret manager or environment-variable injection path. Never place the raw token in source, plugin archives, logs,
screenshots, or reusable agent definitions.

Every credential has a stable ID, opaque subject, display name, creation time, required expiry, explicit scopes, and a
SHA-256 token digest. Optional `notBefore` and `revokedAt` timestamps support bounded activation and immediate or
scheduled revocation. Pass `onSecurityEvent` to `resolveMachineBearer` for redacted success and rejection events;
listener failures never alter authentication behavior.

`revokeMachineCredential()` is idempotent and retains audit metadata. `rotateMachineCredential()` requires an explicit
`retirePreviousAt`, creates a cryptographically random replacement token, and returns the old record with its scheduled
retirement. Use an overlap only when the consumer's rollout requires it. `listMachineCredentialInventory()` omits token
digests for operator surfaces. An injectable entropy source exists for deterministic tests; production code should use
the default `crypto.getRandomValues` implementation.

Consumers remain responsible for persistence, choosing scopes, limiting which routes accept machine authentication,
delivering raw tokens through a secret manager such as Infisical, authorizing rotation, and storing audit events. Never
log, commit, or place a raw token in screenshots or reusable agent definitions.
