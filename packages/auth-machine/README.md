# `@santi020k/auth-machine`

Scoped bearer credentials for non-interactive agents, MCP clients, scheduled jobs, and server-to-server API calls.
This package does not replace browser sessions or OAuth. It gives a consuming application a small resource-server
primitive for private automation clients that can supply a bearer token from a secret store.

```ts
import { parseMachineCredentials, resolveMachineBearer } from "@santi020k/auth-machine";

const credentials = parseMachineCredentials(env.MACHINE_AUTH_CREDENTIALS);
const principal = await resolveMachineBearer(request, credentials);
```

Generate a credential once with `createMachineCredential`. Store only its returned `record` in the server's secret
configuration. Deliver the raw `token` once to the client's secret manager or environment-variable injection path.
Never place the raw token in source, plugin archives, logs, screenshots, or reusable agent definitions.

Every credential has a stable ID, opaque subject, display name, explicit scopes, SHA-256 token digest, and optional
expiry. Consumers remain responsible for choosing scopes, limiting which routes accept machine authentication,
returning safe authorization errors, rotating credentials, and maintaining their own audit policy.
