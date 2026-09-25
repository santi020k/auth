# `@santi020k/auth-client`

Typed Better Auth browser client with email OTP and passkey plugins. It validates the API origin and base path, includes
credentials on cross-subdomain requests, and does not own application UI, routing, or recovery policy.

```ts
import { createSantiAuthClient } from "@santi020k/auth-client";

export const authClient = createSantiAuthClient({
  basePath: "/auth/v2",
  baseURL: "https://api.example.com",
});
```

For product UI, prefer the stable result-based facade. It normalizes Better Fetch and thrown errors, keeps session
tokens private inside the client closure, and exposes only safe session summaries. Call `listSessions()` before
`revokeSession(id)` so the facade can resolve the opaque token without returning it to application state.

```ts
import { createSantiAuthHelpers } from "@santi020k/auth-client";

const auth = createSantiAuthHelpers({ baseURL: "https://api.example.com" });

const requested = await auth.requestEmailOtp("member@example.com");
if (!requested.ok) showAuthError(requested.error);

const sessions = await auth.listSessions();
if (sessions.ok) renderSessions(sessions.data);
```

When the consumer enables Turnstile, pass its freshly issued browser token as
`requestEmailOtp(email, { captchaResponse })`. The helper sends it only in Better Auth's `x-captcha-response` header;
the consumer owns widget rendering, expiry/reset behavior, and its product-specific error state.

The facade also provides email-code and passkey sign-in; safe passkey inventory, registration, rename, and deletion;
current-session resolution; sign-out; and revoke-one, revoke-other, and revoke-all helpers. Passkey inventory omits the
stored public key and credential material. Its error shape is always `{ code, message, status }`. Applications still own
UI copy, routing, authorization, roles, invitations, account recovery, and impersonation policy. The raw typed Better
Auth client remains available as `helpers.raw` for a protocol feature that has not earned a stable wrapper.

When the server enables an approved social provider, `signInWithSocial(provider, options)` starts its OAuth flow and
`linkSocialAccount(provider, options)` links it to an already authenticated user. Both return a typed redirect result
when automatic redirects are disabled. Provider credentials, allowed identities, callback routes, scopes, and
account-linking confirmation UI remain consumer-owned.
